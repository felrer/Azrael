"use strict";

const fs = require("node:fs");
const path = require("node:path");
const REGISTRY_KEY = "azrael-team-registry-v1";
const APP_ASSET = "webview/assets/app-initial-97d3534ad35f.js";
const HOST_ASSET = "out/extension.js";
const BRIDGE_ASSET = "webview/assets/app-initial-c014f9ee4429.js";
const TEAM_RUNTIME_ASSETS = [APP_ASSET, HOST_ASSET, BRIDGE_ASSET];
const MARKER = "/*azrael-team-runtime-v1*/";
function readLeadInstructions(root = path.resolve(__dirname, "..")) {
  const base = path.join(root, "instructions/skills/design-collaboration");
  return [fs.readFileSync(path.join(base, "SKILL.md"), "utf8"), fs.readFileSync(path.join(base, "references/team-lead.md"), "utf8")].join("\n\n");
}
function appendLeadInstructions(existing, guidance, leadId = null) {
  const role = leadId == null ? "This explicitly user-created native root session is the Team Lead." : `This native session ${leadId} is the explicitly designated Team Lead.`;
  return [existing, role + " Descendant sessions do not receive the Lead role by inheriting this text.", guidance].filter(value => typeof value === "string" && value.length).join("\n\n");
}
function normalizeRegistry(value) {
  const teams = value?.version === 1 && Array.isArray(value.teams) ? value.teams : [];
  return { version: 1, teams: teams.filter(t => t && typeof t.id === "string" && typeof t.hostId === "string" && typeof t.leadId === "string" && Array.isArray(t.memberIds)).map(t => ({ id: t.id, hostId: t.hostId, leadId: t.leadId, memberIds: [...new Set([t.leadId, ...t.memberIds.filter(x => typeof x === "string")])] })) };
}
function teamId(hostId, leadId) { return "azrael-team:" + JSON.stringify([hostId, leadId]); }
function registerLead(value, hostId, leadId) {
  if (typeof hostId !== "string" || !hostId || typeof leadId !== "string" || !leadId) throw new Error("Native host and Lead IDs are required");
  const registry = normalizeRegistry(value), id = teamId(hostId, leadId);
  if (!registry.teams.some(t => t.id === id)) registry.teams.push({ id, hostId, leadId, memberIds: [leadId] });
  return registry;
}
function descendantQuery(params, leadId, cursor = null) {
  const { sourceKinds, ancestorThreadId, parentThreadId, originators, ...preserved } = params;
  return { ...preserved, ancestorThreadId: leadId, modelProviders: [], cursor };
}
function mergeDescendants(value, hostId, leadId, threads) {
  const registry = normalizeRegistry(value), team = registry.teams.find(t => t.hostId === hostId && t.leadId === leadId);
  if (team) team.memberIds = [...new Set([team.leadId, ...team.memberIds, ...threads.map(t => t.id).filter(id => typeof id === "string")])];
  return registry;
}
const CREATE_ANCHOR = "m={response:await this.params.requestClient.sendRequest(h.method,h.request,{...h.options,onOutcomeUnknown:n})";
const CREATE_PATCH = "m={response:await azraelSendLeadDraft(this.params.requestClient,h.method,h.request,this.params.hostId,{...h.options,onOutcomeUnknown:n},e)";
const BRIDGE_HELPER = `globalThis.__azraelBeginTeamLeadDraft=async function(){const draft=await mg(\`azrael-team-lead-draft\`,{params:{action:\`begin\`}});if(typeof draft?.token!==\`string\`)throw Error(\`Lead draft was not established\`);globalThis.__azraelPendingTeamLeadDraft={...draft,awaitingNativeNewChat:true}};globalThis.__azraelCancelTeamLeadDraft=async function(){globalThis.__azraelPendingTeamLeadDraft=null;await mg(\`azrael-team-lead-draft\`,{params:{action:\`cancel\`}})};function azraelLeadNewChatTransition(){const draft=globalThis.__azraelPendingTeamLeadDraft;if(draft==null)return;if(draft.awaitingNativeNewChat){draft.awaitingNativeNewChat=false;draft.nativeDraft=true}else globalThis.__azraelPendingTeamLeadDraft=null}function azraelLeadProject(scope,activeProject){const draft=globalThis.__azraelPendingTeamLeadDraft;if(draft?.nativeDraft&&!draft.transferred){draft.project=activeProject===void 0?scope.get(jy):dP(activeProject)}}function azraelLeadCommandArgs(){const draft=globalThis.__azraelPendingTeamLeadDraft;if(draft?.nativeDraft&&!draft.transferred){draft.transferred=true;return[{__azraelTeamLeadDraft:draft.token,project:draft.project??null}]}return[]}globalThis.addEventListener?.(\`message\`,event=>{const data=event.data;if(data?.type!==\`persisted-atom-sync\`)return;const draft=data.state?.__azraelTeamLeadDraft;if(typeof draft?.token===\`string\`){const current=globalThis.__azraelPendingTeamLeadDraft;if(current==null||current.token===draft.token)globalThis.__azraelPendingTeamLeadDraft={...draft,nativeDraft:true}}});`;
const APP_HELPER = `function azraelClaimLeadDraft(method,request,hostId,input){const draft=globalThis.__azraelPendingTeamLeadDraft;if(draft?.nativeDraft!==true)return request;if(draft.claimed||draft.failed||draft.transferred)throw Error(\`Lead draft requires New Lead to be selected again after the previous submission or transfer\`);if(method!==\`thread/start\`||hostId!==\`local\`)throw Error(\`Team Lead transport is unavailable for this native start\`);const assignment=input?.projectAssignment,project=assignment==null?null:{type:assignment.projectKind,projectId:assignment.projectId};if(JSON.stringify(project)!==JSON.stringify(draft.project??null))throw Error(\`Lead draft belongs to another native project\`);draft.claimed=true;return{...request,__azraelTeamLeadDraft:{token:draft.token,project,cwd:request.cwd,workspaceRoots:input?.workspaceRoots}}}async function azraelSendLeadDraft(client,method,request,hostId,options,input){const draft=globalThis.__azraelPendingTeamLeadDraft;try{const response=await client.sendRequest(method,azraelClaimLeadDraft(method,request,hostId,input),options);if(draft?.claimed&&globalThis.__azraelPendingTeamLeadDraft===draft)globalThis.__azraelPendingTeamLeadDraft=null;return response}catch(error){if(draft?.nativeDraft)draft.failed=true;throw error}}`;
function hostHelpers(guidance) {
  return `const AZRAEL_TEAM_REGISTRY_KEY=${JSON.stringify(REGISTRY_KEY)},AZRAEL_LEAD_GUIDANCE=${JSON.stringify(guidance)};${appendLeadInstructions.toString()}${normalizeRegistry.toString()}${teamId.toString()}${registerLead.toString()}${descendantQuery.toString()}${mergeDescendants.toString()}`;
}
const FETCH_ANCHOR = "handleVSCodeRequest(e,r,n){let o=()=>this.handlers[e]";
const FETCH_PATCH = "handleVSCodeRequest(e,r,n){if(e===\"azrael-team-lead-draft\")return this.azraelTeamLeadDraft(r,n?.originWebview);let o=()=>this.handlers[e]";
function azraelDiscardLeadDraft(view) {
  const draft = this.azraelLeadDrafts?.get(view);
  if (draft) this.azraelLeadTransfers?.delete(draft.token);
  this.azraelLeadDrafts?.delete(view);
}
function azraelDiscardLeadTransfer(token) {
  const transfer = this.azraelLeadTransfers?.get(token);
  if (transfer) {
    this.azraelLeadDrafts?.delete(transfer.origin);
    if (transfer.view) this.azraelLeadDrafts?.delete(transfer.view);
  }
  this.azraelLeadTransfers?.delete(token);
}
async function azraelTeamLeadDraft(params, view) {
  if (view == null) throw Error("Lead draft requires its origin view");
  this.azraelLeadDrafts ??= new WeakMap;
  if (params?.action === "cancel") { this.azraelDiscardLeadDraft(view); return { success: true }; }
  if (params?.action !== "begin") throw Error("Unknown Lead draft action");
  this.azraelDiscardLeadDraft(view);
  const project = await this.getWorkspaceProject(), token = require("node:crypto").randomUUID();
  this.azraelLeadDrafts.set(view, { token, projectId: project?.id ?? null });
  return { token };
}
async function azraelTransferLeadDraft(token, view, project) {
  const draft = this.azraelLeadDrafts?.get(view), workspace = await this.getWorkspaceProject();
  if (draft == null || draft.token !== token || draft.transferred || draft.projectId !== (workspace?.id ?? null)) throw Error("Lead draft transfer does not belong to this origin and project");
  if (project != null && (project.type !== "local" || typeof project.projectId !== "string")) throw Error("Lead draft requires a local native project");
  draft.project = project ?? null; draft.transferred = true;
  this.azraelLeadTransfers ??= new Map;
  this.azraelLeadTransfers.set(token, { draft, origin: view });
}
function azraelLeadPanelRoute(options) {
  const token = options?.__azraelTeamLeadDraft;
  if (token == null) return "/extension/panel/new";
  const transfer = this.fetchWrapper.extensionFetchHandler.azraelLeadTransfers?.get(token);
  if (transfer == null || transfer.uri != null) throw Error("Lead panel transfer is unavailable");
  const route = "/extension/panel/new?azraelLeadDraft=" + encodeURIComponent(token);
  transfer.uri = rF(route).toString();
  return route;
}
function azraelBindLeadPanel(uri, view) {
  const token = new URLSearchParams(uri.query).get("azraelLeadDraft");
  if (token == null) return;
  const transfer = this.azraelLeadTransfers?.get(token);
  if (transfer == null || transfer.uri !== uri.toString() || transfer.bound) throw Error("Lead panel token does not belong to this native view");
  transfer.bound = true;
  transfer.view = view;
  this.azraelLeadDrafts.delete(transfer.origin);
  this.azraelLeadDrafts.set(view, { ...transfer.draft, transferred: false, bootstrapSent: false });
}
function azraelLeadDraftBootstrap(view) {
  const draft = this.azraelLeadDrafts?.get(view);
  if (draft == null || draft.transferred || draft.bootstrapSent || !Object.hasOwn(draft, "project")) return null;
  draft.bootstrapSent = true;
  return { token: draft.token, project: draft.project };
}
async function azraelConsumeLeadDraft(marker, view, params) {
  const draft = this.azraelLeadDrafts?.get(view), project = await this.getWorkspaceProject();
  if (draft == null || draft.token !== marker?.token || draft.transferred || draft.projectId !== (project?.id ?? null)) throw Error("Lead draft no longer belongs to this project and view");
  if (JSON.stringify(marker.project ?? null) !== JSON.stringify(draft.project ?? null) || marker.cwd !== params.cwd) throw Error("Lead submission changed its native project or directory");
  this.azraelDiscardLeadDraft(view);
}
const FETCH_METHODS = [azraelTeamLeadDraft, azraelDiscardLeadDraft, azraelDiscardLeadTransfer, azraelTransferLeadDraft, azraelBindLeadPanel, azraelLeadDraftBootstrap, azraelConsumeLeadDraft].map(fn => fn.toString().replace(/^(async )?function /, (_, asyncPart) => asyncPart ?? "")).join("\n");

