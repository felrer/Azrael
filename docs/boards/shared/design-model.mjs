import { BoardError } from './model.mjs';

export const DESIGN_LIMITS = Object.freeze({ items: 24, devices: 16, states: 16, backgrounds: 6, source: 100000, bytes: 1572864 });
const fail = message => { throw new BoardError(message); };
function text(value, label, max = 200, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`${label}을 확인하세요.`);
  return value;
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value) || ['__proto__','prototype','constructor'].includes(value)) fail('식별자를 확인하세요.'); return value; }
function number(value, min, max, label) { if (!Number.isInteger(value) || value < min || value > max) fail(`${label}: ${min}–${max} 정수를 입력하세요.`); return value; }
function color(value) { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('배경은 #rrggbb 색상으로 입력하세요.'); return value; }
function collection(value, key, map) {
  if (!Array.isArray(value) || !value.length || value.length > DESIGN_LIMITS[key]) fail(`${key} 개수는 1–${DESIGN_LIMITS[key]}개입니다.`);
  const ids = new Set();
  return value.map(entry => { const key = id(entry?.id); if (ids.has(key)) fail('중복 식별자가 있습니다.'); ids.add(key); return { id: key, ...map(entry) }; });
}
export function validateDesignDocument(document, definition = { id: 'design' }) {
  if (!document || document.schemaVersion !== 1 || document.kind !== 'design' || document.boardId !== definition.id || document.datasetId !== 'workspace') fail('디자인 보드의 자료 형식이 맞지 않습니다.');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('저장 버전을 확인하세요.');
  if (document.updatedAt !== null && (typeof document.updatedAt !== 'string' || document.updatedAt.length > 40 || !Number.isFinite(Date.parse(document.updatedAt)))) fail('저장 시각을 확인하세요.');
  let bytes; try { bytes = new TextEncoder().encode(JSON.stringify(document)).length; } catch { fail('자료를 읽을 수 없습니다.'); }
  if (bytes > DESIGN_LIMITS.bytes) fail('자료는 1.5 MiB 이하로 줄여주세요.');
  const devices = collection(document.devices, 'devices', d => {
    const width = number(d.width, 120, 4096, '가로'), height = number(d.height, 120, 4096, '세로');
    const safeArea = Object.fromEntries(['top','right','bottom','left'].map(side => [side, number(d.safeArea?.[side], 0, 512, '안전 여백')]));
    if (safeArea.left + safeArea.right >= width || safeArea.top + safeArea.bottom >= height) fail('안전 여백은 화면 안에 있어야 합니다.');
    return { name: text(d.name, '기기 이름', 80), width, height, safeArea };
  });
  const states = collection(document.states, 'states', s => ({ name: text(s.name, '상태 이름', 80) }));
  const backgrounds = collection(document.backgrounds, 'backgrounds', b => ({ name: text(b.name, '배경 이름', 80), color: color(b.color) }));
  const items = collection(document.items, 'items', item => ({ title: text(item.title, '디자인 이름'), description: text(item.description, '설명', 1000, true), html: text(item.html, 'HTML', DESIGN_LIMITS.source, true), css: text(item.css, 'CSS', DESIGN_LIMITS.source, true), note: text(item.note, '메모', 5000, true) }));
  const s = document.settings;
  if (!s || !devices.some(d => d.id === s.deviceId) || !states.some(state => state.id === s.stateId) || !['fit','100','50'].includes(s.zoom) || typeof s.showSafeArea !== 'boolean' || !items.some(item => item.id === s.selectedId)) fail('미리보기 설정의 연결을 확인하세요.');
  return { schemaVersion: 1, kind: 'design', boardId: definition.id, datasetId: 'workspace', revision: document.revision, title: text(document.title,'보드 제목'), updatedAt: document.updatedAt,
    devices, states, backgrounds, items, sample: { width: number(document.sample?.width, 32, 1024, '비교 가로'), height: number(document.sample?.height, 32, 1024, '비교 세로') },
    settings: { deviceId: s.deviceId, stateId: s.stateId, zoom: s.zoom, background: color(s.background), showSafeArea: s.showSafeArea, selectedId: s.selectedId } };
}

