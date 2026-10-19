import { BoardError } from './model.mjs';

export const CATALOG_LIMITS = Object.freeze({ folders: 50, lists: 100, items: 2000, bytes: 1572864 });
export const CATALOG_KINDS = ['building', 'prop'];
export const CATALOG_STATUSES = ['unreviewed', 'approved', 'hold'];
const previews = ['building', 'crate', 'tree', 'rock'];
const fail = message => { throw new BoardError(message); };
function text(value, label, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label}을 확인하세요.`);
  return value;
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || ['all', 'unassigned', '__proto__', 'constructor', 'prototype'].includes(value)) fail('식별자를 확인하세요.');
  return value;
}
function choice(value, options, label) { if (!options.includes(value)) fail(`${label}을 확인하세요.`); return value; }

export function createCatalogDocument(definition) {
  const names = [
    ['상가 건물', 'building', 'city', 'building', ['도시', '외벽']],
    ['작은 창고', 'building', 'city', 'building', ['도시', '실내']],
    ['벽돌 주택', 'building', 'city', 'building', ['도시', '외벽']],
    ['나무 상자', 'prop', 'props', 'crate', ['나무', '작은 물체']],
    ['철제 보관함', 'prop', 'props', 'crate', ['금속']],
    ['소나무', 'prop', 'forest', 'tree', ['숲', '나무']],
    ['넓은 나무', 'prop', 'forest', 'tree', ['숲', '나무']],
    ['둥근 바위', 'prop', 'forest', 'rock', ['숲', '돌']],
    ['검토용 상자', 'prop', 'review', 'crate', ['검토']],
    ['작은 돌', 'prop', null, 'rock', ['돌']],
    ['외딴 집', 'building', null, 'building', ['참고']],
    ['빈 나무 상자', 'prop', null, 'crate', ['나무']]
  ];
  return { schemaVersion: 1, kind: 'catalog', boardId: definition.id, datasetId: 'workspace', revision: 0,
    title: definition.title, updatedAt: null,
    folders: [{ id: 'environment', name: '환경', collapsed: false }, { id: 'workbench', name: '검토 작업', collapsed: false }],
    lists: [{ id: 'city', name: '도시', folderId: 'environment' }, { id: 'forest', name: '숲', folderId: 'environment' },
      { id: 'props', name: '소품', folderId: null }, { id: 'review', name: '검토 대기', folderId: 'workbench' }],
    items: names.map(([title, kind, listId, preview, tags], i) => ({ id: `demo-${String(i + 1).padStart(2, '0')}`, title, kind,
      listId, preview, tags, status: i === 8 ? 'hold' : i % 3 === 0 ? 'approved' : 'unreviewed', note: '실사용 시험을 위한 합성 더미 항목입니다.' })) };
}

export function validateCatalogDocument(document, definition = { id: 'catalog' }) {
  if (!document || document.schemaVersion !== 1 || document.kind !== 'catalog' || document.boardId !== definition.id || document.datasetId !== 'workspace') fail('목록 보드의 데이터 형식이 맞지 않습니다.');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('저장 버전을 확인하세요.');
  if (document.updatedAt !== null && (typeof document.updatedAt !== 'string' || document.updatedAt.length > 40 || !Number.isFinite(Date.parse(document.updatedAt)))) fail('저장 시각을 확인하세요.');
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(document)).length; } catch { fail('문서를 읽을 수 없습니다.'); }
  if (bytes > CATALOG_LIMITS.bytes) fail('자료는 1.5 MiB 이하로 줄여주세요.');
  for (const key of ['folders', 'lists', 'items']) if (!Array.isArray(document[key]) || document[key].length > CATALOG_LIMITS[key]) fail(`${key} 개수 제한을 확인하세요.`);
  const ids = new Set();
  const unique = value => { identifier(value); if (ids.has(value)) fail('중복된 식별자가 있습니다.'); ids.add(value); return value; };
  const folders = document.folders.map(folder => {
    if (typeof folder?.collapsed !== 'boolean') fail('폴더 접힘 상태를 확인하세요.');
    return { id: unique(folder.id), name: text(folder.name, '폴더 이름', 80), collapsed: folder.collapsed };
  });
  const folderIds = new Set(folders.map(folder => folder.id));
  const lists = document.lists.map(list => {
    if (list?.folderId !== null && !folderIds.has(list?.folderId)) fail('목록의 폴더를 확인하세요.');
    return { id: unique(list.id), name: text(list.name, '목록 이름', 80), folderId: list.folderId };
  });
  const listIds = new Set(lists.map(list => list.id));
  const items = document.items.map(item => {
    if (item?.listId !== null && !listIds.has(item?.listId)) fail('항목의 목록을 확인하세요.');
    if (!Array.isArray(item.tags) || item.tags.length > 20 || new Set(item.tags).size !== item.tags.length) fail('태그는 중복 없이 20개까지 지정하세요.');
    return { id: unique(item.id), title: text(item.title, '항목 이름'), kind: choice(item.kind, CATALOG_KINDS, '종류'),
      status: choice(item.status, CATALOG_STATUSES, '검토 상태'), listId: item.listId,
      tags: item.tags.map(tag => text(tag, '태그', 40)), note: text(item.note, '메모', 5000, true), preview: choice(item.preview, previews, '미리보기') };
  });
  return { schemaVersion: 1, kind: 'catalog', boardId: definition.id, datasetId: 'workspace', revision: document.revision,
    title: text(document.title, '자료 제목'), updatedAt: document.updatedAt, folders, lists, items };
}

// Pure edit boundary: callers own drafts, undo history, selection and persistence.
export function applyCatalogAction(document, action) {
  const next = structuredClone(document);
  const find = (values, id) => { const found = values.find(value => value.id === id); if (!found) fail('편집할 항목을 찾을 수 없습니다.'); return found; };
  const selected = ids => {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) fail('항목을 선택하세요.');
    return ids.map(id => find(next.items, id));
  };
  const move = (values, id, direction, peers = values) => {
    choice(direction, [-1, 1], '이동 방향');
    const item = find(values, id), position = peers.indexOf(item), target = peers[position + direction];
    if (target) { const a = values.indexOf(item), b = values.indexOf(target); [values[a], values[b]] = [values[b], values[a]]; }
  };
  const place = (values, id, beforeId, folderId) => {
    const item = find(values, id);
    if (beforeId === id) return;
    const before = beforeId === null ? null : find(values, beforeId);
    if (folderId !== undefined) {
      if (folderId !== null) find(next.folders, folderId);
      if (before && before.folderId !== folderId) fail('이동할 목록의 폴더를 확인하세요.');
      item.folderId = folderId;
    }
    values.splice(values.indexOf(item), 1);
    values.splice(before ? values.indexOf(before) : values.length, 0, item);
  };
  switch (action?.type) {
    case 'folder.create': next.folders.push({ id: action.id ?? crypto.randomUUID(), name: action.name, collapsed: false }); break;
    case 'folder.update': {
      const folder = find(next.folders, action.id);
      if (Object.hasOwn(action, 'name')) folder.name = action.name;
      if (Object.hasOwn(action, 'collapsed')) folder.collapsed = action.collapsed;
      break;
    }
    case 'folder.delete': find(next.folders, action.id); next.folders = next.folders.filter(folder => folder.id !== action.id); next.lists.forEach(list => { if (list.folderId === action.id) list.folderId = null; }); break;
    case 'folder.move':
      if (Object.hasOwn(action, 'beforeId')) place(next.folders, action.id, action.beforeId);
      else move(next.folders, action.id, action.direction);
      break;
    case 'list.create': next.lists.push({ id: action.id ?? crypto.randomUUID(), name: action.name, folderId: action.folderId ?? null }); break;
    case 'list.update': {
      const list = find(next.lists, action.id);
      if (Object.hasOwn(action, 'name')) list.name = action.name;
      if (Object.hasOwn(action, 'folderId')) list.folderId = action.folderId;
      break;
    }
    case 'list.delete': find(next.lists, action.id); next.lists = next.lists.filter(list => list.id !== action.id); next.items.forEach(item => { if (item.listId === action.id) item.listId = null; }); break;
    case 'list.move': {
      const list = find(next.lists, action.id);
      if (Object.hasOwn(action, 'beforeId')) place(next.lists, action.id, action.beforeId, action.folderId ?? null);
      else move(next.lists, action.id, action.direction, next.lists.filter(peer => peer.folderId === list.folderId));
      break;
    }
    case 'item.create': next.items.push({ id: action.id ?? crypto.randomUUID(), title: action.title ?? '새 항목', kind: 'prop', status: 'unreviewed', listId: action.listId ?? null, tags: [], note: '', preview: 'crate' }); break;
    case 'item.update': {
      const item = find(next.items, action.id);
      if (!action.changes || Object.keys(action.changes).some(key => !['title', 'kind', 'status', 'listId', 'tags', 'note'].includes(key))) fail('편집 필드를 확인하세요.');
      Object.assign(item, action.changes); break;
    }
    case 'item.delete': selected(action.ids); next.items = next.items.filter(item => !action.ids.includes(item.id)); break;
    case 'item.assign': selected(action.ids).forEach(item => { item.listId = action.listId; }); break;
    default: fail('지원하지 않는 편집 동작입니다.');
  }
  return validateCatalogDocument(next, { id: document.boardId });
}