const NEW_PANEL_ANCHOR = 'async createNewPanel(){let e=rF("/extension/panel/new"),r=je.window.activeTextEditor?.viewColumn??je.ViewColumn.Active;await je.commands.executeCommand("vscode.openWith",e,t.customEditorViewType,{viewColumn:r,preserveFocus:!1,preview:!1})}';
const NEW_PANEL_PATCH = 'async createNewPanel(azraelOptions){let e=rF(this.azraelLeadPanelRoute(azraelOptions)),r=je.window.activeTextEditor?.viewColumn??je.ViewColumn.Active;try{await je.commands.executeCommand("vscode.openWith",e,t.customEditorViewType,{viewColumn:r,preserveFocus:!1,preview:!1})}catch(error){this.fetchWrapper.extensionFetchHandler.azraelDiscardLeadTransfer(azraelOptions?.__azraelTeamLeadDraft);throw error}}';
const OPEN_COMMAND_ANCHOR = 'case"open-vscode-command":{je.commands.executeCommand(r.command,...r.args??[]);break}';
const OPEN_COMMAND_PATCH = 'case"open-vscode-command":{const lead=r.args?.[0];if(lead?.__azraelTeamLeadDraft!=null){try{if(r.command!==Orr)throw Error("Lead creation requires the native new panel command");await this.fetchWrapper.extensionFetchHandler.azraelTransferLeadDraft(lead.__azraelTeamLeadDraft,e,lead.project);await je.commands.executeCommand(r.command,...r.args??[])}catch(error){await je.window.showErrorMessage("Unable to open the Lead draft. Select New Lead again.");throw error}}else je.commands.executeCommand(r.command,...r.args??[]);break}';
const PANEL_BIND_ANCHOR = 'this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:i==null||o.path.startsWith("/local/")?o.path:`/local/${i}`})';
const PANEL_BIND_PATCH = 'this.fetchWrapper.extensionFetchHandler.azraelBindLeadPanel(e.uri,r.webview),this.subscriptions.push(r.onDidDispose(()=>this.fetchWrapper.extensionFetchHandler.azraelDiscardLeadDraft(r.webview))),this.editorPanels.set(r,{ready:!1,pendingMessages:[],initialRoute:i==null||o.path.startsWith("/local/")?o.path:`/local/${i}`})';
const PANEL_COMMAND_ANCHOR = 'registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),Pe.createNewPanel()})';
const PANEL_COMMAND_PATCH = 'registerCommand(Orr,async be=>{be?.source===Lrr&&await d.update(Re.SHOW_COPILOT_LOGIN_FIRST,!0),await Pe.createNewPanel(be)})';
const SYNC_ANCHOR = 'this.postMessageToWebview(e,{type:"persisted-atom-sync",state:r})';
const SYNC_PATCH = 'const azraelDraft=this.fetchWrapper.extensionFetchHandler.azraelLeadDraftBootstrap(e);this.postMessageToWebview(e,{type:"persisted-atom-sync",state:azraelDraft==null?r:{...r,__azraelTeamLeadDraft:azraelDraft}})';

