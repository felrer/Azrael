'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const readline = require('node:readline');
const { StringDecoder } = require('node:string_decoder');
const { TOOLS } = require('./window-control-policy.cjs');
const { windowError, expectedError, errorPayload, fromPayload } = require('./window-control-errors.cjs');
function parseThreadMetadata(meta) {
  const hasHeader = meta && Object.hasOwn(meta, 'x-codex-turn-metadata');
  let value = meta?.['x-codex-turn-metadata'];
  if (hasHeader) {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw expectedError('Trusted Codex turn metadata required'); } }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw expectedError('Trusted Codex turn metadata required');
  }
  const threadId = hasHeader ? value.thread_id : meta?.threadId;
  if (threadId === undefined && !hasHeader) throw expectedError('Trusted Codex turn metadata required');
  if (typeof threadId !== 'string' || !/^(?:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|[A-Za-z0-9_-]{32,128})$/.test(threadId)) throw expectedError('Invalid trusted thread identifier');
  if (meta.threadId !== undefined && meta.threadId !== threadId) throw expectedError('Conflicting trusted thread identifier');
  return threadId;
}
function relayMetadata(meta) {
  parseThreadMetadata(meta);
  const sandboxState = meta?.['codex/sandbox-state-meta'];
  const permissionProfile = sandboxState?.permissionProfile;
  if (!sandboxState || typeof sandboxState !== 'object' || Array.isArray(sandboxState) || !Object.hasOwn(sandboxState, 'permissionProfile') || !permissionProfile || typeof permissionProfile !== 'object' || Array.isArray(permissionProfile) || !Object.hasOwn(permissionProfile, 'type') || permissionProfile.type !== 'disabled' || Object.keys(permissionProfile).some(key => key !== 'type')) throw expectedError('Native Disabled permission profile required');
  const selected = {};
  selected['codex/sandbox-state-meta'] = { permissionProfile: { type: 'disabled' } };
  if (Object.hasOwn(meta, 'threadId')) selected.threadId = meta.threadId;
  if (Object.hasOwn(meta, 'x-codex-turn-metadata')) {
    const nested = typeof meta['x-codex-turn-metadata'] === 'string' ? JSON.parse(meta['x-codex-turn-metadata']) : meta['x-codex-turn-metadata'];
    const trusted = { thread_id: nested.thread_id };
    for (const key of ['turn_id']) {
      if (Object.hasOwn(nested, key)) {
        if (typeof nested[key] !== 'string' || !nested[key].length || nested[key].length > 256 || /[\x00-\x1f]/.test(nested[key])) throw expectedError('Invalid native turn context');
        trusted[key] = nested[key];
      }
    }
    selected['x-codex-turn-metadata'] = trusted;
  }
  return selected;
}
function toolDefinitions() {
  const selector = {type:'object',properties:{name:{type:'string'},automationId:{type:'string'},controlType:{type:'string'}},anyOf:[{required:['name']},{required:['automationId']}],additionalProperties:false};
  const fullSelector = {...selector,properties:{...selector.properties,ancestor:selector}};
  const parameter = {type:'object',properties:{parameter:{type:'string'}},required:['parameter'],additionalProperties:false};
  const condition = {type:'object',properties:{selector:fullSelector,property:{enum:['exists','enabled','value','selected','toggleState','expandState']},equals:{anyOf:[{type:'string'},{type:'boolean'},parameter]}},required:['selector','property','equals'],additionalProperties:false};
  condition.allOf = [{if:{properties:{property:{enum:['exists','enabled','selected']}}},then:{properties:{equals:{type:'boolean'}}}}];
  const definition = {type:'object',properties:{schema:{const:1},id:{type:'string'},name:{type:'string'},parameters:{type:'array',items:{type:'string'},uniqueItems:true,maxItems:32},steps:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{action:{enum:['invoke','set_value','toggle','select','expand','collapse','scroll','press_key','wait_for','assert','capture']},selector:fullSelector,value:{anyOf:[{type:'string',maxLength:32768},parameter,{type:'object',properties:{horizontal:{type:'integer',minimum:-2,maximum:2},vertical:{type:'integer',minimum:-2,maximum:2}},required:['horizontal','vertical'],additionalProperties:false}]},key:{enum:require('./window-task-macros.cjs').KEYS},condition,postcondition:condition,timeoutMs:{type:'integer',minimum:0,maximum:10000}},required:['action'],additionalProperties:false}}},required:['schema','steps'],additionalProperties:false};
  const discovery = ['list_windows','select_window','list_task_macros','save_task_macro'];
  const definitions = TOOLS.map(name => {
    const properties = discovery.includes(name) ? {} : {targetId:{type:'string',description:'Opaque selected target ID from select_window or status.'}};
    const required = discovery.includes(name) || name === 'status' ? [] : ['targetId'];
    if(['invoke','set_value','toggle','select','expand','collapse','scroll','press_key'].includes(name)) {
      properties.observationId = {type:'string'}; properties.elementId = {type:'string'}; required.push('observationId','elementId');
      if(name === 'set_value' || name === 'scroll') {properties.value = name === 'scroll' ? {type:'object',properties:{horizontal:{type:'integer',minimum:-2,maximum:2},vertical:{type:'integer',minimum:-2,maximum:2}},required:['horizontal','vertical'],additionalProperties:false} : {type:'string',maxLength:32768}; required.push('value');}
      if(name === 'press_key') {properties.key = {enum:require('./window-task-macros.cjs').KEYS};required.push('key');}
    }
    if(name === 'select_window') {properties.candidateId = {type:'string'};required.push('candidateId');}
    if(name === 'save_task_macro') {properties.definition = {...definition,required:['schema','id','name','steps']};required.push('definition');}
    if(name === 'run_task_macro') {properties.definition = definition;properties.macroId = {type:'string'};properties.parameters = {type:'object',additionalProperties:{type:'string',maxLength:32768}};}
    if(name === 'resize') {properties.widthDip = {type:'number',minimum:100,maximum:8192};properties.heightDip = {type:'number',minimum:100,maximum:8192};required.push('widthDip','heightDip');}
    if(name === 'run_size_macro') {properties.macroId = {type:'string'};required.push('macroId');}
    const descriptions = {
      list_windows:'Discover opaque candidates and advisory session occupancy for this thread. Defer selection/control if another session occupies the window or occupancy is unknown. Refresh invalidates earlier candidate IDs. No targetId needed.',
      select_window:'Select a candidate from the latest list_windows. Requests application approval and revalidates exact identity. No targetId needed.',
      status:'Call with {} to discover whether this thread is unbound and obtain the selected targetId and fresh advisory occupancy. Refresh before each action or macro; defer if occupied by another session or unknown.',
      inspect:'Inspect current UI Automation elements and states without a screenshot. Returns fresh observationId and element IDs.',
      press_key:'Send one supported key to the selected window through window messages. Delivery is unverified; inspect and assert its effect. Requires a fresh observation.',
      list_task_macros:'List saved task definitions and storage revision. No targetId needed.',
      save_task_macro:'Save a schema 1 task definition with stable id/name. Use parameter references for runtime values; never save secrets, element IDs, coordinates or native code. No targetId needed.',
      run_task_macro:'Run either definition or macroId using an immutable snapshot and string parameters. Maximum 32 steps, 20 seconds total, waits at most 10 seconds. Selectors match exact name or automationId and optional controlType/ancestor, uniquely resolved afresh each step. wait_for/assert need condition; press_key requires explicit postcondition. Unsupported state is an error. Stops on cancellation, revoked permission, changed identity, failed/unknown mutation; never replays. Returns per-step outcomes and final capture when feasible.'
    };
    const inputSchema = {type:'object',properties,required,additionalProperties:false};
    if(name === 'run_task_macro') inputSchema.oneOf = [{required:['definition'],not:{required:['macroId']}},{required:['macroId'],not:{required:['definition']}}];
    return {name,description:descriptions[name] || `Background selected-window ${name}. Requires selection and application approval. Paused windows require user resume. Inspect or capture before each element action.`,inputSchema};
  });
  definitions.push({name:'ui_operation',description:'Complete a prepared application UI operation for the authenticated thread.',inputSchema:{type:'object',properties:{requestToken:{type:'string',pattern:'^[a-fA-F0-9]{64}$',minLength:64,maxLength:64}},required:['requestToken'],additionalProperties:false},_meta:{ui:{visibility:['app']}}});
  return definitions;
}
function pipeRequest(pipe, message, { connect = net.createConnection, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(pipe); const decoder = new StringDecoder('utf8'); let buffer = ''; let receivedBytes = 0; let settled = false; let stage = 'connection';
    const finish = (error, result) => { if (settled) return; settled = true; socket.destroy(); error ? reject(error) : resolve(result); };
    const uncertainty = () => stage === 'running' && ['invoke','set_value','toggle','select','expand','collapse','scroll','press_key','resize','run_size_macro','run_task_macro','ui_operation'].includes(message.tool) ? { mutationOutcome: 'unknown' } : {};
    const timeout = () => windowError(stage === 'approval' ? 'approval_timeout' : 'timeout', stage === 'approval' ? '승인 응답을 아직 받지 못해 대기 시간이 초과됐습니다.' : stage === 'queued' ? '앞선 Window Use 작업을 기다리다 시간이 초과됐습니다.' : 'Window Use 호스트의 응답 대기 시간이 초과됐습니다.', { stage, ...uncertainty() });
    socket.setTimeout(timeoutMs, () => finish(timeout()));
    socket.on('connect', () => { stage = 'queued'; socket.write(JSON.stringify(message) + '\n'); });
    socket.on('error', e => finish(windowError('connection_error', stage === 'connection' ? 'Window Use 호스트에 연결하지 못했습니다.' : 'Window Use 호스트 연결에 오류가 발생했습니다.', { stage, cause: e, ...uncertainty() })));
    const closed = () => finish(stage === 'approval' ? timeout() : windowError('connection_error', 'Window Use 호스트 연결이 응답 전에 종료됐습니다.', { stage, ...uncertainty() }));
    socket.on('end', closed); socket.on('close', closed);
    socket.on('data', data => {
      receivedBytes += data.length; if (receivedBytes > 32 * 1024 * 1024) return finish(windowError('unclassified', '', { stage }));
      buffer += decoder.write(data);
      while (!settled) {
        const newline = buffer.indexOf('\n'); if (newline < 0) return;
        let result;
        try { result = JSON.parse(buffer.slice(0, newline)); } catch (cause) { return finish(windowError('unclassified', '', { stage, cause })); }
        buffer = buffer.slice(newline + 1);
        if (result?.progress && ['queued', 'running', 'approval'].includes(result.progress.stage)) { stage = result.progress.stage; continue; }
        if (!result || typeof result !== 'object' || (!Object.hasOwn(result, 'result') && !Object.hasOwn(result, 'error'))) return finish(windowError('unclassified', '', { stage }));
        if (result.error) finish(fromPayload(result.error)); else finish(null, result.result);
      }
    });
  });
}
function createRelay({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), request = pipeRequest, readFile = fs.readFile } = {}) {
  return async (threadId, tool, args, meta) => {
    // The model cannot choose the session path; only validated native turn metadata can.
    parseThreadMetadata({ 'x-codex-turn-metadata': { thread_id: threadId } });
    const trustedMeta = relayMetadata(meta);
    if (meta !== undefined && parseThreadMetadata(meta) !== threadId) throw expectedError('Conflicting trusted thread identifier');
    let session;
    try { const raw = await readFile(path.join(codexHome, 'azrael', 'computer-use', 'window-sessions', threadId + '.json'), 'utf8'); if (raw.length > 16384) throw windowError('unclassified', ''); session = JSON.parse(raw); } catch (cause) { if (cause.code === 'ENOENT') throw windowError('selection_required', 'No selected-window session for this thread', { stage: 'session' }); throw windowError('unclassified', '', { stage: 'session', cause }); }
    if (!session || session.schema !== 1 || Object.keys(session).some(k => !['schema', 'pipe', 'nonce'].includes(k)) || typeof session.pipe !== 'string' || !/^\\\\\.\\pipe\\azrael-window-[A-Za-z0-9_-]{16,128}$/.test(session.pipe) || typeof session.nonce !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(session.nonce)) throw expectedError('Invalid selected-window session');
    return request(session.pipe, { nonce: session.nonce, threadId, method: 'call', tool, arguments: args, _meta: trustedMeta });
  };
}
function callResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw expectedError('Invalid host result');
  const occupancy = value => require('./window-control-occupancy.cjs').publicOccupancy(value);
  function observation(value) {
    const projected = {};
    if(value.occupancy) projected.occupancy = occupancy(value.occupancy);
    for(const key of ['targetId','state','supportedActions','observationId','frameTimestamp','widthPx','heightPx','dpi','observationRequired','delivery','verified','experimental','elementsTruncated']) if(Object.hasOwn(value,key)) projected[key] = value[key];
    if(value.window) projected.window = Object.fromEntries(['title','widthPx','heightPx','dpi','minimized'].filter(k => Object.hasOwn(value.window,k)).map(k => [k,value.window[k]]));
    if(Array.isArray(value.elements)) projected.elements = value.elements.map(e => Object.fromEntries(['id','name','controlType','patterns','automationId','parentId','enabled','isPassword','value','selected','toggleState','expandState'].filter(k => Object.hasOwn(e,k) && !(k === 'value' && e.isPassword)).map(k => [k,e[k]])));
    return projected;
  }
  const text = observation(result);
  if(Array.isArray(result.candidates)) text.candidates = result.candidates.map(c => ({candidateId:c.candidateId,appName:c.appName,title:c.title,minimized:c.minimized,...(c.occupancy ? {occupancy:occupancy(c.occupancy)} : {})}));
  if(Array.isArray(result.macros)) text.macros = result.schema === 1 ? result.macros.map(m => require('./window-task-macros.cjs').definition(m,true)) : result.macros.map(m => ({id:m.id,name:m.name,steps:m.steps.map(s => ({widthDip:s.widthDip,heightDip:s.heightDip}))}));
  for(const key of ['schema','revision','runId','status','macroId','error']) if(Object.hasOwn(result,key)) text[key] = result[key];
  if(result.definition) text.definition = require('./window-task-macros.cjs').definition(result.definition,true);
  if(Array.isArray(result.steps)) text.steps = result.steps.map(s => ({index:s.index,action:s.action,status:s.status}));
  if(result.finalObservation) text.finalObservation = observation(result.finalObservation);
  const content = [{type:'text',text:JSON.stringify(text)}];
  const image = result.image || result.finalObservation?.image;
  if(image) {if(image.mimeType !== 'image/png' || typeof image.data !== 'string') throw expectedError('Invalid capture image');content.push({type:'image',mimeType:'image/png',data:image.data});}
  return {content,isError:result.status === 'failed'};
}
function createProtocol({ relay = createRelay() } = {}) {
  return async message => {
    const id = message?.id;
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'Invalid JSON-RPC request' } };
    if (id === undefined) return null;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: message.params?.protocolVersion || '2024-11-05', capabilities: { tools: {}, experimental: { 'codex/sandbox-state-meta': {} } }, serverInfo: { name: 'azrael-selected-window', version: '1.0.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: toolDefinitions() };
    else if (message.method === 'tools/call') {
      try {
        const params = message.params; if (!params || (!TOOLS.includes(params.name) && params.name !== 'ui_operation')) throw expectedError('Unsupported selected-window tool');
        const args = params.arguments || {}; const definition = toolDefinitions().find(t => t.name === params.name);
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !Object.hasOwn(definition.inputSchema.properties, k)) || definition.inputSchema.required.some(k => !Object.hasOwn(args, k))) throw expectedError('Invalid tool arguments');
        if (params.name === 'ui_operation' && (typeof args.requestToken !== 'string' || !/^[a-fA-F0-9]{64}$/.test(args.requestToken))) throw expectedError('Invalid prepared UI request token');
        const threadId = parseThreadMetadata(params._meta);
        const trustedMeta = relayMetadata(params._meta);
        result = callResult(await relay(threadId, params.name, args, trustedMeta));
      } catch (e) { result = { content: [{ type: 'text', text: JSON.stringify(errorPayload(e)) }], isError: true }; }
    } else return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
    return { jsonrpc: '2.0', id, result };
  };
}
async function runProtocol({ input = process.stdin, output = process.stdout, protocol = createProtocol() } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let response;
    try { response = await protocol(JSON.parse(line)); } catch { response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }; }
    if (response) output.write(JSON.stringify(response) + '\n');
  }
}
module.exports = { parseThreadMetadata, relayMetadata, toolDefinitions, pipeRequest, createRelay, callResult, createProtocol, runProtocol };
if (require.main === module) runProtocol().catch(() => { process.exitCode = 1; });
