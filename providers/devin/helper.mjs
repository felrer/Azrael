import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { AdapterError, compileRequest, mapStream, MAX_BYTES, MAX_REQUEST_BYTES, fail } from './mapping.mjs';
import { createProgressMonitor } from './progress.mjs';
import { observeParser } from './stall-diagnostics.mjs';
import { httpStatus, providerClassificationCode, safeProviderDiagnostics, transportErrorCode } from './diagnostics.mjs';

let requestId = '';
let sequence = 0;
let totalOutput = 0;
let progress;
let deadlineSignal;
let activeCredential;
function emit(frame) {
  if (frame.type === 'completed' || frame.type === 'error') {
    if (progress) frame = { ...frame, progress: progress.snapshot() };
    progress?.stop();
  }
  const line = JSON.stringify({ protocol_version: 1, request_id: requestId, seq: sequence++, ...frame }) + '\n';
  totalOutput += Buffer.byteLength(line);
  if (Buffer.byteLength(line) > MAX_BYTES || totalOutput > 16 * 1024 * 1024) fail('output_limit');
  const flushed = process.stdout.write(line);
  progress?.noteOutput({ bytes: Buffer.byteLength(line),
    backpressured: !flushed });
}
async function readInput() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) fail('request_limit');
    chunks.push(chunk);
  }
  const lines = Buffer.concat(chunks).toString('utf8').trimEnd().split('\n');
  if (lines.length !== 2) fail('invalid_frame_count');
  return lines.map(line => JSON.parse(line));
}
try {
  const [init, request] = await readInput();
  requestId = request.request_id;
  if (init.type !== 'init' || init.protocol_version !== 1 || init.request_id !== requestId ||
      typeof init.credential?.api_key !== 'string' || !init.credential.api_key) fail('invalid_init');
  activeCredential = init.credential.api_key;
  if (request.type === 'capabilities') {
    // Model capability discovery for the native catalog. Only model ids and
    // booleans cross the boundary; an empty catalog is a failure, not "none".
    const { getCachedCatalog } = await import('./vendor/src/adapters/devin/cloud-direct/catalog.ts');
    const entry = await getCachedCatalog(init.credential.api_key, init.credential.api_server_url, AbortSignal.timeout(15_000));
    if (!entry || entry.byUid.size === 0) fail('capabilities_unavailable');
    const image_model_ids = [...entry.byUid.values()]
      .filter(model => model.supportsImages && /^[A-Za-z0-9._-]{1,128}$/.test(model.modelUid))
      .map(model => model.modelUid).sort();
    emit({ type: 'capabilities', image_model_ids });
  } else {
    const credentialScope = createHash('sha256').update(init.credential.api_key + '\x1f' + init.credential.api_server_url).digest('hex');
    const compiled = compileRequest({ ...request, credential_scope: credentialScope });
    const { streamChatEvents } = await import('./vendor/src/adapters/devin/cloud-direct/chat.ts');
    progress = createProgressMonitor(emit, { bufferedBytes: () => process.stdout.writableLength, transportEnabled: true });
    deadlineSignal = AbortSignal.timeout(900_000);
    const events = streamChatEvents({
      apiKey: init.credential.api_key, apiServerUrl: init.credential.api_server_url,
      modelUid: request.model, messages: compiled.messages, tools: compiled.tools,
      cascadeId: request.thread_id, signal: deadlineSignal,
      // The native engine owns catalog resolution. Each helper is short-lived,
      // so transport-local caching would otherwise fetch again on every turn.
      skipCatalogPreflight: true,
      onProgress: event => progress.observe(event),
    });
    await mapStream(observeParser(events, progress.transport), compiled, emit, requestId);
  }
} catch (error) {
  // Provider errors may contain request data or authentication details. Only
  // enumerated codes/reasons, validated trace IDs and numeric status cross
  // the boundary; the original provider message never does.
  progress?.transport?.error('map', error, deadlineSignal);
  const local = error instanceof AdapterError && /^[a-z_]{3,64}$/.test(error.message) ? error.message : undefined;
  const status = httpStatus(error);
  const diagnostics = safeProviderDiagnostics(error, activeCredential);
  if (local && error.diagnostics) {
    for (const field of ['history_type', 'last_event']) {
      const value = error.diagnostics[field];
      if (typeof value === 'string' && /^[a-z_]{1,64}$/.test(value)) diagnostics[field] = value;
    }
    const count = error.diagnostics.event_count;
    if (Number.isSafeInteger(count) && count >= 0) diagnostics.event_count = count;
    const finishReason = error.diagnostics.finish_reason;
    if (['stop', 'tool_calls', 'length', 'content_filter'].includes(finishReason)) {
      diagnostics.finish_reason = finishReason;
    }
    const stopReason = error.diagnostics.provider_stop_reason;
    if (Number.isInteger(stopReason) && stopReason >= 0 && stopReason <= 13) {
      diagnostics.provider_stop_reason = stopReason;
    }
    const pendingCount = error.diagnostics.pending_tool_count;
    if (Number.isSafeInteger(pendingCount) && pendingCount >= 0) {
      diagnostics.pending_tool_count = pendingCount;
    }
    if (typeof error.diagnostics.active_tool_call === 'boolean') {
      diagnostics.active_tool_call = error.diagnostics.active_tool_call;
    }
  }
  const transport = transportErrorCode(error);
  if (transport) diagnostics.transport_error = transport;
  if (status !== undefined) diagnostics.http_status = status;
  const classification = error?.classification;
  if (classification === 'usage_limit' || classification === 'rate_limit') {
    diagnostics.provider_classification = classification;
  }
  const timeoutCode = deadlineSignal?.aborted ? 'provider_request_deadline'
    : error?.code === 'headers_timeout' ? 'provider_headers_timeout'
    : error?.code === 'stream_idle_timeout' ? 'provider_stream_idle' : undefined;
  emit({ type: 'error', code: timeoutCode ?? local ?? providerClassificationCode(error)
    ?? (status ? `provider_http_${status}` : 'provider_failure'),
    ...(Object.keys(diagnostics).length ? { diagnostics } : {}) });
  process.exitCode = 1;
} finally {
  progress?.stop();
}
if (process.stdout.writableNeedDrain) await once(process.stdout, 'drain');