const REQUEST_ANCHOR = "let{id:n,method:o,params:i}=r.request;";
const REQUEST_PATCH = "try{const azraelParams=await this.azraelPrepareTeamRequest(e,r.hostId??\"local\",r.request.id,r.request.method,r.request.params);if(azraelParams!==r.request.params)r={...r,request:{...r.request,params:azraelParams}}}catch(error){this.postMessageToWebview(e,{type:\"mcp-response\",hostId:r.hostId??\"local\",message:{id:r.request.id,error:{code:-32602,message:error instanceof Error?error.message:String(error)}}});break}let{id:n,method:o,params:i}=r.request;";
const RESPONSE_ANCHOR = "deliverMcpResponseToOrigin(e){let r=String(e.id),n=this.pendingMcpRequests.get(r);";
const RESPONSE_PATCH = "async deliverMcpResponseToOrigin(e){try{e=await this.azraelFinishTeamRequest(e)}catch(error){e={id:e.id,error:{code:-32603,message:error instanceof Error?error.message:String(error)}}}let r=String(e.id),n=this.pendingMcpRequests.get(r);";
const HOST_METHODS = `async azraelPrepareTeamRequest(view,hostId,id,method,params){if(params?.__azraelTeamLeadDraft==null&&method!=="thread/resume"&&!(method==="thread/list"&&params?.__azraelWorkspaceThreadList))return params;let registry=null;if(method==="thread/resume")registry=normalizeRegistry((await this.readPersistedAtomState())[AZRAEL_TEAM_REGISTRY_KEY]);let lead=false;if(params?.__azraelTeamLeadDraft!=null){if(method!=="thread/start"||hostId!=="local")throw Error("Invalid native Lead request");await this.fetchWrapper.extensionFetchHandler.azraelConsumeLeadDraft(params.__azraelTeamLeadDraft,view,params);const{__azraelTeamLeadDraft:_,...native}=params;params={...native,developerInstructions:appendLeadInstructions(native.developerInstructions,AZRAEL_LEAD_GUIDANCE)};lead=true}else if(method==="thread/resume"&&registry.teams.some(t=>t.hostId===hostId&&t.leadId===params?.threadId)){params={...params,developerInstructions:appendLeadInstructions(params.developerInstructions,AZRAEL_LEAD_GUIDANCE,params.threadId)}}if(lead||method==="thread/list"&&params?.__azraelWorkspaceThreadList){this.azraelTeamRequests??=new Map;this.azraelTeamRequests.set(String(id),{hostId,lead,params,method})}return params}async azraelFinishTeamRequest(response){const pending=this.azraelTeamRequests?.get(String(response.id));if(pending==null)return response;this.azraelTeamRequests.delete(String(response.id));if(response.error||response.result==null)return response;const nativeResponse=response;this.azraelTeamWriteQueue??=Promise.resolve();const operation=this.azraelTeamWriteQueue.then(async()=>{let registry=normalizeRegistry((await this.readPersistedAtomState())[AZRAEL_TEAM_REGISTRY_KEY]);if(pending.lead){registry=registerLead(registry,pending.hostId,response.result.thread.id)}else{const data=[...response.result.data],ids=new Set(data.map(t=>t.id));for(const team of registry.teams.filter(t=>t.hostId===pending.hostId)){let cursor=null;const cursors=new Set,descendants=[];do{const query=descendantQuery(pending.params,team.leadId,cursor);delete query.__azraelWorkspaceThreadList;const roots=await this.fetchWrapper.extensionFetchHandler.getWorkspaceRoots();if(roots.length)query.cwd=roots;const page=await this.fetchWrapper.extensionFetchHandler.sendInternalAppServerRequest("thread/list",query);descendants.push(...page.data);cursor=page.nextCursor;if(cursor!=null&&cursors.has(cursor))throw Error("Repeated native descendant cursor");cursors.add(cursor)}while(cursor!=null);registry=mergeDescendants(registry,pending.hostId,team.leadId,descendants);for(const thread of descendants)if(!ids.has(thread.id)){ids.add(thread.id);data.push(thread)}}response={...response,result:{...response.result,data,__azraelTeamMemberIds:registry.teams.filter(t=>t.hostId===pending.hostId).flatMap(t=>t.memberIds)}}}await this.globalState.updatePersistedAtomValue(AZRAEL_TEAM_REGISTRY_KEY,registry);return response});this.azraelTeamWriteQueue=operation.then(()=>{},()=>{});return operation.catch(error=>{if(pending.lead)throw error;this.logger.warning("Team descendants could not be loaded",{safe:{hostId:pending.hostId},sensitive:{error:error instanceof Error?error.message:String(error)}});return nativeResponse})}`;
function injectTeamRuntime(text, asset) {
  if (!TEAM_RUNTIME_ASSETS.includes(asset)) return { text, count: 0 };
  const helpers = asset === APP_ASSET ? APP_HELPER : asset === BRIDGE_ASSET ? BRIDGE_HELPER : hostHelpers(readLeadInstructions());
  const namespace = text.includes("command:a?`azrael.newChat`:`azrael.newCodexPanel`") ? "azrael" : "chatgpt";
  const nativeCommand = "vm.dispatchMessage(`open-vscode-command`,{command:a?`" + namespace + ".newChat`:`" + namespace + ".newCodexPanel`})";
  const edits = asset === APP_ASSET ? [
    [CREATE_ANCHOR, CREATE_PATCH],
    ["return{...a,data:a.data.filter(bxn)}}async hydrateThreads", "return{...a,data:a.data.filter(e=>bxn(e)||a.__azraelTeamMemberIds?.includes(e.id))}}async hydrateThreads"],
  ] : asset === BRIDGE_ASSET ? [
    ["function mg(...e){let[t,n]=e,{params:r,select:i,signal:a,source:o,responsePriority:s}=n??{};return A5e(t,r,i,a,o,s)}", "function mg(...e){let[t,n]=e,{params:r,select:i,signal:a,source:o,responsePriority:s}=n??{};return A5e(t,r,i,a,o,s)}"],
    ["function TB(e,t){let{activeProject:n", "function TB(e,t){azraelLeadNewChatTransition();let{activeProject:n"],
    ["freshDraft:l,...u}=t??{},d=Date.now()", "freshDraft:l,...u}=t??{};azraelLeadProject(e,n);let d=Date.now()"],
    [nativeCommand, nativeCommand.slice(0, -2) + ",args:azraelLeadCommandArgs()})"],
  ] : [
    [FETCH_ANCHOR, FETCH_PATCH], ["handleVSCodeRequest(e,r,n){", FETCH_METHODS + "handleVSCodeRequest(e,r,n){"],
    [REQUEST_ANCHOR, REQUEST_PATCH], [RESPONSE_ANCHOR, HOST_METHODS + RESPONSE_PATCH],
    [NEW_PANEL_ANCHOR, azraelLeadPanelRoute.toString().replace("function ", "") + NEW_PANEL_PATCH],
    [OPEN_COMMAND_ANCHOR, OPEN_COMMAND_PATCH], [PANEL_BIND_ANCHOR, PANEL_BIND_PATCH],
    [PANEL_COMMAND_ANCHOR, PANEL_COMMAND_PATCH], [SYNC_ANCHOR, SYNC_PATCH],
  ];
  const count = token => text.split(token).length - 1;
  if (count(MARKER)) {
    if (count(MARKER) !== 1 || count(helpers) !== 1 || edits.some(([, replacement]) => count(replacement) !== 1)) throw Error("Damaged Team runtime injection");
    return { text, count: 0 };
  }
  for (const [anchor, replacement] of edits) {
    if (count(anchor) !== 1) throw Error(`Pinned Team runtime anchor changed: ${anchor}`);
    text = text.replace(anchor, replacement);
  }
  return { text: text + "\n" + MARKER + "\n" + helpers + "\n", count: 1 };
}
module.exports = { REGISTRY_KEY, TEAM_RUNTIME_ASSETS, APP_ASSET, HOST_ASSET, BRIDGE_ASSET, MARKER, readLeadInstructions, appendLeadInstructions, normalizeRegistry, teamId, registerLead, descendantQuery, mergeDescendants, injectTeamRuntime };
