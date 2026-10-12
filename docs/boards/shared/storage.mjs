import { mkdir, readFile, writeFile, rename, unlink, open, lstat, readdir, stat } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BoardError, createDocument, validateDocument } from './model.mjs';
import { createHandoff, json, digest } from './context.mjs';

async function regular(path) {
  try { const info = await lstat(path); if (info.isSymbolicLink() || !info.isFile()) throw new BoardError('저장소에 일반 파일이 아닌 경로가 있습니다.', 'UNSAFE_PATH', 409); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function directory(path) {
  await mkdir(path, { recursive: true });
  if ((await lstat(path)).isSymbolicLink() || !(await stat(path)).isDirectory()) throw new BoardError('저장 폴더 경로를 확인하세요.', 'UNSAFE_PATH', 409);
}
export async function atomicWrite(path, content) {
  await regular(path);
  const temporary = path + '.' + randomUUID() + '.tmp';
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function revision(current, expected) {
  if (!Number.isSafeInteger(expected) || expected !== current.revision) throw new BoardError('다른 화면에서 저장된 값이 있습니다. 편집 내용을 보존한 뒤 최신 자료를 불러오세요.', 'REVISION_CONFLICT', 409);
}
function backupId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new BoardError('백업 식별자를 확인하세요.');
  return value;
}
export class BoardStorage {
  constructor({ root, definition, definitionSource, rules, codec = { createDocument, validateDocument, createHandoff } }) {
    if (!isAbsolute(root)) throw new BoardError('저장 위치는 절대 경로로 입력하세요.');
    this.root = resolve(root); this.definition = definition; this.definitionSource = definitionSource; this.rules = rules; this.codec = codec;
    this.path = join(this.root, 'document.json'); this.backupDirectory = join(this.root, 'backups'); this.exportDirectory = join(this.root, 'handoffs');
  }
  async init() {
    await directory(this.root); await directory(this.backupDirectory); await directory(this.exportDirectory);
    // Test writes before accepting a storage location. Existing data is never reset.
    const probe = join(this.root, '.probe-' + randomUUID());
    await writeFile(probe, '', { flag: 'wx', mode: 0o600 }); await unlink(probe);
    await this.read(); return this;
  }
  async read() {
    if (!await regular(this.path)) return { document: this.codec.createDocument(this.definition), source: null };
    const source = await readFile(this.path, 'utf8');
    let data;
    try { data = JSON.parse(source); } catch { throw new BoardError('저장 파일을 읽을 수 없습니다. 원본은 보존되어 있습니다.', 'CORRUPT_DOCUMENT', 422); }
    return { document: this.codec.validateDocument(data, this.definition), source };
  }
  async locked(action) {
    const lockPath = join(this.root, '.write.lock');
    let handle;
    try { handle = await open(lockPath, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new BoardError('저장소에서 다른 작업이 진행 중이거나 중단된 작업의 잠금이 남아 있습니다.', 'STORAGE_BUSY', 409); throw error; }
    try { await handle.writeFile(json({ pid: process.pid, createdAt: new Date().toISOString() })); return await action(); }
    finally { await handle.close(); await unlink(lockPath); }
  }
  async makeBackup(document, source) {
    const id = randomUUID(), createdAt = new Date().toISOString();
    const record = { id, createdAt, revision: document.revision, sha256: digest(json(document)), sourceSha256: digest(source), originalSource: source, document };
    await atomicWrite(join(this.backupDirectory, id + '.json'), json(record)); return record;
  }
  async backups() {
    const result = [];
    for (const name of await readdir(this.backupDirectory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const path = join(this.backupDirectory, name); await regular(path);
      let record;
      try { record = JSON.parse(await readFile(path, 'utf8')); }
      catch { throw new BoardError('백업 목록의 파일을 읽을 수 없습니다.', 'CORRUPT_BACKUP', 422); }
      if (record.id + '.json' !== name || !Number.isSafeInteger(record.revision) || typeof record.createdAt !== 'string') throw new BoardError('백업 기록 형식이 올바르지 않습니다.', 'CORRUPT_BACKUP', 422);
      result.push({ id: record.id, revision: record.revision, createdAt: record.createdAt });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async handoffs() {
    const result = [];
    for (const name of await readdir(this.exportDirectory)) {
      if (!/^[a-f0-9-]{36}$/.test(name)) continue;
      const folder = join(this.exportDirectory, name);
      const info = await lstat(folder);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new BoardError('결과 폴더 경로를 확인하세요.', 'UNSAFE_PATH', 409);
      const receiptPath = join(folder, 'receipt.json'); await regular(receiptPath);
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
      if (receipt.id !== name || !Number.isSafeInteger(receipt.revision)) throw new BoardError('결과 기록 형식을 확인하세요.', 'CORRUPT_HANDOFF', 422);
      result.push({ id: name, revision: receipt.revision, createdAt: receipt.createdAt, jsonPath: join(folder, 'result.json'), markdownPath: join(folder, 'result.md') });
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async state() {
    const { document } = await this.read();
    return { definition: this.definition, document, rules: this.rules,
      storage: { root: this.root, documentPath: this.path, backupDirectory: this.backupDirectory, exportDirectory: this.exportDirectory, logPath: join(this.root, 'board.log') },
      backups: await this.backups(), handoffs: await this.handoffs() };
  }
  async save(data, expectedRevision) {
    const validated = this.codec.validateDocument(data, this.definition);
    await this.locked(async () => {
      const { document: current, source } = await this.read(); revision(current, expectedRevision);
      await this.backups(); await this.handoffs();
      if (validated.revision !== expectedRevision) throw new BoardError('편집본의 저장 버전을 확인하세요.', 'REVISION_CONFLICT', 409);
      if (source !== null) await this.makeBackup(current, source);
      // Detect edits made by tools outside the board between read and replacement.
      if ((await this.read()).source !== source) throw new BoardError('저장 파일이 변경되어 저장을 중단했습니다.', 'REVISION_CONFLICT', 409);
      await atomicWrite(this.path, json({ ...validated, revision: current.revision + 1, updatedAt: new Date().toISOString() }));
    });
    return this.state();
  }
  async backup(expectedRevision) {
    await this.locked(async () => {
      const { document, source } = await this.read(); revision(document, expectedRevision);
      await this.backups(); await this.handoffs();
      if (source === null) throw new BoardError('먼저 보드를 저장하세요.', 'NOT_SAVED', 409);
      await this.makeBackup(document, source);
    });
    return this.state();
  }
  async restore(key, expectedRevision) {
    backupId(key);
    await this.locked(async () => {
      const path = join(this.backupDirectory, key + '.json');
      if (!await regular(path)) throw new BoardError('백업을 찾을 수 없습니다.', 'BACKUP_NOT_FOUND', 404);
      let record;
      try { record = JSON.parse(await readFile(path, 'utf8')); } catch { throw new BoardError('백업을 읽을 수 없습니다.', 'CORRUPT_BACKUP', 422); }
      if (record.id !== key || record.sha256 !== digest(json(record.document))) throw new BoardError('백업 내용이 기록과 다릅니다.', 'CORRUPT_BACKUP', 422);
      const restored = this.codec.validateDocument(record.document, this.definition);
      await this.backups(); await this.handoffs();
      const { document: current, source } = await this.read(); revision(current, expectedRevision);
      if (source !== null) await this.makeBackup(current, source);
      if ((await this.read()).source !== source) throw new BoardError('저장 파일이 변경되어 복원을 중단했습니다.', 'REVISION_CONFLICT', 409);
      await atomicWrite(this.path, json({ ...restored, revision: current.revision + 1, updatedAt: new Date().toISOString() }));
    });
    return this.state();
  }
  async export(expectedRevision, itemIds, options = {}) {
    let handoff, preview;
    await this.locked(async () => {
      const { document, source } = await this.read(); revision(document, expectedRevision);
      await this.backups(); await this.handoffs();
      if (source === null) throw new BoardError('먼저 보드를 저장하세요.', 'NOT_SAVED', 409);
      const id = randomUUID(), createdAt = new Date().toISOString();
      const result = this.codec.createHandoff({ document, definition: this.definition, definitionSource: this.definitionSource, rules: this.rules, documentSource: source, itemIds, id, createdAt, options });
      // A directory is visible in history only after all immutable snapshot files exist.
      const stage = join(this.exportDirectory, '.pending-' + id), target = join(this.exportDirectory, id);
      await directory(stage);
      await writeFile(join(stage, 'result.json'), json(result.snapshot), { flag: 'wx', mode: 0o600 });
      await writeFile(join(stage, 'result.md'), result.preview, { flag: 'wx', mode: 0o600 });
      await writeFile(join(stage, 'board.json'), this.definitionSource, { flag: 'wx', mode: 0o600 });
      await writeFile(join(stage, 'rules.md'), this.rules, { flag: 'wx', mode: 0o600 });
      for (const file of result.files || []) {
        if (!/^[a-z0-9][a-z0-9._-]+$/.test(file.name) || ['result.json', 'result.md', 'board.json', 'rules.md', 'receipt.json'].includes(file.name)) throw new BoardError('결과 파일 이름을 확인하세요.');
        await writeFile(join(stage, file.name), file.content, { flag: 'wx', mode: 0o600 });
      }
      await writeFile(join(stage, 'receipt.json'), json({ id, revision: document.revision, createdAt }), { flag: 'wx', mode: 0o600 });
      await rename(stage, target);
      handoff = { id, revision: document.revision, createdAt, jsonPath: join(target, 'result.json'), markdownPath: join(target, 'result.md') };
      preview = result.preview;
    });
    return { ...await this.state(), handoff, preview };
  }
}
