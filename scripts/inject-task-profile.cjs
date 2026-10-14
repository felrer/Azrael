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
  let runtime = this.azraelTaskProfileRuntime();
  if (runtime == null && ["thread/resume", "turn/start"].includes(method)) { const home = (await this.readPersistedAtomState())["azrael-task-profile-home-v1"]; if (typeof home === "string") runtime = this.azraelTaskProfileRuntime(home); }
  if (runtime == null) {
    if (params?.__azraelTaskProfileDraft != null) throw Error("Task profile runtime is unavailable");
    return params;
  }
  return runtime.prepare(view, hostId, id, method, params);
}
async function azraelFinishTaskRequest(response) { const runtime = this.azraelTaskProfileRuntime(); return runtime == null ? response : runtime.finish(response); }
const HOST_METHODS = [azraelTaskProfileRuntime, azraelStartTaskProfile, azraelTaskPanelRoute, azraelBindTaskPanel, azraelPrepareTaskRequest, azraelFinishTaskRequest].map(fn => fn.toString().replace(/^(async )?function /, (_, prefix) => prefix ?? "")).join("\n");
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
    ['case"open-vscode-command":{const lead=r.args?.[0];', 'case"open-vscode-command":{if(r.command==="azrael.startTaskProfile")throw Error("Task profile payloads require the host instruction library");if(r.command===Drr)this.azraelTaskProfileRuntime()?.discard(e);const task=r.args?.[0];if(task?.__azraelTaskProfileDraft!=null){if(r.command!==Orr)throw Error("Task transfer requires the native new panel command");const runtime=this.azraelTaskProfileRuntime();if(runtime==null)throw Error("Task transfer runtime unavailable");const token=runtime.transfer(task.__azraelTaskProfileDraft,e,task.project);try{await je.commands.executeCommand(r.command,{__azraelTaskProfileDraft:token})}catch(error){runtime.discard(token);throw error}break}const lead=r.args?.[0];'],
    ['async createNewPanel(azraelOptions){let e=rF(this.azraelLeadPanelRoute(azraelOptions))', HOST_METHODS + 'async createNewPanel(azraelOptions){let e=rF(this.azraelTaskPanelRoute(azraelOptions))'],
    ['registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),await Pe.createNewPanel(be)})', 'registerCommand("azrael.startTaskProfile",(value,home)=>Pe.azraelStartTaskProfile(value,home)),Mt.commands.registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),await Pe.createNewPanel(be)})'],
    ['registerCommand(Drr,async()=>{await Ru(),Pe.triggerNewChatViaWebview()})', 'registerCommand(Drr,async()=>{await Ru(),Pe.azraelTaskProfileRuntime()?.discard(Pe.sidebarView?.webview),Pe.triggerNewChatViaWebview()})'],
    ['this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:', 'this.azraelBindTaskPanel(e.uri,r.webview),this.subscriptions.push(r.onDidDispose(()=>this.azraelTaskProfileRuntime()?.discard(r.webview))),this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:'],
    ['state:azraelDraft==null?r:{...r,__azraelTeamLeadDraft:azraelDraft}', 'state:{...(azraelDraft==null?r:{...r,__azraelTeamLeadDraft:azraelDraft}),__azraelTaskProfileDraft:this.azraelTaskProfileRuntime()?.bootstrap(e)??null}'],
    ['let{id:n,method:o,params:i}=r.request;', 'try{const taskParams=await this.azraelPrepareTaskRequest(e,r.hostId??"local",r.request.id,r.request.method,r.request.params);if(taskParams!==r.request.params)r={...r,request:{...r.request,params:taskParams}}}catch(error){this.postMessageToWebview(e,{type:"mcp-response",hostId:r.hostId??"local",message:{id:r.request.id,error:{code:-32602,message:error instanceof Error?error.message:String(error)}}});break}let{id:n,method:o,params:i}=r.request;'],
    ['try{e=await this.azraelFinishTeamRequest(e)}catch(error)', 'try{e=await this.azraelFinishTeamRequest(e);e=await this.azraelFinishTaskRequest(e)}catch(error)'],
  ];
  const count = token => text.split(token).length - 1;
  const helper = asset === APP_ASSET ? APP_HELPER : asset === BRIDGE_ASSET ? BRIDGE_HELPER : "";
  if (count(MARKER)) { if (count(MARKER) !== 1 || edits.some(([, replacement]) => count(replacement) !== 1) || (helper && count(helper) !== 1)) throw Error("Damaged task profile injection"); return { text, count: 0 }; }
  for (const [anchor, replacement] of edits) { if (count(anchor) !== 1) throw Error(`Pinned task profile anchor changed: ${anchor}`); text = text.replace(anchor, replacement); }
  return { text: text + "\n" + MARKER + "\n" + helper + "\n", count: 1 };
}
module.exports = { TASK_PROFILE_ASSETS, APP_ASSET, HOST_ASSET, BRIDGE_ASSET, MARKER, APP_HELPER, BRIDGE_HELPER, HOST_METHODS, injectTaskProfile };
