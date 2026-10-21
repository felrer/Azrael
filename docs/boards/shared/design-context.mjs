import { BoardError } from './model.mjs';
import { digest, fenced, json } from './context.mjs';
import { createDesignDocument, validateDesignDocument } from './design-model.mjs';
function createDesignHandoff({document,definition,definitionSource,rules,documentSource,itemIds,id,createdAt}) {
  if (!Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length || itemIds.some(key=>!document.items.some(item=>item.id===key))) throw new BoardError('전달할 디자인안을 선택하세요.');
  const items=document.items.filter(item=>itemIds.includes(item.id));
  const selected={...document,items,settings:{...document.settings,selectedId:items.some(item=>item.id===document.settings.selectedId)?document.settings.selectedId:items[0].id}};
  const snapshot={formatVersion:1,id,createdAt,boardId:document.boardId,datasetId:document.datasetId,sourceRevision:document.revision,sourceDocumentSha256:digest(documentSource),selectedItemIds:items.map(item=>item.id),document:selected,definition,definitionSha256:digest(definitionSource),rules:{path:definition.rules,sha256:digest(rules),content:rules}};
  const preview=`# 디자인 보드 전달 결과\n\n저장 버전: ${document.revision}\n선택 디자인: ${items.length}개\n\nHTML/CSS 정적 시안과 사용자 입력입니다. 실제 기기·엔진에서의 동작이나 구현 승인을 뜻하지 않습니다.\n\n## 자료와 양식\n\n${fenced(json({document:selected,definition}),'json')}\n\n## 해석 지침\n\n${fenced(rules,'markdown')}\n\n원본 SHA-256: ${snapshot.sourceDocumentSha256}\n양식 SHA-256: ${snapshot.definitionSha256}\n지침 SHA-256: ${snapshot.rules.sha256}\n`;
  return {snapshot,preview};
}
export const designCodec={createDocument:createDesignDocument,validateDocument:validateDesignDocument,createHandoff:createDesignHandoff};
