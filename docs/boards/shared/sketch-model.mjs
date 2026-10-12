import { BoardError } from './model.mjs';

export const SKETCH_LIMITS = Object.freeze({ elements: 2000, documentBytes: 16 * 1024 * 1024, imageBytes: 4 * 1024 * 1024, totalImageBytes: 8 * 1024 * 1024 });
const fail = message => { throw new BoardError(message, 'INVALID_SKETCH'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, empty = true) => typeof value === 'string' && value.length <= max && (empty || value.trim());
const key = value => text(value, 100, false) && /^[A-Za-z0-9_-]+$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
const finite = (value, max = 1000000) => Number.isFinite(value) && Math.abs(value) <= max;
const types = new Set(['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame']);

export function validateRaster(dataURL, declaredMime) {
  if (!text(dataURL, Math.ceil(SKETCH_LIMITS.imageBytes / 3) * 4 + 100, false)) fail('이미지는 한 개당 4 MiB 이하여야 합니다.');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
  if (!match || (declaredMime && declaredMime !== match[1]) || match[2].length % 4) fail('PNG·JPEG·WebP 이미지 파일만 지원합니다.');
  let bytes;
  try { bytes = atob(match[2]); } catch { fail('이미지 내용을 읽을 수 없습니다.'); }
  if (bytes.length > SKETCH_LIMITS.imageBytes) fail('이미지는 한 개당 4 MiB 이하여야 합니다.');
  const signature = match[1] === 'image/png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'image/jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  if (!signature) fail('이미지 형식과 내용이 다릅니다.');
  return { mimeType: match[1], byteLength: bytes.length };
}

export function createSketchDocument(definition) {
  return { schemaVersion: 1, kind: 'excalidraw', boardId: definition.id, datasetId: 'workspace', revision: 0,
    title: definition.title, categories: structuredClone(definition.initialCategories),
    scene: { elements: [], files: {}, appState: { viewBackgroundColor: '#ffffff', scrollX: 0, scrollY: 0, zoom: { value: 1 } } }, updatedAt: null };
}

export function validateSketchDocument(document, definition) {
  if (!object(document) || document.kind !== 'excalidraw' || document.schemaVersion !== 1 || document.boardId !== definition.id || document.datasetId !== 'workspace') fail('스케치 보드와 데이터 형식이 맞지 않습니다.');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0 || !text(document.title, 200, false)) fail('제목과 저장 버전을 확인하세요.');
  if (document.updatedAt !== null && (!text(document.updatedAt, 80, false) || !Number.isFinite(Date.parse(document.updatedAt)))) fail('저장 시각을 확인하세요.');
  if (!Array.isArray(document.categories) || !document.categories.length || document.categories.length > 100) fail('분류는 1~100개여야 합니다.');
  const categories = document.categories.map(category => {
    if (!object(category) || !key(category.id) || !text(category.name, 80, false) || !/^#[a-f0-9]{6}$/i.test(category.color)) fail('분류 이름·식별자·색상을 확인하세요.');
    return { id: category.id, name: category.name, color: category.color };
  });
  const categoryIds = new Set(categories.map(category => category.id));
  if (categoryIds.size !== categories.length) fail('분류 식별자가 중복됩니다.');
  const scene = document.scene;
  if (!object(scene) || !Array.isArray(scene.elements) || scene.elements.length > SKETCH_LIMITS.elements || !object(scene.files) || !object(scene.appState)) fail('그림 요소는 최대 2000개이며 올바른 그림 원본이 필요합니다.');
  const ids = new Set();
  // A deleted unsupported tool element must not prevent recovery by deletion.
  const persistedElements = scene.elements.filter(element => !(object(element) && element.isDeleted === true && (!types.has(element.type) || element.link)));
  for (const element of persistedElements) {
    if (!object(element) || !key(element.id) || ids.has(element.id) || !types.has(element.type)) fail('그림 요소의 종류와 식별자를 확인하세요.');
    ids.add(element.id);
    if (![element.x, element.y, element.width, element.height, element.angle].every(value => finite(value)) || element.width < 0 || element.height < 0 || !Number.isSafeInteger(element.version) || element.version < 1 || typeof element.isDeleted !== 'boolean') fail('그림 요소의 위치·크기·버전을 확인하세요.');
    if (element.link) fail('외부 링크·웹 임베드는 이 보드에서 지원하지 않습니다.');
    if (element.text !== undefined && !text(element.text, 20000)) fail('글자가 너무 깁니다.');
    if (['arrow', 'line', 'freedraw'].includes(element.type) && (!Array.isArray(element.points) || element.points.length > 20000 || element.points.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(value => finite(value))))) fail('선의 좌표를 확인하세요.');
    if (element.customData !== undefined) {
      if (!object(element.customData) || Object.keys(element.customData).some(name => name !== 'board')) fail('보드에서 지원하지 않는 추가 데이터입니다.');
      const board = element.customData.board;
      if (!object(board) || !categoryIds.has(board.categoryId) || !text(board.note, 5000)) fail('도형의 분류와 메모를 확인하세요.');
    }
    if (element.groupIds !== undefined && (!Array.isArray(element.groupIds) || element.groupIds.length > 100 || element.groupIds.some(value => !key(value)))) fail('그룹 식별자를 확인하세요.');
    if (element.boundElements != null && (!Array.isArray(element.boundElements) || element.boundElements.length > 2000 || element.boundElements.some(value => !object(value) || !key(value.id) || !['text', 'arrow'].includes(value.type)))) fail('연결된 요소를 확인하세요.');
    for (const binding of [element.startBinding, element.endBinding]) if (binding != null && (!object(binding) || !key(binding.elementId))) fail('화살표 연결을 확인하세요.');
    if (element.containerId != null && !key(element.containerId) || element.frameId != null && !key(element.frameId)) fail('글자·프레임 연결을 확인하세요.');
  }
  const references = element => [...(element.boundElements || []).map(item => item.id), element.containerId, element.frameId, element.startBinding?.elementId, element.endBinding?.elementId].filter(Boolean);
  for (const element of persistedElements) if (references(element).some(value => !ids.has(value))) fail('연결된 도형이 그림 원본에 없습니다.');
  let total = 0;
  const files = {};
  if (Object.keys(scene.files).length > 100) fail('이미지는 최대 100개입니다.');
  for (const [id, file] of Object.entries(scene.files)) {
    if (!key(id) || !object(file) || file.id !== id || !Number.isFinite(file.created)) fail('이미지 식별자를 확인하세요.');
    total += validateRaster(file.dataURL, file.mimeType).byteLength;
    if (total > SKETCH_LIMITS.totalImageBytes) fail('이미지 합계는 8 MiB 이하여야 합니다.');
    files[id] = structuredClone(file);
  }
  for (const element of persistedElements) if (element.type === 'image' && (!key(element.fileId) || !Object.hasOwn(files, element.fileId))) fail('그림에 필요한 이미지가 없습니다.');
  const state = scene.appState;
  if (!/^#[a-f0-9]{6}$/i.test(state.viewBackgroundColor) || !finite(state.scrollX) || !finite(state.scrollY) || !finite(state.zoom?.value, 30) || state.zoom.value < 0.1) fail('그림 표시 상태를 확인하세요.');
  const result = { schemaVersion: 1, kind: 'excalidraw', boardId: definition.id, datasetId: 'workspace', revision: document.revision,
    title: document.title, categories, scene: { elements: structuredClone(persistedElements), files,
      appState: { viewBackgroundColor: state.viewBackgroundColor, scrollX: state.scrollX, scrollY: state.scrollY, zoom: { value: state.zoom.value } } }, updatedAt: document.updatedAt };
  if (new TextEncoder().encode(JSON.stringify(result)).length > SKETCH_LIMITS.documentBytes) fail('그림 원본 JSON은 16 MiB 이하여야 합니다.');
  return result;
}

// Include bound labels/endpoints and frame contents so the snapshot remains editable.
export function selectScene(document, itemIds) {
  const live = document.scene.elements.filter(element => !element.isDeleted), byId = new Map(live.map(element => [element.id, element]));
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length || itemIds.some(id => !byId.has(id))) fail('전달할 도형을 하나 이상 선택하세요.');
  const wanted = new Set(itemIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...wanted]) {
      const element = byId.get(id);
      const refs = [...(element.boundElements || []).map(item => item.id), element.containerId, element.frameId, element.startBinding?.elementId, element.endBinding?.elementId];
      if (element.type === 'frame') refs.push(...live.filter(item => item.frameId === id).map(item => item.id));
      for (const ref of refs) if (byId.has(ref) && !wanted.has(ref)) { wanted.add(ref); changed = true; }
    }
  }
  const elements = structuredClone(live.filter(element => wanted.has(element.id)));
  const imageIds = new Set(elements.filter(element => element.type === 'image').map(element => element.fileId));
  return { elements, appState: structuredClone(document.scene.appState), files: Object.fromEntries(Object.entries(document.scene.files).filter(([id]) => imageIds.has(id))) };
}
