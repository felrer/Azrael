import { validateDesignDocument } from '/shared/design-model.mjs';
import { buildPreviewDocument } from '/shared/preview-document.mjs';
import { mountDevicePreview } from '/shared/modules/device-preview.mjs';
import { mountDesignGallery } from '/shared/modules/design-gallery.mjs';

const app=document.querySelector('#app'), $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,doc,baseline,token,pending=false,view='device',devicePreview,gallery,modal,undo=[],redo=[];
const raw=new Map(),key=(id,field)=>`${id}:${field}`;
const dirty=()=>doc&&(raw.size>0 || JSON.stringify(doc)!==baseline);
const selected=()=>doc.items.find(item=>item.id===doc.settings.selectedId);
async function request(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Board-Token':token,'X-Board-Storage':encodeURIComponent(state.storage.root)}:{},...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json(); if(!response.ok)throw Error(`${result.error}${result.requestId?` (${result.requestId})`:''}`); return result;
}
function notice(text,error=false){$('notice').hidden=false;$('notice').classList.toggle('error',error);$('notice-text').textContent=text;}
function adopt(next){state=next;doc=structuredClone(next.document);baseline=JSON.stringify(doc);raw.clear();undo=[];redo=[];}
function change(mutator){
  const candidate=structuredClone(doc);mutator(candidate);const next=validateDesignDocument(candidate);
  if(JSON.stringify(next)!==JSON.stringify(doc)){undo.push(doc);if(undo.length>20)undo.shift();redo=[];doc=next;}
}
function safeChange(mutator){if(pending)return;try{change(mutator);render();}catch(error){notice(error.message,true);}}
function history(back){if(pending)return;if(back&&raw.size){raw.clear();render(true);return;}const source=back?undo:redo,target=back?redo:undo;if(!source.length)return;target.push(doc);doc=source.pop();render(true);}
async function perform(path,body,message){
  if(pending)return;if(path==='/api/save'&&raw.size){notice('입력 오류를 먼저 수정해 주세요.',true);return;}
  pending=true;render();
  for(const control of app.querySelectorAll('button,input,textarea,select'))control.disabled=true;
  try{const next=await request(path,body);if(path==='/api/backup')state=next;else adopt(next);notice(message);}
  catch(error){notice(error.message,true);}
  finally{pending=false;render(true);}
}
function confirmDiscard(){return !dirty()||confirm('저장하지 않은 편집 내용을 버리고 계속할까요?');}
function value(item,field){return raw.get(key(item.id,field))?.value??item[field];}
function renderEditor(){
  const item=selected();
  $('editor').innerHTML=`<div class="section-head"><h2>디자인 편집</h2><span class="muted">${esc(item.id)}</span></div><label class="field"><span>이름</span><input name="title" maxlength="200" value="${esc(value(item,'title'))}"></label><label class="field"><span>설명</span><textarea name="description" maxlength="1000" rows="2">${esc(value(item,'description'))}</textarea></label><label class="field"><span>검토 메모</span><textarea name="note" maxlength="5000" rows="3">${esc(value(item,'note'))}</textarea></label><details class="source-editor"><summary>HTML / CSS 편집</summary><p class="muted">HTML 본문 조각과 CSS를 입력하세요. 상태는 <code>[data-preview-state="loading"]</code>으로 구분합니다.</p><label class="field"><span>HTML</span><textarea name="html" spellcheck="false" maxlength="100000" rows="10">${esc(value(item,'html'))}</textarea></label><label class="field"><span>CSS</span><textarea name="css" spellcheck="false" maxlength="100000" rows="12">${esc(value(item,'css'))}</textarea></label><p class="muted">정적 HTML/CSS와 인라인 SVG·data 이미지로 미리 봅니다. 외부 자원과 스크립트는 실행하지 않습니다.</p></details><div id="edit-error" class="edit-error" role="alert"></div><div class="actions item-actions"><button id="duplicate">복제</button><button id="delete-design" class="danger" ${doc.items.length===1?'disabled':''}>삭제</button></div>`;
  updateErrors();
}
function updateErrors(){
  const item=selected(),errors=[];for(const input of $('editor').querySelectorAll('[name]')){const entry=raw.get(key(item.id,input.name));input.setAttribute('aria-invalid',String(!!entry));if(entry)errors.push(entry.error);}
  $('edit-error').textContent=errors.join(' ');
}
function render(editor=false){
  if(!doc)return;
  $('save-status').textContent=pending?'처리 중…':dirty()?'저장하지 않은 변경':'저장됨 · 버전 '+doc.revision;
  $('save-status').classList.toggle('dirty',!pending&&dirty());
  $('storage-path').textContent=state.storage.root;
  $('design-list').innerHTML=doc.items.map(item=>`<button class="design-row ${item.id===doc.settings.selectedId?'active':''}" data-design="${esc(item.id)}" aria-pressed="${item.id===doc.settings.selectedId}"><span>${esc(item.title)}</span>${raw.has(key(item.id,'title'))?'<span class="muted">입력 오류</span>':''}</button>`).join('');
  $('preview-pane').hidden=view!=='device';$('gallery-pane').hidden=view!=='gallery';
  for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-pressed',String(button.dataset.view===view));
  if(view==='device')devicePreview.update({devices:doc.devices,states:doc.states,content:selected(),settings:doc.settings});
  else gallery.update({items:doc.items,selectedId:doc.settings.selectedId,stateId:doc.settings.stateId,backgrounds:doc.backgrounds,sample:doc.sample});
  for(const control of app.querySelectorAll('button,input,textarea,select'))control.disabled=pending;
  $('save').disabled=pending||!dirty()||raw.size>0;$('undo').disabled=pending||(!undo.length&&!raw.size);$('redo').disabled=pending||!redo.length;
  if(editor)renderEditor();
  if($('delete-design'))$('delete-design').disabled=pending||doc.items.length===1;
}
function closeModal(){if(modal){const previous=modal;modal=null;previous.close();previous.remove();}}
function dialog(title,html){closeModal();modal=document.createElement('dialog');modal.className='design-dialog';modal.innerHTML=`<div class="section-head"><h2>${esc(title)}</h2><button data-close aria-label="닫기">닫기</button></div>${html}<p id="dialog-error" class="edit-error" role="alert"></p>`;document.body.append(modal);modal.querySelector('[data-close]').onclick=closeModal;const current=modal;current.addEventListener('close',()=>{current.remove();if(modal===current)modal=null;});current.showModal();return current;}
function presets(){
  const current=doc.devices.find(d=>d.id===doc.settings.deviceId);
  const box=dialog('기기·상태·비교 설정',`<p class="muted">크기는 CSS px입니다. 안전 여백은 직접 입력한 검토 기준입니다.</p><form id="device-form"><h3>선택한 기기</h3><label class="field"><span>기기 이름</span><input name="name" value="${esc(current.name)}" maxlength="80" required></label><div class="pair">${['width','height'].map((field,i)=>`<label class="field"><span>${i?'세로':'가로'}</span><input name="${field}" type="number" min="120" max="4096" value="${current[field]}" required></label>`).join('')}</div><div class="inset-grid">${['top','right','bottom','left'].map((side,i)=>`<label class="field"><span>${['위','오른쪽','아래','왼쪽'][i]} 여백</span><input name="${side}" type="number" min="0" max="512" value="${current.safeArea[side]}" required></label>`).join('')}</div><div class="actions"><button type="submit">기기 적용</button><button type="button" id="copy-device">새 기기로 추가</button><button type="button" id="delete-device" ${doc.devices.length===1?'disabled':''}>기기 삭제</button></div></form><details class="preset-source"><summary>모든 프리셋 편집</summary><p class="muted">기기·상태·배경을 자유롭게 추가하세요. id는 영문·숫자·하이픈으로 구분합니다. 상태 id는 CSS의 data-preview-state 값입니다.</p><label class="field"><span>기기 / 상태 / 배경 / 비교 크기 JSON</span><textarea id="preset-json" spellcheck="false" rows="18">${esc(JSON.stringify({devices:doc.devices,states:doc.states,backgrounds:doc.backgrounds,sample:doc.sample},null,2))}</textarea></label><button id="apply-presets">전체 프리셋 적용</button></details>`);
  const applyDevice=copy=>{
    const form=box.querySelector('form');if(!form.reportValidity())return;const values=new FormData(form);
    try{change(next=>{const device={id:copy?'device-'+crypto.randomUUID():current.id,name:values.get('name'),width:Number(values.get('width')),height:Number(values.get('height')),safeArea:Object.fromEntries(['top','right','bottom','left'].map(side=>[side,Number(values.get(side))]))};if(copy)next.devices.push(device);else next.devices[next.devices.findIndex(d=>d.id===current.id)]=device;next.settings.deviceId=device.id;});closeModal();render();notice('기기 설정을 편집본에 적용했습니다. 저장하면 다음에도 유지됩니다.');}catch(error){$('dialog-error').textContent=error.message;}
  };
  box.querySelector('form').onsubmit=event=>{event.preventDefault();applyDevice(false);};
  $('copy-device').onclick=()=>applyDevice(true);
  $('delete-device').onclick=()=>{if(doc.devices.length===1)return;change(next=>{next.devices=next.devices.filter(d=>d.id!==current.id);next.settings.deviceId=next.devices[0].id;});closeModal();render();};
  $('apply-presets').onclick=()=>{try{const config=JSON.parse($('preset-json').value);change(next=>{for(const field of ['devices','states','backgrounds','sample'])next[field]=config[field];if(!config.devices?.some(d=>d.id===next.settings.deviceId))next.settings.deviceId=config.devices?.[0]?.id;if(!config.states?.some(s=>s.id===next.settings.stateId))next.settings.stateId=config.states?.[0]?.id;});closeModal();render();notice('프리셋을 편집본에 적용했습니다.');}catch(error){$('dialog-error').textContent=error.message;}};
}
function storage(){
  const box=dialog('저장 위치·백업',`<p class="muted">위치 변경은 선택한 폴더의 자료를 엽니다. 현재 파일을 이동하거나 삭제하지 않습니다.</p><label class="field"><span>자료 폴더의 절대 경로</span><input id="data-root" value="${esc(state.storage.root)}"></label><button id="change-root">이 위치 열기</button><div class="settings-section"><div class="section-head"><h3>백업</h3><button id="backup">현재 저장본 백업</button></div>${state.backups.map(b=>`<div class="settings-row"><span>${esc(b.createdAt)} · 버전 ${b.revision}</span><button data-restore="${esc(b.id)}">복원</button></div>`).join('')||'<p class="muted">아직 백업이 없습니다. 저장 시 이전 버전이 자동으로 보존됩니다.</p>'}</div>`);
  $('change-root').onclick=()=>{if(!confirmDiscard())return;const root=$('data-root').value;closeModal();void perform('/api/storage',{root},'저장 위치의 자료를 열었습니다.');};
  $('backup').onclick=()=>{closeModal();void perform('/api/backup',{expectedRevision:doc.revision},'현재 저장본을 백업했습니다.');};
  box.onclick=event=>{const button=event.target.closest('[data-restore]');if(!button||!confirmDiscard()||!confirm('선택한 백업으로 복원할까요? 현재 저장본도 백업합니다.'))return;const backupId=button.dataset.restore;closeModal();void perform('/api/restore',{backupId,expectedRevision:doc.revision},'백업을 복원했습니다.');};
}
function download(){const item=selected(),device=doc.devices.find(d=>d.id===doc.settings.deviceId),html=buildPreviewDocument({...item,stateId:doc.settings.stateId,background:doc.settings.background,safeArea:device.safeArea});const url=URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${item.id}-${doc.settings.stateId}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('현재 편집본의 HTML을 내보냈습니다. 문서 저장과는 별개입니다.');}
async function handoff(){if(dirty()){notice('고정 전달본을 만들려면 먼저 저장하세요.',true);return;}if(pending)return;pending=true;render();try{const result=await request('/api/export',{expectedRevision:doc.revision,itemIds:[doc.settings.selectedId]});const path=result.handoff?.markdownPath;adopt(result);const box=dialog('고정 전달본',`<p>이 경로를 대화에 보내면 선택한 디자인과 프리셋·해석 지침을 함께 읽을 수 있습니다.</p><p class="preview" id="handoff-path"></p>`);box.querySelector('#handoff-path').textContent=path??JSON.stringify(result.handoff);}catch(error){notice(error.message,true);}finally{pending=false;render();}}
function mount(){
  app.innerHTML=`<div class="app-shell"><header class="topbar"><div><h1>디자인 보드</h1><p>기기별 미리보기와 디자인안 비교 <span class="demo-label">합성 예제</span></p></div><div class="actions"><span id="save-status" class="status" aria-live="polite"></span><button id="undo" title="실행 취소">되돌리기</button><button id="redo">다시 실행</button><button id="reload">다시 열기</button><button id="save" class="primary">저장</button><button id="settings">저장·백업</button><button id="theme" aria-label="테마 변경">테마</button></div></header><div id="notice" class="notice" hidden><span id="notice-text" role="status"></span><button id="dismiss" class="flat" aria-label="알림 닫기">닫기</button></div><div class="design-workspace"><aside class="design-sidebar"><div class="section-head"><h2>디자인안</h2><button id="add-design" aria-label="디자인안 추가">＋ 추가</button></div><nav id="design-list" aria-label="디자인안 목록"></nav><p class="muted sidebar-help">검토할 안을 선택하고 메모를 남기세요.</p></aside><main class="design-main"><div class="design-toolbar"><div class="actions" aria-label="보기 선택"><button data-view="device" aria-pressed="true">기기별 미리보기</button><button data-view="gallery" aria-pressed="false">디자인안 비교</button></div><div class="actions"><button id="presets">기기·상태 설정</button><button id="download">HTML 내보내기</button><button id="handoff">전달본</button></div></div><section id="preview-pane" aria-label="기기별 미리보기"></section><section id="gallery-pane" aria-label="디자인안 비교" hidden></section><p class="preview-hint muted">가상 화면은 CSS px 기준입니다. 실제 기기의 글꼴·배율·엔진 렌더링은 별도 확인이 필요합니다.</p></main><aside class="design-inspector"><form id="editor" autocomplete="off"></form></aside></div><footer class="design-footer"><span>자료 위치</span><span id="storage-path"></span></footer></div>`;
  devicePreview=mountDevicePreview($('preview-pane'),{onChange:patch=>safeChange(next=>Object.assign(next.settings,patch))});
  gallery=mountDesignGallery($('gallery-pane'),{onSelect:id=>{safeChange(next=>{next.settings.selectedId=id;});renderEditor();}});
  $('design-list').onclick=event=>{const button=event.target.closest('[data-design]');if(button){safeChange(next=>{next.settings.selectedId=button.dataset.design;});renderEditor();}};
  $('editor').onsubmit=event=>event.preventDefault();
  $('editor').oninput=event=>{if(pending)return;const field=event.target.name;if(!['title','description','note','html','css'].includes(field))return;const item=selected(),fieldKey=key(item.id,field);try{change(next=>{next.items.find(i=>i.id===item.id)[field]=event.target.value;});raw.delete(fieldKey);}catch(error){raw.set(fieldKey,{value:event.target.value,error:error.message});}updateErrors();render();};
  $('editor').onclick=event=>{if(pending)return;const button=event.target.closest('button');if(button?.id==='duplicate')add(true);if(button?.id==='delete-design'&&doc.items.length>1&&confirm('선택한 디자인안을 삭제할까요? 저장 전에는 되돌릴 수 있습니다.')){const id=doc.settings.selectedId;safeChange(next=>{next.items=next.items.filter(i=>i.id!==id);next.settings.selectedId=next.items[0].id;});for(const entry of [...raw.keys()])if(entry.startsWith(id+':'))raw.delete(entry);render(true);}};
  function add(copy){if(pending)return;if(raw.size){notice('입력 오류를 수정한 뒤 디자인안을 추가하세요.',true);return;}const item=copy?structuredClone(selected()):{title:'새 디자인',description:'',html:'<main><h1>새 디자인</h1><p>HTML/CSS를 편집해 보세요.</p></main>',css:'body{margin:0;padding:24px;font-family:system-ui,sans-serif}',note:''};item.id='design-'+crypto.randomUUID();item.title=copy?item.title.slice(0,195)+' 복사':item.title;safeChange(next=>{next.items.push(item);next.settings.selectedId=item.id;});renderEditor();}
  $('add-design').onclick=()=>add(false);$('undo').onclick=()=>history(true);$('redo').onclick=()=>history(false);
  $('save').onclick=()=>perform('/api/save',{document:doc,expectedRevision:doc.revision},'자료를 파일에 저장했습니다.');
  $('reload').onclick=async()=>{if(pending||!confirmDiscard())return;pending=true;render();try{adopt(await request('/api/state'));notice('저장된 자료를 다시 열었습니다.');}catch(error){notice(error.message,true);}finally{pending=false;render(true);}};
  $('settings').onclick=storage;$('presets').onclick=presets;$('download').onclick=download;$('handoff').onclick=handoff;
  $('theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';};
  $('dismiss').onclick=()=>{$('notice').hidden=true;};
  for(const button of app.querySelectorAll('[data-view]'))button.onclick=()=>{view=button.dataset.view;render();};
  addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
  render(true);
}
try{token=(await request('/api/session')).token;adopt(await request('/api/state'));mount();}
catch(error){app.innerHTML=`<main class="startup"><h1>디자인 보드를 열지 못했습니다</h1><p>${esc(error.message)}</p><p>서버와 저장 위치를 확인한 뒤 다시 열어주세요.</p></main>`;}