export function createDesignDocument(definition) {
  const html = `<main class="demo"><article class="card"><div class="mark" aria-hidden="true">✦</div><p class="eyebrow">NEXT STEP</p><h1>작은 시작, 새로운 가능성</h1><p class="intro">기기에 따라 바뀌는 카드 디자인입니다.</p><p class="normal">오늘의 아이디어를 차곡차곡 모아보세요.</p><p class="loading">자료를 준비하고 있어요…</p><p class="empty">첫 아이디어를 추가해 보세요.</p><button type="button">계속하기 <span aria-hidden="true">→</span></button></article></main>`;
  const css = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;color:#252525}.demo{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(100%,480px);padding:32px;border:1px solid #dededb;border-radius:24px;background:#fafaf8;box-shadow:0 10px 40px #0000000a}.mark{font-size:36px}.eyebrow{font-size:11px;letter-spacing:.18em;color:#686864;margin:20px 0 10px}h1{font-size:28px;line-height:1.25;margin:0 0 14px;letter-spacing:-.04em}.intro,.normal,.loading,.empty{font-size:14px;line-height:1.6;color:#656561}.normal,.loading,.empty{margin:20px 0}.loading,.empty{display:none}button{width:100%;border:0;border-radius:12px;padding:14px 18px;background:#242424;color:white;font:inherit;font-weight:600;display:flex;justify-content:space-between}[data-preview-state="loading"] .normal,[data-preview-state="empty"] .normal{display:none}[data-preview-state="loading"] .loading,[data-preview-state="empty"] .empty{display:block}[data-preview-state="loading"] button{opacity:.5}@media(max-width:480px){.demo{padding:16px}.card{padding:24px;border-radius:18px}h1{font-size:24px}.mark{font-size:28px}}@media(max-height:300px){.demo{padding:12px}.card{padding:16px;border-radius:14px}.mark,.intro,.eyebrow{display:none}h1{font-size:18px;margin-bottom:8px}.normal,.loading,.empty{font-size:12px;margin:10px 0}button{padding:10px 12px;font-size:12px}}`;
  return { schemaVersion: 1, kind: 'design', boardId: definition.id, datasetId: 'workspace', revision: 0, title: definition.title, updatedAt: null,
    devices: [{ id:'desktop',name:'데스크톱',width:1280,height:720,safeArea:{top:0,right:0,bottom:0,left:0} },{ id:'tablet',name:'태블릿',width:1024,height:768,safeArea:{top:0,right:0,bottom:0,left:0} },{ id:'mobile',name:'모바일 세로',width:390,height:844,safeArea:{top:44,right:0,bottom:34,left:0} },{ id:'landscape',name:'모바일 가로',width:844,height:390,safeArea:{top:0,right:44,bottom:21,left:44} }],
    states:[{id:'normal',name:'기본'},{id:'loading',name:'로딩'},{id:'empty',name:'빈 상태'}],
    backgrounds:[{id:'gray',name:'중간 배경',color:'#858585'},{id:'light',name:'밝은 배경',color:'#f2f2f2'},{id:'dark',name:'어두운 배경',color:'#242424'}],
    sample:{width:320,height:220}, items:[{id:'quiet',title:'A · 차분한 카드',description:'여백과 타이포그래피에 집중한 기본안',html,css,note:''}, {id:'contrast',title:'B · 선명한 대비',description:'짙은 표면과 밝은 액션 버튼',html,css:css+'\n.card{background:#202725;border-color:#404945;color:#f7f7f4}.eyebrow,.intro,.normal,.loading,.empty{color:#c0c8c1}button{background:#dcebb4;color:#233023}.mark{color:#dcebb4}',note:''}, {id:'outline',title:'C · 윤곽과 포인트',description:'투명 표면에 선과 포인트 색상을 사용한 안',html,css:css+'\n.card{background:transparent;border:2px solid #202725;box-shadow:none}.mark{color:#5347b8}button{background:#5347b8}',note:''}],
    settings:{deviceId:'desktop',stateId:'normal',zoom:'fit',background:'#e6e6e2',showSafeArea:false,selectedId:'quiet'} };
}
