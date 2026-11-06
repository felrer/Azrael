"use strict";
const { APP_ASSET, HOST_ASSET, BRIDGE_ASSET } = require("./inject-team-runtime.cjs");
const TASK_PROFILE_ASSETS = [APP_ASSET, HOST_ASSET, BRIDGE_ASSET];
const MARKER = "/*azrael-task-profile-v1*/";
const APP_HELPER = `globalThis.addEventListener?.("message",event=>{if(event.data?.type==="new-chat")globalThis.__azraelPendingTaskProfile=null;const marker=event.data?.type==="persisted-atom-sync"?event.data.state?.__azraelTaskProfileDraft:null;if(marker?.token)globalThis.__azraelPendingTaskProfile={token:marker.token}});async function azraelSendTaskDraft(client,method,request,hostId,options,input){const draft=globalThis.__azraelPendingTaskProfile;if(draft==null)return azraelSendLeadDraft(client,method,request,hostId,options,input);if(draft.claimed||method!=="thread/start"||hostId!=="local")throw Error("Task profile requires its selected new local conversation");draft.claimed=true;const assignment=input?.projectAssignment,project=assignment==null?null:{type:assignment.projectKind,projectId:assignment.projectId};try{const result=await azraelSendLeadDraft(client,method,{...request,__azraelTaskProfileDraft:{token:draft.token,project}},hostId,options,input);globalThis.__azraelPendingTaskProfile=null;return result}catch(error){throw error}}`;
const BRIDGE_HELPER = `function azraelTaskProject(scope,activeProject){const draft=globalThis.__azraelPendingTaskProfile;if(draft&&!draft.claimed&&!draft.transferred)draft.project=activeProject===void 0?scope.get(jy):dP(activeProject)}function azraelTaskCommandArgs(args,startInSidebar){const draft=globalThis.__azraelPendingTaskProfile;if(draft==null)return args;if(startInSidebar){globalThis.__azraelPendingTaskProfile=null;return args}if(draft.claimed||draft.transferred)throw Error("Task draft transfer is already used");if(args?.[0]?.__azraelTeamLeadDraft)throw Error("Task and Team drafts cannot share a panel transfer");draft.transferred=true;return[{__azraelTaskProfileDraft:draft.token,project:draft.project??null}]}`;
function azraelTaskProfileRuntime(codexHome) {
  if (this.azraelTaskRuntime != null) {
    if (codexHome != null && this.azraelTaskHome !== codexHome) throw Error("Task runtime home changed");
    return this.azraelTaskRuntime;
  }
  const home = codexHome ?? this.azraelTaskHome;
  if (home == null) return null;
  const { TaskProfileRuntime } = require(require("node:path").join(__dirname, "../account-ui/task-profile-runtime.cjs"));
  this.azraelTaskHome = home;
  this.azraelTaskRuntime = new TaskProfileRuntime({ codexHome: home, request: (method, params) => this.fetchWrapper.extensionFetchHandler.sendInternalAppServerRequest(method, params) });
  return this.azraelTaskRuntime;
}
async function azraelStartTaskProfile(value, home) {
  const runtime = this.azraelTaskProfileRuntime(home);
  const draft = await runtime.create(value);
  await this.globalState.updatePersistedAtomValue("azrael-task-profile-home-v1", home);
  try { await this.createNewPanel({ __azraelTaskProfileDraft: draft.token }); }
  catch (error) { runtime.discard(draft.token); throw error; }
  return { opened: true, profileId: draft.profileId, model: draft.model };
}
function azraelTaskPanelRoute(options) {
  if (options?.__azraelTaskProfileDraft == null) return this.azraelLeadPanelRoute(options);
  const token = options.__azraelTaskProfileDraft, runtime = this.azraelTaskProfileRuntime();
  if (!runtime?.drafts.has(token)) throw Error("Task profile panel token unavailable");
  const draft = runtime.drafts.get(token);
  if (draft.uri != null) throw Error("Task profile panel token already transferred");
  const route = "/extension/panel/new?azraelTaskProfile=" + encodeURIComponent(token);
  draft.uri = rF(route).toString(); return route;
}
function azraelBindTaskPanel(uri, view) {
  const token = new URLSearchParams(uri.query).get("azraelTaskProfile"); if (token == null) return;
  const runtime = this.azraelTaskProfileRuntime();
  if (runtime?.drafts.get(token)?.uri !== uri.toString()) throw Error("Task profile panel URI changed");
  runtime.bind(token, view);
}
async function azraelPrepareTaskRequest(view, hostId, id, method, params) {
  if (method === "thread/start" && params != null && Object.hasOwn(params, "agentProfile")) { const { agentProfile: ignored, ...clean } = params; params = clean; }
  let runtime = this.azraelTaskProfileRuntime();
  if (runtime == null && ["thread/start", "thread/resume", "turn/start", "thread/queue/add"].includes(method)) { const home = (await this.readPersistedAtomState())["azrael-task-profile-home-v1"] ?? process.env.CODEX_HOME; if (typeof home === "string") runtime = this.azraelTaskProfileRuntime(home); }
  if (runtime == null) {
    if (params?.__azraelTaskProfileDraft != null) throw Error("Task profile runtime is unavailable");
    if (["thread/start", "turn/start", "thread/queue/add"].includes(method) && hostId === "local") throw Error("Native profile CODEX_HOME is unavailable");
    return params;
  }
  const legacy = params?.__azraelTaskProfileDraft != null || (hostId === "local" && ["thread/resume", "turn/start", "thread/queue/add"].includes(method) && typeof params?.threadId === "string" && (await runtime.registry()).threads[params.threadId] != null);
  if (legacy && Object.hasOwn(params, "agentProfile")) { const { agentProfile: ignored, ...clean } = params; params = clean; }
  let prepared = await runtime.prepare(view, hostId, id, method, params);
  if (method === "thread/start") {
    const { RoleProfileRuntime } = require(require("node:path").join(__dirname, "../account-ui/role-profile-runtime.cjs"));
    const teamRequest = this.azraelTeamRequests?.get(String(id));
    const roleRuntime = new RoleProfileRuntime({ capture: mode => Mt.commands.executeCommand("azrael.captureRoleProfile", { mode }), materializeProfile: (capture, options) => runtime.createWorkbench(capture, options), createTeamConfiguration: async (capture, common) => {
      const policy = await Mt.commands.executeCommand("azrael.prepareTeamProfile", capture, common);
      if (teamRequest) teamRequest.configurationPath = policy.configuration_path;
      return policy;
    } });
    const teamCapture = teamRequest?.profileConfiguration;
    prepared = await roleRuntime.prepare(hostId, method, prepared, teamCapture);
  }
  if (legacy) return prepared;
  if (!["turn/start", "thread/queue/add"].includes(method)) return prepared;
  return (await this.azraelWorkbenchRuntime()).prepare(hostId, method, prepared);
}
async function azraelWorkbenchRuntime() {
  if (this.azraelWorkbench != null) return this.azraelWorkbench;
  const home = (await this.readPersistedAtomState())["azrael-task-profile-home-v1"] ?? process.env.CODEX_HOME;
  if (typeof home !== "string" || !require("node:path").isAbsolute(home)) throw Error("Native profile CODEX_HOME is unavailable");
  const { InstructionWorkbenchRuntime } = require(require("node:path").join(__dirname, "../account-ui/instruction-workbench-runtime.cjs"));
  const handler = this.fetchWrapper.extensionFetchHandler;
  this.azraelWorkbench = new InstructionWorkbenchRuntime({ taskRuntime: this.azraelTaskProfileRuntime(home), workspaceProject: () => handler.getWorkspaceProject(), request: (method, params) => handler.sendInternalAppServerRequest(method, params), capture: value => Mt.commands.executeCommand("azrael.captureWorkbenchProfile", value) });
  return this.azraelWorkbench;
}
async function azraelWorkbenchContext() { return (await this.azraelWorkbenchRuntime()).context(); }
function azraelWorkbenchContextChanged(message) {
  if (message?.type !== "global-state-updated" || !Array.isArray(message.keys) || !message.keys.some(key => key === Re.LOCAL_PROJECTS || key === Re.SELECTED_PROJECT)) return;
  // Reuse the native project owner's invalidation event; the receiving service
  // re-reads live context rather than trusting a message's project payload.
  Mt.commands.executeCommand("azrael.workbenchContextChanged").then(undefined, () => console.warn("Agent profile project context refresh failed"));
}
async function azraelFinishTaskRequest(response) { const runtime = this.azraelTaskProfileRuntime(); return runtime == null ? response : runtime.finish(response); }
const HOST_METHODS = [azraelTaskProfileRuntime, azraelStartTaskProfile, azraelTaskPanelRoute, azraelBindTaskPanel, azraelPrepareTaskRequest, azraelFinishTaskRequest, azraelWorkbenchRuntime, azraelWorkbenchContext, azraelWorkbenchContextChanged].map(fn => fn.toString().replace(/^(async )?function /, (_, prefix) => prefix ?? "")).join("\n");
// This transform intentionally runs AFTER injectTeamRuntime. Pinned anchors keep
// Team creation and its authoritative guidance in the same transport chain.
function injectTaskProfile(text, asset) {
  if (!TASK_PROFILE_ASSETS.includes(asset)) return { text, count: 0 };
  const edits = asset === APP_ASSET ? [
    ["azraelSendLeadDraft(this.params.requestClient,h.method,h.request,this.params.hostId", "azraelSendTaskDraft(this.params.requestClient,h.method,h.request,this.params.hostId"],
  ] : asset === BRIDGE_ASSET ? [
    ['azraelLeadProject(e,n);', 'azraelLeadProject(e,n);azraelTaskProject(e,n);'],
    ['args:azraelLeadCommandArgs()', 'args:azraelTaskCommandArgs(azraelLeadCommandArgs(),a)'],
  ] : [
    ['broadcastToAllViews(e,r){let n=this.sidebarView?.webview;', 'broadcastToAllViews(e,r){this.azraelWorkbenchContextChanged(e);let n=this.sidebarView?.webview;'],
    ['case"open-vscode-command":{const lead=r.args?.[0];', 'case"open-vscode-command":{if(["azrael.startTaskProfile","azrael.captureWorkbenchProfile","azrael.workbenchContext","azrael.workbenchContextChanged","azrael.captureRoleProfile","azrael.materializeAgentProfile","azrael.roleProfileSettings","azrael.prepareTeamProfile","azrael.attachTeamProfile","azrael.discardTeamProfile"].includes(r.command))throw Error("Task profile commands require the native host");if(r.command===Drr)this.azraelTaskProfileRuntime()?.discard(e);const task=r.args?.[0];if(task?.__azraelTaskProfileDraft!=null){if(r.command!==Orr)throw Error("Task transfer requires the native new panel command");const runtime=this.azraelTaskProfileRuntime();if(runtime==null)throw Error("Task transfer runtime unavailable");const token=runtime.transfer(task.__azraelTaskProfileDraft,e,task.project);try{await je.commands.executeCommand(r.command,{__azraelTaskProfileDraft:token})}catch(error){runtime.discard(token);throw error}break}const lead=r.args?.[0];'],
    ['async createNewPanel(azraelOptions){let e=rF(this.azraelLeadPanelRoute(azraelOptions))', HOST_METHODS + 'async createNewPanel(azraelOptions){let e=rF(this.azraelTaskPanelRoute(azraelOptions))'],
    ['registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),await Pe.createNewPanel(be)})', 'registerCommand("azrael.workbenchContext",()=>Pe.azraelWorkbenchContext()),Mt.commands.registerCommand("azrael.materializeAgentProfile",async(capture,options)=>{await Pe.azraelWorkbenchRuntime();return Pe.azraelTaskProfileRuntime().createWorkbench(capture,options)}),Mt.commands.registerCommand("azrael.startTaskProfile",(value,home)=>Pe.azraelStartTaskProfile(value,home)),Mt.commands.registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),await Pe.createNewPanel(be)})'],
    ['registerCommand(Drr,async()=>{await Ru(),Pe.triggerNewChatViaWebview()})', 'registerCommand(Drr,async()=>{await Ru(),Pe.azraelTaskProfileRuntime()?.discard(Pe.sidebarView?.webview),Pe.triggerNewChatViaWebview()})'],
    ['this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:', 'this.azraelBindTaskPanel(e.uri,r.webview),this.subscriptions.push(r.onDidDispose(()=>this.azraelTaskProfileRuntime()?.discard(r.webview))),this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:'],
    ['state:azraelDraft==null?r:{...r,__azraelTeamLeadDraft:azraelDraft}', 'state:{...(azraelDraft==null?r:{...r,__azraelTeamLeadDraft:azraelDraft}),__azraelTaskProfileDraft:this.azraelTaskProfileRuntime()?.bootstrap(e)??null}'],
    ['let{id:n,method:o,params:i}=r.request;', 'try{const taskParams=await this.azraelPrepareTaskRequest(e,r.hostId??"local",r.request.id,r.request.method,r.request.params);if(taskParams!==r.request.params)r={...r,request:{...r.request,params:taskParams}}}catch(error){try{await this.azraelDiscardPreparedTeamRequest(r.request.id)}catch(cleanupError){error=new Error(String(error)+"; Team configuration cleanup failed: "+String(cleanupError))}this.postMessageToWebview(e,{type:"mcp-response",hostId:r.hostId??"local",message:{id:r.request.id,error:{code:-32602,message:error instanceof Error?error.message:String(error)}}});break}let{id:n,method:o,params:i}=r.request;'],
    ['try{e=await this.azraelFinishTeamRequest(e)}catch(error)', 'try{e=await this.azraelFinishTeamRequest(e);e=await this.azraelFinishTaskRequest(e)}catch(error)'],
  ];
  const count = token => text.split(token).length - 1;
  const helper = asset === APP_ASSET ? APP_HELPER : asset === BRIDGE_ASSET ? BRIDGE_HELPER : "";
  if (count(MARKER)) { if (count(MARKER) !== 1 || edits.some(([, replacement]) => count(replacement) !== 1) || (helper && count(helper) !== 1)) throw Error("Damaged task profile injection"); return { text, count: 0 }; }
  for (const [anchor, replacement] of edits) { if (count(anchor) !== 1) throw Error(`Pinned task profile anchor changed: ${anchor}`); text = text.replace(anchor, replacement); }
  return { text: text + "\n" + MARKER + "\n" + helper + "\n", count: 1 };
}
module.exports = { TASK_PROFILE_ASSETS, APP_ASSET, HOST_ASSET, BRIDGE_ASSET, MARKER, APP_HELPER, BRIDGE_HELPER, HOST_METHODS, injectTaskProfile };
