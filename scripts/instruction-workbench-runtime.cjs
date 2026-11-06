"use strict";
// Native host admission only. Library captures never cross the public RPC boundary.
const MODEL_FIELDS = ["model", "id", "modelProvider", "displayName", "supportedReasoningEfforts", "defaultReasoningEffort"];
function project(value) {
  if (value == null) return null;
  if (typeof value.id !== "string" || !value.id.trim()) throw Error("Native project identity is unavailable");
  return { id: value.id, ...(typeof value.name === "string" ? { name: value.name } : {}), ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}) };
}
class InstructionWorkbenchRuntime {
  constructor({ taskRuntime, capture, workspaceProject, request }) {
    this.taskRuntime = taskRuntime; this.capture = capture; this.workspaceProject = workspaceProject; this.request = request;
  }
  async context() {
    const current = project(await this.workspaceProject());
    const models = (await this.taskRuntime.catalog()).map(model => Object.fromEntries(MODEL_FIELDS.filter(key => model[key] !== undefined).map(key => [key, model[key]])));
    return { project: current, models, hostId: "local" };
  }
  async prepare(hostId, method, params) {
    if (!["turn/start", "thread/queue/add"].includes(method)) return params;
    // Replace untrusted caller refs at every new admission, including default mode.
    const { agentProfile: ignored, ...result } = params;
    // Replies continue the waiting task's snapshot; native keeps that association.
    if (method === "thread/queue/add" && params.kind === "questionReply") return result;
    if (hostId !== "local") return result;
    let current;
    if (typeof params.threadId === "string" && params.threadId) {
      let response;
      try { response = await this.request("thread/read", { threadId: params.threadId, includeTurns: false }); }
      catch { throw Error("Native thread project association is unavailable"); }
      if (!response?.thread || !Object.hasOwn(response.thread, "projectId")) throw Error("Native thread project association is unavailable");
      // Only ordinary Root conversations use the project's active profile.
      // The native owner projects this mode; caller-supplied refs cannot select it.
      if (["team", "role"].includes(response.agentProfileMode)) return result;
      if (response.agentProfileMode !== "direct") throw Error("Native thread profile mode is unavailable");
      current = response.thread.projectId == null ? null : project({ id: response.thread.projectId, cwd: response.thread.cwd });
    } else throw Error("Profile admission requires a native thread identity");
    if (current == null) return result;
    let ref;
    try {
      const capture = await this.capture({ project: current, hostId: "local", threadId: params.threadId, ...(params.model == null ? {} : { model: params.model }) });
      if (capture?.projectId !== current.id) throw Error("Captured profile belongs to another native project");
      if (capture.profile?.allowedRoles && !capture.profile.allowedRoles.includes("root")) throw Error("Ordinary conversations require a Root profile");
      ref = await this.taskRuntime.createWorkbench(capture, { cwd: current.cwd ?? params.cwd ?? null, config: params.config ?? {} });
    } catch {
      // Native/catalog and parsing failures can contain private paths or payloads.
      throw Error("Agent profile preparation failed. Check the active profile and selected model.");
    }
    if (ref != null) result.agentProfile = ref;
    return result;
  }
}
module.exports = { InstructionWorkbenchRuntime };
