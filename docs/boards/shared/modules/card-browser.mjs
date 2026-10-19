const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function filterCards(items, filters = {}) {
  const {query='',kind='all',status='all',scope='all'}=filters;
  const search=query.trim().toLocaleLowerCase();
  return items.filter(i=>(!search||`${i.title} ${i.id} ${(i.tags??[]).join(' ')}`.toLocaleLowerCase().includes(search))&&(kind==='all'||i.kind===kind)&&(status==='all'||i.status===status)&&(scope==='all'||(scope==='unassigned'?i.listId===null:i.listId===scope)));
}
const previews = {
  building:'<path d="M25 57V29L50 14l25 15v28Z"/><path d="M25 29l25 14 25-14M50 43v29M25 57l25 15 25-15"/><path d="M36 37v10m27-10v10M57 55v13"/>',
  crate:'<path d="M25 31l25-14 25 14v29L50 74 25 60Z"/><path d="M25 31l25 14 25-14M50 45v29M30 37l15 28M45 48L30 55M55 48l15 7M70 37L55 65"/>',
  tree:'<path d="M47 73V51h6v22"/><path d="M50 13L29 42h12L25 58h50L59 42h12Z"/>',
  rock:'<path d="M19 61l12-29 27-12 21 20 4 22-29 13Z"/><path d="M31 32l16 21 32-13M19 61l28-8 7 22M58 20L47 53"/>'
};
/** Controlled card selection and filters. Selection never changes as a side effect of filtering. */
export function mountCardBrowser(root,{onSelect,onFilterChange}) {
  let state={items:[],lists:[],selectedIds:[],filters:{query:'',kind:'all',status:'all',scope:'all'}};
  root.classList.add('catalog-browser');
  root.innerHTML=`<div class="card-filters"><label class="card-search">검색<input type="search" data-filter="query" data-testid="query" placeholder="이름, ID, 태그 검색"></label><label>종류<select data-filter="kind" data-testid="kind"><option value="all">모든 종류</option><option value="building">건물</option><option value="prop">소품</option></select></label><label>상태<select data-filter="status" data-testid="status"><option value="all">모든 상태</option><option value="unreviewed">미검토</option><option value="approved">승인</option><option value="hold">보류</option></select></label></div><div class="card-selection"><button type="button" data-select-visible aria-pressed="false">표시된 카드 모두 선택</button><span role="status" aria-live="polite" data-count></span></div><div class="catalog-card-grid" data-grid></div>`;
  function update(next){
    const focusedCard=root.contains(document.activeElement)?document.activeElement.closest('[data-card]')?.dataset.card:null;
    state=next;
    for(const control of root.querySelectorAll('[data-filter]')){const value=state.filters[control.dataset.filter]??'';if(control.value!==value)control.value=value;}
    const visible=filterCards(state.items,state.filters),selected=new Set(state.selectedIds);
    const selectVisible=root.querySelector('[data-select-visible]');
    const allSelected=visible.length>0&&visible.every(i=>selected.has(i.id));
    selectVisible.setAttribute('aria-pressed',allSelected?'true':visible.some(i=>selected.has(i.id))?'mixed':'false');
    selectVisible.textContent=allSelected?'표시된 카드 선택 해제':'표시된 카드 모두 선택';
    selectVisible.disabled=!visible.length;
    root.querySelector('[data-count]').textContent=`${visible.length} / ${state.items.length}개 표시 · ${selected.size}개 선택`;
    root.querySelector('[data-grid]').innerHTML=visible.map(i=>`<article class="catalog-card ${selected.has(i.id)?'selected':''}"><button type="button" data-card="${esc(i.id)}" aria-pressed="${selected.has(i.id)}"><div class="card-illustration preview-${esc(i.preview)}"><svg viewBox="0 0 100 88" aria-hidden="true">${previews[i.preview]??previews.crate}</svg></div><div class="card-copy"><strong>${esc(i.title)}</strong><small>${esc(i.id)}</small><div class="card-meta"><span>${i.kind==='building'?'건물':'소품'}</span><span>${({unreviewed:'미검토',approved:'승인',hold:'보류'})[i.status]??esc(i.status)}</span></div><small>${esc(state.lists.find(l=>l.id===i.listId)?.name??'미분류')}</small></div></button></article>`).join('')||'<div class="widget-empty card-empty"><strong>일치하는 카드가 없습니다.</strong><p>검색어나 필터를 바꿔 보세요. 선택한 카드는 유지됩니다.</p></div>';
    if(focusedCard)root.querySelector(`[data-card="${CSS.escape(focusedCard)}"]`)?.focus({preventScroll:true});
  }
  const change=e=>{
    const d=e.target.dataset;
    if(d.filter&&state.filters[d.filter]!==e.target.value)onFilterChange({...state.filters,[d.filter]:e.target.value});
  };
  const input=e=>{if(e.target.dataset.filter==='query')change(e);};
  const click=e=>{
    if(e.target.closest('[data-select-visible]')){
      const visible=filterCards(state.items,state.filters),ids=new Set(state.selectedIds);
      const allSelected=visible.length>0&&visible.every(i=>ids.has(i.id));
      for(const item of visible)allSelected?ids.delete(item.id):ids.add(item.id);
      onSelect([...ids]);return;
    }
    const b=e.target.closest('[data-card]');if(!b)return;
    const id=b.dataset.card,ids=new Set(state.selectedIds);
    ids.has(id)?ids.delete(id):ids.add(id);onSelect([...ids]);
  };
  root.addEventListener('change',change);root.addEventListener('input',input);root.addEventListener('click',click);
  return {update,destroy(){root.removeEventListener('change',change);root.removeEventListener('input',input);root.removeEventListener('click',click);root.replaceChildren();root.classList.remove('catalog-browser');}};
}
