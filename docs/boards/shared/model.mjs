// One data contract shared by the browser and the filesystem owner.
export class BoardError extends Error {
  constructor(message, code = 'INVALID_DATA', status = 400) {
    super(message); this.name = 'BoardError'; this.code = code; this.status = status;
  }
}
const fail = message => { throw new BoardError(message); };
const text = (value, label, max = 200, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label}을 확인하세요.`);
  return value;
};
const id = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value)) fail('항목 식별자가 올바르지 않습니다.');
  return value;
};
const number = (value, label, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${label}은 ${min}~${max} 사이의 숫자여야 합니다.`);
  return value;
};
export function validateDefinition(definition) {
  if (!definition || definition.schemaVersion !== 1) fail('지원하지 않는 보드 양식입니다.');
  id(definition.id); text(definition.title, '보드 제목');
  if (definition.rules !== 'rules.md') fail('해석 지침은 보드의 rules.md에 두세요.');
  if (!Array.isArray(definition.fields) || definition.fields.length > 30) fail('양식 항목을 확인하세요.');
  const fieldIds = new Set();
  for (const field of definition.fields) {
    id(field.id); text(field.label, '필드 이름');
    if (['__proto__', 'constructor', 'prototype'].includes(field.id) || fieldIds.has(field.id)) fail('필드 식별자가 중복되거나 예약된 값입니다.');
    fieldIds.add(field.id);
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 30) fail('선택 양식을 확인하세요.');
      const options = new Set();
      for (const option of field.options) { text(option.value, '선택 값', 80); text(option.label, '선택 이름'); if (options.has(option.value)) fail('중복 선택 값입니다.'); options.add(option.value); }
      if (!options.has(field.default)) fail('기본 선택 값을 확인하세요.');
    } else if (field.type === 'number') {
      number(field.min, '최솟값', -1e6, 1e6); number(field.max, '최댓값', field.min, 1e6);
      number(field.default, '기본값', field.min, field.max);
    } else if (field.type === 'text') text(field.default, '기본값', 2000, true);
    else if (field.type === 'boolean') { if (typeof field.default !== 'boolean') fail('기본값을 확인하세요.'); }
    else fail('지원하는 양식은 text, number, select, boolean입니다.');
  }
  const map = definition.map;
  if (!map || map.origin !== 'top-left') fail('map 원점은 top-left여야 합니다.');
  text(map.unit, '좌표 단위', 40); number(map.width, 'map 너비', 100, 100000); number(map.height, 'map 높이', 100, 100000);
  if (!Array.isArray(definition.initialCategories) || !definition.initialCategories.length) fail('기본 분류를 하나 이상 지정하세요.');
  validateCategories(definition.initialCategories);
  return definition;
}
function validateCategories(categories) {
  if (!Array.isArray(categories) || !categories.length || categories.length > 100) fail('분류는 1~100개여야 합니다.');
  const ids = new Set();
  return categories.map(category => {
    const key = id(category?.id); if (ids.has(key)) fail('분류 식별자가 중복됩니다.'); ids.add(key);
    if (!/^#[0-9a-f]{6}$/i.test(category.color)) fail('분류 색상을 확인하세요.');
    return { id: key, name: text(category.name, '분류 이름', 80), color: category.color };
  });
}
export function createItem(definition) {
  return { id: globalThis.crypto.randomUUID(), title: '새 항목', categoryId: definition.initialCategories[0].id,
    position: { x: 80, y: 80 }, size: { width: 180, height: 110 },
    values: Object.fromEntries(definition.fields.map(field => [field.id, field.default])), specifiedFields: [], note: '' };
}
export function createDocument(definition) {
  return { schemaVersion: 1, boardId: definition.id, datasetId: 'workspace', revision: 0,
    title: definition.title, categories: structuredClone(definition.initialCategories),
    map: structuredClone(definition.map), items: [], updatedAt: null };
}
export function validateDocument(document, definition) {
  if (!document || document.schemaVersion !== 1 || document.boardId !== definition.id || document.datasetId !== 'workspace') fail('보드와 데이터 형식이 맞지 않습니다.');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('저장 버전을 확인하세요.');
  const categories = validateCategories(document.categories), categoryIds = new Set(categories.map(category => category.id));
  if (!Array.isArray(document.items) || document.items.length > 500) fail('항목은 최대 500개까지 저장할 수 있습니다.');
  if (JSON.stringify(document.map) !== JSON.stringify(definition.map)) {
    // Compare fields rather than JSON property order for documents edited by external tools.
    if (!document.map || Object.keys(definition.map).some(key => document.map[key] !== definition.map[key]) || Object.keys(document.map).some(key => !(key in definition.map))) fail('map 좌표 체계가 보드 양식과 다릅니다.');
  }
  const ids = new Set();
  const items = document.items.map(item => {
    const key = id(item?.id); if (ids.has(key)) fail('항목 식별자가 중복됩니다.'); ids.add(key);
    if (!categoryIds.has(item.categoryId)) fail('항목의 분류를 확인하세요.');
    const values = {};
    if (!item.values || typeof item.values !== 'object' || Array.isArray(item.values)) fail('입력 필드를 확인하세요.');
    for (const field of definition.fields) {
      const value = item.values[field.id];
      if (field.type === 'select' && !field.options.some(option => option.value === value)) fail(`${field.label}을 선택하세요.`);
      if (field.type === 'number') number(value, field.label, field.min, field.max);
      if (field.type === 'text') text(value, field.label, 2000, true);
      if (field.type === 'boolean' && typeof value !== 'boolean') fail(`${field.label}을 확인하세요.`);
      values[field.id] = value;
    }
    if (Object.keys(item.values).some(key => !definition.fields.some(field => field.id === key))) fail('양식에 없는 입력 필드입니다.');
    if (!Array.isArray(item.specifiedFields) || new Set(item.specifiedFields).size !== item.specifiedFields.length || item.specifiedFields.some(key => !definition.fields.some(field => field.id === key))) fail('직접 지정한 필드 기록을 확인하세요.');
    return { id: key, title: text(item.title, '항목 제목'), categoryId: item.categoryId,
      position: { x: number(item.position?.x, 'X', -100000, 100000), y: number(item.position?.y, 'Y', -100000, 100000) },
      size: { width: number(item.size?.width, '너비', 32, 1000), height: number(item.size?.height, '높이', 32, 1000) }, values,
      specifiedFields: [...item.specifiedFields], note: text(item.note, '메모', 5000, true) };
  });
  if (document.updatedAt !== null && (typeof document.updatedAt !== 'string' || !Number.isFinite(Date.parse(document.updatedAt)))) fail('저장 시각을 확인하세요.');
  return { schemaVersion: 1, boardId: definition.id, datasetId: 'workspace', revision: document.revision,
    title: text(document.title, '데이터 제목'), categories, map: structuredClone(definition.map), items, updatedAt: document.updatedAt };
}
