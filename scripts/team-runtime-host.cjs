"use strict";

const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { createTeamChangeService } = require("./team-change-service.cjs");
const { createTeamObserver } = require("./team-observability.cjs");

const TOOL_NAMESPACE = "team";
const TOOL_NAME = "manage_changes";
const ACTIONS = ["status", "create_task", "change_request", "acknowledge_change", "submit", "begin_integration", "finish_integration", "accept_integration", "recover", "recover_write_lock", "observe"];
const TOOL = {
  type: "namespace", name: TOOL_NAMESPACE,
  description: "Manage this native Team's immutable changes, requirements and bottleneck evidence.",
  tools: [{ type: "function", name: TOOL_NAME,
    description: "Use status first for the action contract. Writes require a unique operationId. Candidate creation and tests use existing authorized tools. Only the designated Lead can accept integration after reviewing evidence. Never put prompts, source text or secrets in telemetry.",
    inputSchema: { type: "object", properties: {
      action: { type: "string", enum: ACTIONS }, operationId: { type: "string" },
      args: { type: "object", additionalProperties: true },
    }, required: ["action"], additionalProperties: false },
  }],
};
const GUIDE = "Team change management is available through team.manage_changes. Read status for its contract. Keep requirements and immutable submissions linked to tasks. Candidate creation and verification use existing authorized tools; finish submits reported evidence and the designated Lead explicitly reviews it before acceptance. This tool does not grant shell, installation, deployment or scheduling authority. Native turn/tool timing is collected automatically; use observe only for workflow stages and known blocking reasons.";
const COORDINATOR_ACTIONS = new Set(["create_task", "change_request", "accept_integration", "recover", "recover_write_lock"]);
const WORKFLOW_PHASES = new Set(["user_wait", "requirements", "handoff", "dependency_wait", "ready_queue", "workspace", "integration_queue", "validation_queue", "validation", "conflict"]);
const SCHEMA = {
  create_task: { taskId: "string", designVersion: "string", requirementsVersion: "string", scope: "string[]", requiredChecks: "string[]", dependencies: "{changeId,revision}[]", assignedSessionId: "string?" },
  change_request: { taskId: "string", requirementsVersion: "string", designVersion: "string" },
  acknowledge_change: { taskId: "string", requirementsVersion: "string", designVersion: "string" },
  submit: { taskId: "string", changeId: "string", baseCommit: "Git commit", resultCommit: "Git commit", requirementsVersion: "string", designVersion: "string", dependencies: "{changeId,revision}[]", validation: "validation[]" },
  begin_integration: { changeId: "string", revision: "integer", candidateCommit: "Git commit", expectedTeamCommit: "Git commit" },
  finish_integration: { reservationId: "string", generation: "integer", candidateCommit: "Git commit", validation: "validation[]" },
  accept_integration: { reservationId: "string", generation: "integer", candidateCommit: "Git commit" },
  recover: { reservationId: "string", generation: "integer", observedCommit: "Git commit", resolution: "retain|abort" },
  recover_write_lock: { expectedLockId: "exact writeLock.lockId from status; only a confirmed absent local process can be recovered" },
  observe: { taskId: "string", spanId: "string", phase: [...WORKFLOW_PHASES].join("|"), state: "start|end|blocked|unblocked|instant", reason: "optional bounded reason code", resourceId: "optional ID" },
  validation: { candidateCommit: "exact candidate commit", inputId: "string", environmentId: "string", commandId: "required check ID", exitCode: "integer", logRef: "string", scope: "string[]" },
};
function problem(code, message) { return Object.assign(new Error(message), { code }); }
function addTeamTools(params) {
  const tools = params.dynamicTools ?? [];
  if (!Array.isArray(tools)) throw problem("INVALID_TOOLS", "Native dynamicTools must be an array");
  const present = tools.find(tool => tool.name === TOOL_NAMESPACE);
  if (present && JSON.stringify(present) !== JSON.stringify(TOOL)) throw problem("TOOL_COLLISION", "The Team tool namespace is already in use");
  const instructions = params.developerInstructions?.includes(GUIDE) ? params.developerInstructions : [params.developerInstructions, GUIDE].filter(Boolean).join("\n\n");
  return { ...params, config: { ...params.config, "features.multi_agent_v2_dynamic_tools": true }, dynamicTools: present ? tools : [...tools, TOOL], developerInstructions: instructions };
}
function isTeamRequest(request) {
  return request?.method === "item/tool/call" && request.params?.namespace === TOOL_NAMESPACE && request.params?.tool === TOOL_NAME;
}
function parentId(thread) {
  return thread?.parentThreadId ?? null;
}
function createTeamRuntimeHost({ readRegistry, readThread, logger, createService = createTeamChangeService, createObserver = createTeamObserver }) {
  const services = new Map(), canonicalServices = new Map(), contexts = new Map();
  let notificationQueue = Promise.resolve();
  let pendingObservations = 0, droppedObservations = 0;
  const MAX_CONTEXTS = 256, MAX_PENDING = 128;
  const safeWarning = code => logger?.warning?.("Team observation is incomplete", { safe: { code }, sensitive: {} });
  async function resolveContext(threadId) {
    if (typeof threadId !== "string" || !threadId) throw problem("INVALID_THREAD", "A native caller thread is required");
    const registry = await readRegistry();
    const teams = registry?.version === 1 && Array.isArray(registry.teams) ? registry.teams.filter(team => team.hostId === "local") : [];
    if (!teams.length) return null;
    let id = threadId, caller = null;
    const visited = new Set();
    while (id && visited.size < 128) {
      if (visited.has(id)) throw problem("ANCESTRY_CYCLE", "Native thread ancestry is cyclic");
      visited.add(id);
      const response = await readThread(id), thread = response?.thread;
      if (!thread || thread.id !== id) throw problem("THREAD_UNAVAILABLE", "Native thread ownership could not be established");
      caller ??= thread;
      const team = teams.find(candidate => candidate.leadId === id || candidate.memberIds?.includes(id));
      if (team) {
        if (typeof caller.cwd !== "string" || !path.isAbsolute(caller.cwd)) throw problem("REPOSITORY_UNAVAILABLE", "Native thread has no absolute repository directory");
        const context = { team, threadId, repoRoot: caller.cwd };
        if (contexts.size >= MAX_CONTEXTS) contexts.delete(contexts.keys().next().value);
        contexts.set(threadId, context);
        return context;
      }
      id = parentId(thread);
    }
    return null;
  }
  async function resources(context) {
    // A Team's service remains tied to the Git common directory selected on first use.
    const key = JSON.stringify([context.team.id, context.repoRoot]);
    if (!services.has(key)) {
      if (services.size >= 64) throw problem("TEAM_CAPACITY", "Too many active Team repository contexts");
      const pending = (async () => {
        let observer;
        const service = createService({ repoRoot: context.repoRoot, teamId: context.team.id,
          isCoordinator: actor => actor === context.team.leadId,
          onTransition: async event => {
            if (observer) {
              const sample = { ...event, utc: event.timestamp, hostId: os.hostname(), platform: process.platform, arch: process.arch, executionKind: "local" };
              // An integration span survives several distinct metadata operations.
              if (sample.spanId) delete sample.operationId;
              const recorded = await observer.record(sample);
              if (!recorded.accepted) throw problem("OBSERVATION_FAILED", "Transition observation was not retained");
            }
          },
        });
        const storageDir = await service.getStorageDir();
        if (canonicalServices.has(storageDir)) return canonicalServices.get(storageDir);
        observer = createObserver({ storageDir: path.join(storageDir, "observations"), teamId: context.team.id });
        const result = { service, observer };
        canonicalServices.set(storageDir, result);
        return result;
      })();
      services.set(key, pending);
      pending.catch(() => { if (services.get(key) === pending) services.delete(key); });
    }
    return services.get(key);
  }
  async function call(request) {
    if (!isTeamRequest(request)) throw problem("UNKNOWN_TOOL", "Not a Team management request");
    const context = await resolveContext(request.params.threadId);
    if (!context) throw problem("NOT_TEAM_MEMBER", "The native caller does not belong to a local Team");
    let input = request.params.arguments;
    if (typeof input === "string") {
      if (input.length > 128 * 1024) throw problem("REQUEST_CAPACITY", "Team request exceeds its capacity");
      try { input = JSON.parse(input); } catch { throw problem("INVALID_ARGUMENTS", "Team arguments must be JSON"); }
    }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["action", "operationId", "args"].includes(key)) || !ACTIONS.includes(input.action)) throw problem("INVALID_ARGUMENTS", "Invalid Team action or fields");
    if (Buffer.byteLength(JSON.stringify(input)) > 128 * 1024) throw problem("REQUEST_CAPACITY", "Team request exceeds its capacity");
    if (COORDINATOR_ACTIONS.has(input.action) && context.threadId !== context.team.leadId) throw problem("COORDINATOR_REQUIRED", "This operation requires the designated Team Lead");
    const { service, observer } = await resources(context);
    if (input.action === "status") return { contract: SCHEMA, state: await service.read(), observation: await observer.summary(), nativeObservation: { droppedEvents: droppedObservations, complete: droppedObservations === 0 }, evidence: "Submitted validation is caller-reported; acceptance is an explicit Lead review. This service does not run tests or modify an active checkout." };
    if (input.action === "observe") {
      if (typeof input.operationId !== "string" || !input.operationId) throw problem("OPERATION_REQUIRED", "Observation requires an operation ID");
      const args = input.args;
      if (!args || Object.keys(args).some(key => !["taskId", "spanId", "phase", "state", "reason", "resourceId"].includes(key)) || !WORKFLOW_PHASES.has(args.phase) || !["start", "end", "blocked", "unblocked", "instant"].includes(args.state)) throw problem("INVALID_OBSERVATION", "Use a workflow phase and bounded identifiers");
      const state = await service.read();
      const tasks = Array.isArray(state.tasks) ? state.tasks : Object.values(state.tasks ?? {});
      const task = tasks.find(item => item.id === args.taskId || item.taskId === args.taskId);
      if (!task || (context.threadId !== context.team.leadId && task.assignedSessionId !== context.threadId)) throw problem("TASK_OWNERSHIP", "Observation requires an assigned task");
      const recorded = await observer.record({ ...args, eventId: "reported:" + crypto.createHash("sha256").update(context.threadId + ":" + input.operationId).digest("hex"), teamId: context.team.id, runId: context.threadId, provider: "caller_reported", hostId: os.hostname(), platform: process.platform, arch: process.arch, executionKind: "local" });
      return { recorded: recorded.accepted === true, reason: recorded.reason, provenance: "caller_reported", health: (await observer.summary()).health };
    }
    const spanId = crypto.randomUUID(), eventId = crypto.randomUUID();
    const timing = { teamId: context.team.id, eventId, spanId, phase: "metadata", state: "start", runId: context.threadId, hostId: os.hostname(), platform: process.platform, arch: process.arch };
    const recordTiming = async sample => { try { const saved = await observer.record(sample); if (!saved.accepted) droppedObservations++; } catch { droppedObservations++; safeWarning("COLLECTION_FAILED"); } };
    await recordTiming(timing);
    const result = await service.dispatch({ action: input.action, operationId: input.operationId, args: input.args ?? {}, actorId: context.threadId });
    await recordTiming({ ...timing, eventId: crypto.randomUUID(), state: "end", outcome: result.ok ? "succeeded" : "failed", reason: result.error?.code });
    return result;
  }
  async function notification(message) {
    const { method, params } = message ?? {};
    if (!["turn/started", "turn/completed", "item/started", "item/completed", "thread/tokenUsage/updated"].includes(method) || typeof params?.threadId !== "string") return;
    const context = contexts.get(params.threadId) ?? await resolveContext(params.threadId);
    if (!context) return;
    const { observer } = await resources(context);
    const base = { teamId: context.team.id, runId: params.threadId, attemptId: params.turnId ?? params.turn?.id, hostId: os.hostname(), platform: process.platform, arch: process.arch, executionKind: "local" };
    if (method.startsWith("turn/")) {
      const turn = params.turn;
      if (!turn?.id) return;
      const metrics = {};
      if (method === "turn/completed") {
        metrics.memoryBytes = process.memoryUsage().rss;
        try { const stats = await fs.statfs(context.repoRoot); metrics.diskFreeBytes = stats.bavail * stats.bsize; } catch { /* Unavailable capacity remains absent. */ }
        await observer.record({ ...base, eventId: "resource:" + crypto.randomUUID(), phase: "collection", state: "instant", metrics });
      }
      await observer.record({ ...base, eventId: method + ":" + params.threadId + ":" + turn.id, spanId: "turn:" + params.threadId + ":" + turn.id, phase: "turn", state: method === "turn/started" ? "start" : "end", outcome: turn.status === "completed" ? "succeeded" : turn.status === "interrupted" ? "cancelled" : turn.status === "failed" ? "failed" : undefined });
    } else if (method.startsWith("item/")) {
      const item = params.item;
      if (!item?.id || !["commandExecution", "dynamicToolCall", "mcpToolCall", "fileChange"].includes(item.type)) return;
      await observer.record({ ...base, eventId: method + ":" + params.threadId + ":" + item.id, spanId: "item:" + params.threadId + ":" + item.id, parentSpanId: base.attemptId ? "turn:" + params.threadId + ":" + base.attemptId : undefined, phase: "tool", state: method === "item/started" ? "start" : "end", outcome: item.status === "failed" || (Number.isInteger(item.exitCode) && item.exitCode !== 0) ? "failed" : method === "item/completed" ? "succeeded" : undefined });
    } else if (method === "thread/tokenUsage/updated") {
      const usage = params.tokenUsage?.total;
      if (!usage || !Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) return;
      const eventId = crypto.createHash("sha256").update(JSON.stringify([params.threadId, params.turnId, usage.inputTokens, usage.outputTokens])).digest("hex");
      await observer.record({ ...base, eventId: "usage:" + eventId, phase: "turn", state: "instant", usageMode: "cumulative", usageCursorId: params.threadId, usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });
    }
  }
  function observeNotification(message) {
    if (pendingObservations >= MAX_PENDING) { droppedObservations++; safeWarning("BUFFER_CAPACITY"); return; }
    pendingObservations++;
    const pending = notificationQueue.then(() => notification(message)).catch(() => { droppedObservations++; safeWarning("COLLECTION_FAILED"); }).finally(() => { pendingObservations--; });
    notificationQueue = pending;
    return pending;
  }
  async function respond(request) {
    try { const result = await call(request); return { success: result?.ok !== false, contentItems: [{ type: "inputText", text: JSON.stringify(result) }] }; }
    catch (error) {
      // Exception strings can contain paths, commands, or credentials. Return only known codes.
      const code = typeof error?.code === "string" && /^[A-Z][A-Z_]{0,63}$/.test(error.code) ? error.code : "TEAM_OPERATION_FAILED";
      logger?.warning?.("Team operation failed", { safe: { code }, sensitive: {} });
      return { success: false, contentItems: [{ type: "inputText", text: JSON.stringify({ error: code }) }] };
    }
  }
  return { call, respond, observeNotification, resolveContext };
}

module.exports = { TOOL, GUIDE, TOOL_NAMESPACE, TOOL_NAME, SCHEMA, addTeamTools, isTeamRequest, createTeamRuntimeHost };
