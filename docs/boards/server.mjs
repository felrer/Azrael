import { createServer } from 'node:http';
import { readFile, mkdir, appendFile, lstat, realpath } from 'node:fs/promises';
import { resolve, dirname, join, extname, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { BoardError, validateDefinition } from './shared/model.mjs';
import { BoardStorage, atomicWrite } from './shared/storage.mjs';
import { sketchCodec } from './shared/sketch-context.mjs';
import { catalogCodec } from './shared/catalog-context.mjs';

const boardsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(boardsRoot, '../..');
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
export async function createBoardServer({ board = 'prototype', dataRoot, configPath, port = 0, publicRoot } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(board)) throw new BoardError('보드 이름을 확인하세요.');
  const boardRoot = join(boardsRoot, board);
  if ((await lstat(boardRoot)).isSymbolicLink()) throw new BoardError('보드 경로를 확인하세요.');
  const definitionSource = await readFile(join(boardRoot, 'board.json'), 'utf8');
  const definition = validateDefinition(JSON.parse(definitionSource));
  if (definition.editor !== undefined && !['excalidraw', 'catalog'].includes(definition.editor)) throw new BoardError('지원하지 않는 편집기입니다.');
  const sketch = definition.editor === 'excalidraw', codec = sketch ? sketchCodec : definition.editor === 'catalog' ? catalogCodec : undefined;
  const assetOwner = resolve(projectRoot, 'artifacts/boards/sketch');
  if (sketch && !publicRoot) {
    try { publicRoot = JSON.parse(await readFile(join(assetOwner, 'current.json'), 'utf8')).publicRoot; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (publicRoot) {
    publicRoot = resolve(publicRoot);
    if (!publicRoot.startsWith(assetOwner + sep) || !(await realpath(publicRoot)).startsWith((await realpath(assetOwner)) + sep)) throw new BoardError('편집기 빌드 경로를 확인하세요.');
  }
  if (definition.id !== board) throw new BoardError('폴더 이름과 보드 id를 맞추세요.');
  const rules = await readFile(join(boardRoot, definition.rules), 'utf8');
  if (rules.length > 200000 || definitionSource.length > 200000) throw new BoardError('양식과 지침 파일 크기를 줄이세요.');
  if (!dataRoot && configPath) {
    try { const config = JSON.parse(await readFile(configPath, 'utf8')); dataRoot = config.root; }
    catch (error) { if (error.code !== 'ENOENT') throw new BoardError('저장 위치 설정을 읽을 수 없습니다.', 'INVALID_CONFIG', 422); }
  }
  dataRoot ||= join(projectRoot, 'artifacts/board-data', board);
  let storage = await new BoardStorage({ root: dataRoot, definition, definitionSource, rules, codec }).init();
  const token = randomBytes(32).toString('hex');
  let origin, mutations = Promise.resolve(), saturated = new Set();
  async function log(level, event, requestId, details = {}) {
    const path = join(storage.root, 'board.log');
    try {
      const info = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('UNSAFE_LOG_PATH');
      if (info?.size >= 2 * 1024 * 1024) {
        if (!saturated.has(path)) { saturated.add(path); process.stderr.write(JSON.stringify({ level: 'warn', event: 'log.limit', message: '로그 용량 한도에 도달했습니다.' }) + '\n'); }
        return;
      }
      await appendFile(path, JSON.stringify({ time: new Date().toISOString(), level, component: 'boards', event, requestId, version: 'prototype-1', platform: process.platform, ...details }) + '\n', { mode: 0o600 });
    } catch { process.stderr.write(JSON.stringify({ level: 'error', event: 'log.write_failed', requestId }) + '\n'); }
  }
  function respond(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  async function payload(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new BoardError('JSON 요청만 지원합니다.', 'CONTENT_TYPE', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > (sketch ? 32 : 2) * 1024 * 1024) throw new BoardError('요청이 너무 큽니다.', 'BODY_TOO_LARGE', 413); chunks.push(chunk); }
    // Decode a complete buffer so split UTF-8 bytes cannot change Korean input.
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new BoardError('요청 내용을 읽을 수 없습니다.', 'INVALID_JSON', 400); }
  }
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(), started = Date.now();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(origin).host) throw new BoardError('로컬 서버 주소로 접속하세요.', 'HOST_DENIED', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new BoardError('이 화면에서 보드에 접근할 수 없습니다.', 'ORIGIN_DENIED', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new BoardError('외부 페이지에서 접근할 수 없습니다.', 'ORIGIN_DENIED', 403);
      const url = new URL(req.url, origin), path = url.pathname;
      if (path === '/api/session' && req.method === 'GET') return respond(res, 200, { token });
      if (path === '/api/state' && req.method === 'GET') return respond(res, 200, await storage.state());
      const actions = ['/api/save', '/api/backup', '/api/restore', '/api/storage', '/api/export'];
      if (actions.includes(path)) {
        if (req.method !== 'POST') throw new BoardError('POST 요청이 필요합니다.', 'METHOD_DENIED', 405);
        if (req.headers['x-board-token'] !== token) throw new BoardError('화면을 새로고침하고 다시 시도하세요.', 'TOKEN_DENIED', 403);
        const body = await payload(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BoardError('요청 형식을 확인하세요.');
        const execute = async () => {
          if (req.headers['x-board-storage'] !== encodeURIComponent(storage.root)) throw new BoardError('다른 화면에서 저장 위치가 바뀌었습니다. 편집 내용을 보존하고 최신 설정을 확인하세요.', 'STORAGE_CHANGED', 409);
          if (path === '/api/save') return storage.save(body.document, body.expectedRevision);
          if (path === '/api/backup') return storage.backup(body.expectedRevision);
          if (path === '/api/restore') return storage.restore(body.backupId, body.expectedRevision);
          if (path === '/api/export') return storage.export(body.expectedRevision, body.itemIds, { previewImage: body.previewImage });
          if (typeof body.root !== 'string' || !isAbsolute(body.root) || body.root.length > 4096) throw new BoardError('저장 위치는 절대 경로로 입력하세요.');
          const next = await new BoardStorage({ root: body.root, definition, definitionSource, rules, codec }).init();
          const state = await next.state();
          if (configPath) { await mkdir(dirname(configPath), { recursive: true }); await atomicWrite(configPath, JSON.stringify({ root: next.root }, null, 2) + '\n'); }
          storage = next; return state;
        };
        const pending = mutations.then(execute); mutations = pending.catch(() => {});
        const result = await pending;
        await log('info', path.slice(5) + '.succeeded', requestId, { durationMs: Date.now() - started, revision: result.document.revision });
        return respond(res, 200, result);
      }
      if (path.startsWith('/api/')) throw new BoardError('요청 경로를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new BoardError('지원하지 않는 요청입니다.', 'METHOD_DENIED', 405);
      if (path === '/') { res.writeHead(302, { Location: `/${board}/` }); res.end(); return; }
      let target, allowedRoot;
      if (sketch && path.startsWith(`/${board}/assets/`)) {
        if (!publicRoot) throw new BoardError('편집기를 준비하세요: docs/boards/sketch에서 npm ci 후 npm run build를 실행하세요.', 'EDITOR_NOT_BUILT', 503);
        target = resolve(publicRoot, decodeURIComponent(path.slice(`/${board}/assets/`.length)));
        allowedRoot = publicRoot;
        if (!target.startsWith(publicRoot + sep) || !['.js', '.css', '.woff2', '.png', '.svg'].includes(extname(target))) throw new BoardError('파일 경로를 확인하세요.', 'NOT_FOUND', 404);
      } else if (path.startsWith(`/${board}/`)) {
        const relative = decodeURIComponent(path.slice(board.length + 2)) || 'index.html';
        if (sketch && !['index.html', 'board.json', 'rules.md'].includes(relative)) throw new BoardError('화면 파일을 찾을 수 없습니다.', 'NOT_FOUND', 404);
        if (sketch && publicRoot && relative === 'index.html') { target = join(publicRoot, 'index.html'); allowedRoot = publicRoot; }
        else { target = resolve(boardRoot, relative); allowedRoot = boardRoot; }
        if (!target.startsWith(allowedRoot + sep) || !mime[extname(target)]) throw new BoardError('파일 경로를 확인하세요.', 'NOT_FOUND', 404);
      } else if (['/shared/model.mjs', '/shared/ui.mjs', '/shared/board.css', '/shared/sketch-model.mjs', '/shared/catalog-model.mjs',
        '/shared/modules/folder-list.mjs', '/shared/modules/card-browser.mjs', '/shared/modules/catalog-widgets.css'].includes(path)) {
        if (sketch && publicRoot && ['/shared/model.mjs', '/shared/sketch-model.mjs'].includes(path)) { target = join(publicRoot, path.slice('/shared/'.length)); allowedRoot = publicRoot; }
        else { target = join(boardsRoot, path.slice(1)); allowedRoot = join(boardsRoot, 'shared'); }
      }
      else throw new BoardError('화면 경로를 찾을 수 없습니다.', 'NOT_FOUND', 404);
      const resolvedTarget = await realpath(target);
      if (!resolvedTarget.startsWith((await realpath(allowedRoot)) + sep)) throw new BoardError('파일 경로를 확인하세요.', 'NOT_FOUND', 404);
      const content = await readFile(target);
      res.writeHead(200, { 'Content-Type': mime[extname(target)] }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const known = error instanceof BoardError, missing = error.code === 'ENOENT';
      const status = known ? error.status : missing ? 404 : 500;
      const code = known ? error.code : missing ? 'NOT_FOUND' : 'IO_FAILURE';
      await log(status >= 500 ? 'error' : 'warn', 'request.failed', requestId, { code, status, durationMs: Date.now() - started, errorType: error.name, causeCode: /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : undefined });
      if (!res.headersSent) respond(res, status, { error: known ? error.message : missing ? '파일을 찾을 수 없습니다.' : '파일 작업을 완료하지 못했습니다. 원본과 편집 내용을 보존하고 저장 위치와 로그를 확인하세요.', code, requestId });
      else res.end();
    }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  origin = `http://127.0.0.1:${server.address().port}`;
  await log('info', 'server.started', randomUUID(), { port: server.address().port });
  return { server, origin, token, get storage() { return storage; },
    async close() { await mutations; await log('info', 'server.stopped', randomUUID()); server.closeAllConnections(); await new Promise(done => server.close(done)); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = { board: 'prototype', port: 4318 };
  for (let i = 0; i < args.length; i += 2) {
    if (!['--board', '--port', '--data-root'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node docs/boards/server.mjs [--board name] [--port number] [--data-root absolute-path]');
    const key = { '--board': 'board', '--port': 'port', '--data-root': 'dataRoot' }[args[i]];
    options[key] = key === 'port' ? Number(args[i + 1]) : args[i + 1];
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port must be between 1 and 65535.');
  options.configPath = join(projectRoot, 'artifacts/board-storage', options.board + '.json');
  const app = await createBoardServer(options);
  process.stdout.write(`보드 실행: ${app.origin}/\n저장 위치: ${app.storage.root}\n종료: Ctrl+C\n`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
}
