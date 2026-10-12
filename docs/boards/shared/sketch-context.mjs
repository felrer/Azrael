import { BoardError } from './model.mjs';
import { createSketchDocument, validateSketchDocument, selectScene, validateRaster } from './sketch-model.mjs';
import { digest, json } from './context.mjs';

function createSketchHandoff({ document, definition, definitionSource, rules, documentSource, itemIds, id, createdAt, options = {} }) {
  const scene = selectScene(document, itemIds);
  const selected = { ...document, scene };
  const native = { type: 'excalidraw', version: 2, source: 'local-sketch-board', ...scene };
  const sceneSource = json(native);
  const files = [{ name: 'scene.excalidraw', content: sceneSource }];
  let previewSha256 = null;
  if (options.previewImage !== undefined) {
    if (validateRaster(options.previewImage).mimeType !== 'image/png') throw new BoardError('미리보기는 PNG여야 합니다.');
    const content = Buffer.from(options.previewImage.split(',')[1], 'base64');
    previewSha256 = digest(content); files.push({ name: 'preview.png', content });
  }
  const snapshot = { formatVersion: 1, kind: 'excalidraw', id, createdAt, boardId: document.boardId, datasetId: document.datasetId,
    sourceRevision: document.revision, sourceDocumentSha256: digest(documentSource), selectedItemIds: [...itemIds],
    includedElementIds: scene.elements.map(element => element.id), document: selected,
    definition, definitionSha256: digest(definitionSource), rules: { path: definition.rules, sha256: digest(rules), content: rules },
    sceneSha256: digest(sceneSource), previewSha256 };
  const annotations = scene.elements.map(element => ({ id: element.id, type: element.type, text: element.text || '',
    categoryId: element.customData?.board?.categoryId || null, note: element.customData?.board?.note || '',
    selection: itemIds.includes(element.id) ? 'selected' : 'dependency' }));
  const fence = '`'.repeat(Math.max(3, ...((rules + json(annotations)).match(/`+/g) || []).map(value => value.length + 1)));
  const preview = `# 스케치 보드 전달 결과\n\n보드: ${document.title}\n저장 버전: ${document.revision}\n전달 ID: ${id}\n\n원본 그림: [scene.excalidraw](scene.excalidraw)\n${previewSha256 ? '\n![선택한 그림 미리보기](preview.png)\n' : ''}\n선택한 도형 ${itemIds.length}개와 연결 유지에 필요한 요소 ${scene.elements.length}개를 포함합니다. 추가 요소는 맥락이며 별도 승인으로 해석하지 않습니다. 그림과 메모의 기준은 result.json입니다.\n\n## 도형과 메모\n\n${fence}json\n${json(annotations)}${fence}\n\n## 해석 지침\n\n${fence}markdown\n${rules}\n${fence}\n\n## 출처\n\n원본 SHA-256: ${snapshot.sourceDocumentSha256}\n그림 SHA-256: ${snapshot.sceneSha256}\n지침 SHA-256: ${snapshot.rules.sha256}\n미리보기 SHA-256: ${previewSha256 || '없음'}\n`;
  return { snapshot, preview, files };
}

export const sketchCodec = { createDocument: createSketchDocument, validateDocument: validateSketchDocument, createHandoff: createSketchHandoff };
