import { BoardError } from './model.mjs';
import { digest, fenced, json } from './context.mjs';
import { createCatalogDocument, validateCatalogDocument } from './catalog-model.mjs';

export function createCatalogHandoff({ document, definition, definitionSource, rules, documentSource, itemIds, id, createdAt }) {
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length || itemIds.some(key => !document.items.some(item => item.id === key))) throw new BoardError('전달할 항목을 하나 이상 올바르게 선택하세요.');
  const items = document.items.filter(item => itemIds.includes(item.id));
  const lists = document.lists.filter(list => items.some(item => item.listId === list.id));
  const folders = document.folders.filter(folder => lists.some(list => list.folderId === folder.id));
  const selected = { ...document, folders, lists, items };
  const snapshot = { formatVersion: 1, id, createdAt, boardId: document.boardId, datasetId: document.datasetId,
    sourceRevision: document.revision, sourceDocumentSha256: digest(documentSource), selectedItemIds: items.map(item => item.id),
    document: selected, definition, definitionSha256: digest(definitionSource),
    rules: { path: definition.rules, sha256: digest(rules), content: rules } };
  const preview = `# 목록·카드 보드 전달 결과\n\n저장 버전: ${document.revision}\n선택 항목: ${items.length}개\n\n전달 시점의 고정된 더미 자료입니다. 선택하지 않은 항목을 삭제하거나 승인한 것으로 해석하지 마세요.\n\n## 데이터와 양식\n\n${fenced(json({ sourceRevision: snapshot.sourceRevision, document: selected, definition }), 'json')}\n\n## 해석 지침\n\n${fenced(rules, 'markdown')}\n\n## 출처\n\n원본 SHA-256: ${snapshot.sourceDocumentSha256}\n양식 SHA-256: ${snapshot.definitionSha256}\n지침 SHA-256: ${snapshot.rules.sha256}\n`;
  return { snapshot, preview };
}

export const catalogCodec = { createDocument: createCatalogDocument, validateDocument: validateCatalogDocument, createHandoff: createCatalogHandoff };
