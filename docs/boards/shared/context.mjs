import { createHash } from 'node:crypto';
import { BoardError } from './model.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';
function fenced(value, language) {
  const runs = value.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}
export function createHandoff({ document, definition, definitionSource, rules, documentSource, itemIds, id, createdAt }) {
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length || itemIds.some(key => !document.items.some(item => item.id === key))) throw new BoardError('전달할 항목을 하나 이상 올바르게 선택하세요.');
  const items = document.items.filter(item => itemIds.includes(item.id));
  const selected = { ...document, items, categories: document.categories.filter(category => items.some(item => item.categoryId === category.id)) };
  const snapshot = { formatVersion: 1, id, createdAt, boardId: document.boardId, datasetId: document.datasetId,
    sourceRevision: document.revision, sourceDocumentSha256: digest(documentSource), selectedItemIds: items.map(item => item.id),
    document: selected, definition, definitionSha256: digest(definitionSource),
    rules: { path: definition.rules, sha256: digest(rules), content: rules } };
  const preview = `# 보드 전달 결과\n\n보드: ${definition.title}\n저장 버전: ${document.revision}\n전달 ID: ${id}\n선택 항목: ${items.length}개\n\n이 파일은 전달 시점의 고정된 결과입니다. 이후 편집본과 구분하고 선택하지 않은 항목을 삭제나 승인으로 해석하지 마세요.\n\n## 데이터와 양식\n\n${fenced(json({ sourceRevision: snapshot.sourceRevision, document: selected, definition }), 'json')}\n\n## 해석 지침\n\n${fenced(rules, 'markdown')}\n\n## 출처\n\n원본 SHA-256: ${snapshot.sourceDocumentSha256}\n양식 SHA-256: ${snapshot.definitionSha256}\n지침 SHA-256: ${snapshot.rules.sha256}\n`;
  return { snapshot, preview };
}
