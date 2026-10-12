import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { selectScene, validateSketchDocument } from '/shared/sketch-model.mjs';
import '@excalidraw/excalidraw/index.css';
import './sketch.css';

window.EXCALIDRAW_ASSET_PATH = new URL('/sketch/assets/',location.origin).href;
const UI_OPTIONS = { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, changeViewBackgroundColor: true, toggleTheme: false } };

const clone = value => structuredClone(value);
const utf8 = value => new TextEncoder().encode(value).length;
function problem(doc) {
  if (doc.scene.elements.length > 2000) return '요소는 2,000개까지 저장할 수 있습니다. 일부 요소를 지운 뒤 저장하세요.';
  let total = 0;
  for (const file of Object.values(doc.scene.files)) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(file.dataURL || '')) return 'PNG, JPEG, WebP 이미지만 저장할 수 있습니다.';
    const bytes = Math.floor(file.dataURL.split(',')[1].length * 3 / 4); total += bytes;
    if (bytes > 4 * 1024 * 1024) return '이미지 한 장은 4 MiB 이하여야 합니다.';
  }
  if (total > 8 * 1024 * 1024) return '이미지 전체 크기는 8 MiB 이하여야 합니다.';
  if (utf8(JSON.stringify(doc)) > 16 * 1024 * 1024) return '문서가 16 MiB를 넘었습니다. 일부 요소나 이미지를 줄여 주세요.';
  return '';
}
const sceneState = app => ({ viewBackgroundColor: app.viewBackgroundColor, scrollX: app.scrollX, scrollY: app.scrollY, zoom: { value: app.zoom.value } });
const SUPPORTED_TYPES = new Set(['rectangle','ellipse','diamond','arrow','line','freedraw','text','image','frame']);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
const signature = doc => JSON.stringify(stable({ title: doc.title, categories: doc.categories,
  elements: doc.scene.elements.filter(el => !(el.isDeleted && (!SUPPORTED_TYPES.has(el.type) || el.link))).map(el => Object.fromEntries(Object.entries(el).filter(([key]) => !['version','versionNonce','updated','index'].includes(key) && !(el.type === 'image' && key === 'status') && !(el.type === 'text' && ['width','height'].includes(key))))),
  files: Object.fromEntries(Object.entries(doc.scene.files).map(([id,file]) => [id,{id:file.id,mimeType:file.mimeType,dataURL:file.dataURL,created:file.created}])), background: doc.scene.appState.viewBackgroundColor }));
class Boundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <div className="startup" role="alert">편집기를 표시하지 못했습니다. 저장하지 않은 내용이 있다면 이 창을 유지하세요. 연결을 확인하고 다시 불러오세요.<p>{this.state.error.message}</p><button onClick={() => location.reload()}>다시 불러오기</button></div> : this.props.children; }
}
function App({ editor, initial, token }) {
  const initialScene = useMemo(() => editor.restore(initial.document.scene,null,null,{repairBindings:true,refreshDimensions:true}),[editor,initial]);
  const initialDocument = useMemo(() => ({...clone(initial.document),scene:{...initialScene,appState:sceneState(initialScene.appState)}}),[initial,initialScene]);
  const [state, setState] = useState(initial), [doc, setDoc] = useState(() => clone(initialDocument));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState(false);
  const [settings, setSettings] = useState(false), [selected, setSelected] = useState([]), [root, setRoot] = useState(initial.storage.root), [handoff, setHandoff] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('sketch-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const api = useRef(null), current = useRef(doc), baseline = useRef(signature(initialDocument)), frozen = useRef(false), readyStart = useRef(performance.now()), [readyMs, setReadyMs] = useState(null);
  const { Excalidraw, MainMenu, WelcomeScreen, Sidebar, exportToBlob, convertToExcalidrawElements } = editor;
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('sketch-theme', theme); }, [theme]);
  useEffect(() => { const before = event => { if (signature(current.current) !== baseline.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before); }, []);
  function change(next) { current.current = next; setDoc(next); setDirty(signature(next) !== baseline.current); setHandoff(null); }
  const receiveApi = useCallback(value => { api.current = value; setReadyMs(Math.round(performance.now()-readyStart.current)); }, []);
  function accept(next, reset = true) {
    const value = clone(next.document);
    if (reset) { const restored = editor.restore(value.scene,null,null,{repairBindings:true,refreshDimensions:true}); value.scene = {...restored,appState:sceneState(restored.appState)}; }
    baseline.current = signature(value); current.current = value;
    setState(next); setDoc(value); setDirty(false); setRoot(next.storage.root); setHandoff(null);
    if (reset) setSelected([]);
    if (reset && api.current) { api.current.resetScene(); api.current.addFiles(Object.values(value.scene.files)); api.current.updateScene({ elements: value.scene.elements, appState: value.scene.appState }); }
  }
  async function request(path, body) {
    const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Board-Token': token, 'X-Board-Storage': encodeURIComponent(state.storage.root) }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status === 409 ? '다른 창에서 저장 내용이 변경되었습니다. ' : ''}${data.error || '요청에 실패했습니다.'}${data.requestId ? ` (요청 ${data.requestId})` : ''}`);
    return data;
  }
  async function perform(action, message, replace = true, reset = true) {
    if (frozen.current) return;
    frozen.current = true; setBusy(true); setNotice('');
    try { const next = await action(); if (replace) accept(next,reset); else { setState(next); if (next.handoff) setHandoff(next.handoff); } setNotice(message); setError(false); }
    catch (err) { setNotice(`편집 내용은 유지됩니다. ${err.message}`); setError(true); }
    finally { frozen.current = false; setBusy(false); }
  }
  function save() { let issue = problem(current.current), validated; try { if (!issue) validated = validateSketchDocument(current.current,state.definition); } catch (err) { issue = err.message; } if (issue) { setNotice(issue); setError(true); return; } return perform(() => request('save', { document: validated, expectedRevision: state.document.revision }), '저장했습니다.',true,false); }
  const discard = action => !dirty || confirm(`저장하지 않은 변경이 있습니다. ${action} 현재 편집 내용을 버릴까요?`);
  const onChange = useCallback((elements, appState, files) => {
    if (frozen.current) return;
    const ids = elements.filter(el => !el.isDeleted && appState.selectedElementIds[el.id]).map(el => el.id);
    setSelected(old => old.join() === ids.join() ? old : ids);
    const next = { ...current.current, scene: { elements: clone(elements), files: clone(files), appState: sceneState(appState) } };
    if (signature(next) !== signature(current.current)) change(next);
    else current.current = next;
  }, []);
  async function exportHandoff() {
    await perform(async () => {
      const itemIds = selected.length ? selected : current.current.scene.elements.filter(el => !el.isDeleted).map(el => el.id);
      const scene = selectScene(current.current, itemIds);
      let previewImage;
      try {
        const blob = await exportToBlob({ ...scene, appState: { ...scene.appState, exportBackground: true }, mimeType: 'image/png', maxWidthOrHeight: 1600 });
        if (blob.size > 4 * 1024 * 1024) throw new Error('PNG 미리보기가 4 MiB를 넘었습니다. 전달할 요소를 줄여 주세요.');
        previewImage = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('PNG 미리보기를 읽지 못했습니다.')); reader.readAsDataURL(blob); });
      } catch (err) { throw new Error(`전달용 PNG 미리보기를 만들지 못했습니다. ${err.message || '이미지를 확인하고 다시 시도하세요.'}`); }
      return request('export', { expectedRevision: state.document.revision, itemIds, ...(previewImage ? { previewImage } : {}) });
    }, '전달 파일을 만들었습니다.', false);
  }
  async function addImage(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || busy) return;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error('PNG, JPEG, WebP 이미지를 선택하세요. 한 장은 4 MiB 이하여야 합니다.');
      const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const bitmap = await createImageBitmap(file); const width = Math.min(bitmap.width, 800), height = width * bitmap.height / bitmap.width; bitmap.close();
      if (frozen.current) return;
      const fileId = crypto.randomUUID(), app = api.current.getAppState();
      const elements = convertToExcalidrawElements([{ type: 'image', fileId, x: -app.scrollX + 80 / app.zoom.value, y: -app.scrollY + 80 / app.zoom.value, width, height, status: 'saved' }]);
      const next = { ...current.current, scene: { ...current.current.scene, elements: [...api.current.getSceneElementsIncludingDeleted(), ...elements], files: { ...api.current.getFiles(), [fileId]: { id: fileId, mimeType: file.type, dataURL, created: Date.now() } } } };
      const issue = problem(next); if (issue) throw new Error(issue);
      api.current.addFiles([next.scene.files[fileId]]); api.current.updateScene({ elements: next.scene.elements, captureUpdate: editor.CaptureUpdateAction.IMMEDIATELY });
    } catch (err) { setNotice(err.message); setError(true); }
  }
  const single = selected.length === 1 ? doc.scene.elements.find(el => el.id === selected[0]) : null;
  function metadata(key, value) {
    if (!single || busy) return;
    const board = { categoryId: state.definition.initialCategories[0]?.id, note: '', ...single.customData?.board, [key]: value };
    api.current.updateScene({ elements: api.current.getSceneElementsIncludingDeleted().map(el => el.id === single.id ? { ...el, customData: { ...el.customData, board }, version: el.version + 1, versionNonce: Math.floor(Math.random()*2147483647), updated: Date.now() } : el), captureUpdate: editor.CaptureUpdateAction.IMMEDIATELY });
  }
  const issue = problem(doc);
  return <div className="sketch-shell">
    <header className="topbar"><input data-testid="title" className="title-input" aria-label="보드 제목" value={doc.title} disabled={busy} onChange={event => change({ ...current.current, title: event.target.value })}/><div className="actions">
      <span data-testid="save-status" className={`status ${dirty ? 'dirty' : ''}`} role="status">{busy ? '처리 중…' : dirty ? '저장하지 않은 변경' : doc.revision ? `저장됨 · v${doc.revision}` : '아직 저장하지 않음'}</span>
      <button data-testid="save" className="primary" disabled={busy || (!dirty && doc.revision > 0)} onClick={save}>저장</button>
      <button data-testid="handoff" disabled={busy || dirty || !doc.revision || !doc.scene.elements.some(el => !el.isDeleted)} onClick={exportHandoff}>전달{selected.length ? ` (${selected.length})` : ''}</button>
      <button data-testid="settings" disabled={busy} onClick={() => setSettings(!settings)}>{settings ? '보드로 돌아가기' : '설정'}</button>
      <button data-testid="theme" aria-label="테마 변경" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '밝게' : '어둡게'}</button>
    </div></header>
    {(notice || issue) && <div className={`notice ${error || issue ? 'error' : ''}`} role={error || issue ? 'alert' : 'status'}><span>{notice || issue}</span><button disabled={busy} onClick={() => { if (discard('최신 내용을 불러오면')) perform(() => request('state'), '최신 내용을 불러왔습니다.'); }}>최신 내용 불러오기</button></div>}
    <div className={`sketch-workspace ${settings ? 'editor-hidden' : ''}`}>
      <main className={`sketch-canvas ${busy ? 'frozen' : ''}`} data-testid="canvas"><Excalidraw excalidrawAPI={receiveApi} initialData={initialScene} langCode="ko-KR" onChange={onChange} theme={theme} viewModeEnabled={busy} UIOptions={UI_OPTIONS} onPaste={async (data, event) => { if (frozen.current) return false; if (Array.from(event?.clipboardData?.files || []).some(file => !['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 4*1024*1024)) { setNotice('붙여넣기는 4 MiB 이하 PNG, JPEG, WebP 이미지만 지원합니다.'); setError(true); return false; } return true; }}><MainMenu/><WelcomeScreen/><Sidebar name="default"><Sidebar.Header>이 보드에서는 라이브러리를 사용하지 않습니다.</Sidebar.Header></Sidebar></Excalidraw>
      {handoff && <div className="handoff-result" role="status"><div className="section-head"><strong>전달 파일</strong><button onClick={() => setHandoff(null)}>닫기</button></div><p>{handoff.markdownPath}</p><p>{handoff.jsonPath}</p></div>}</main>
      <aside className="sketch-inspector"><h2>선택 항목</h2>{single ? <><label className="field"><span>분류</span><select data-testid="element-category" disabled={busy} value={single.customData?.board?.categoryId || ''} onChange={e => metadata('categoryId',e.target.value)}><option value="" disabled>분류 없음</option>{doc.categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}</select></label><label className="field"><span>메모</span><textarea data-testid="element-note" disabled={busy} value={single.customData?.board?.note || ''} onChange={e => metadata('note',e.target.value)}/></label></> : <p className="muted">{selected.length ? `${selected.length}개 선택됨. 하나를 선택하면 분류와 메모를 편집할 수 있습니다.` : '도형이나 이미지 하나를 선택해 메모를 남기세요.'}</p>}<label className="field"><span>이미지 추가</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={addImage}/></label><p className="muted">이미지 붙여넣기도 가능합니다. 저장 후 선택 항목 또는 보드 전체를 전달하세요.</p><details className="rules"><summary>보드 규칙</summary><pre>{typeof state.rules === 'string' ? state.rules : JSON.stringify(state.rules,null,2)}</pre></details></aside>
    </div>
    {settings && <main className="sketch-settings"><div className="drawer"><h2>보드 설정</h2><p>저장 위치, 분류와 백업을 관리합니다.</p><section className="settings-section"><h3>파일 저장 위치</h3><label className="field"><span>폴더 경로</span><input data-testid="root" value={root} disabled={busy} onChange={e => setRoot(e.target.value)}/></label><button disabled={busy || root === state.storage.root} onClick={() => { if (discard('저장 위치를 바꾸면')) perform(() => request('storage',{root}), '저장 위치를 바꿨습니다.'); }}>위치 변경</button><div className="paths">{['documentPath','backupDirectory','exportDirectory','logPath'].map(key => <p key={key} className="path-label">{state.storage[key]}</p>)}</div></section>
    <section className="settings-section"><h3>분류</h3>{doc.categories.map(cat => <div className="category-row" key={cat.id}><input type="color" aria-label={`${cat.name} 색상`} disabled={busy} value={cat.color} onChange={e => change({...current.current,categories:current.current.categories.map(c => c.id === cat.id ? {...c,color:e.target.value} : c)})}/><input aria-label="분류 이름" disabled={busy} value={cat.name} onChange={e => change({...current.current,categories:current.current.categories.map(c => c.id === cat.id ? {...c,name:e.target.value} : c)})}/></div>)}<p className="footnote">분류 변경은 보드 저장 버튼으로 저장합니다. 도형 색상과 분류는 각각 선택합니다.</p></section>
    <section className="settings-section"><div className="section-head"><h3>백업</h3><button disabled={busy || dirty || !doc.revision} onClick={() => perform(() => request('backup',{expectedRevision:state.document.revision}), '백업을 만들었습니다.',false)}>현재 저장본 백업</button></div>{state.backups.map(backup => <div className="settings-row" key={backup.id}><div className="row-info"><strong>v{backup.revision}</strong><p>{backup.createdAt}</p></div><button disabled={busy} onClick={() => { if (confirm(`v${backup.revision} 백업으로 복원할까요?${dirty ? ' 저장하지 않은 변경은 사라집니다.' : ''}`)) perform(() => request('restore',{backupId:backup.id,expectedRevision:state.document.revision}), '백업을 복원했습니다.'); }}>복원</button></div>)}{!state.backups.length && <p className="empty">아직 백업이 없습니다.</p>}</section><p className="footnote">편집기 준비 {readyMs === null ? '대기 중' : `${readyMs} ms`} · Excalidraw 0.18.1</p></div></main>}
  </div>;
}
async function start() {
  const [editor, session, state] = await Promise.all([import('@excalidraw/excalidraw'), fetch('/api/session',{cache:'no-store'}).then(r => { if (!r.ok) throw new Error('세션을 불러오지 못했습니다.'); return r.json(); }), fetch('/api/state',{cache:'no-store'}).then(r => { if (!r.ok) throw new Error('보드를 불러오지 못했습니다.'); return r.json(); })]);
  createRoot(document.getElementById('app')).render(<Boundary><App editor={editor} initial={state} token={session.token}/></Boundary>);
}
start().catch(error => { const target = document.getElementById('app'); target.replaceChildren(); const box = document.createElement('div'); box.className='startup'; box.setAttribute('role','alert'); box.textContent=`스케치 보드를 불러오지 못했습니다. 연결을 확인하고 다시 불러오세요. ${error.message}`; const button=document.createElement('button'); button.textContent='다시 불러오기'; button.onclick=()=>location.reload(); box.append(button); target.append(box); });
