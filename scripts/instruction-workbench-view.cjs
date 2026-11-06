'use strict';

// This renderer has no filesystem or installed-application authority. Its transport
// talks only to the workbench service supplied by the embedding server.
function workbenchClient(token, locale, {native = false, projectId = '', root, postMessage, subscribe} = {}) {
  const scope = root || document;
  const ownerDocument = root ? root.ownerDocument : document;
  const themeRoot = root ? root.host : document.documentElement;
  const removers = [];
  let disposed = false, suppressClickTimer = null;
  function listen(target, type, handler, options) {
    const activeHandler = (...args) => { if (!disposed) return handler(...args); };
    target.addEventListener(type, activeHandler, options);
    removers.push(() => target.removeEventListener(type, activeHandler, options));
  }
  function on(target, type, handler) {
    const property = 'on'+type, previous = target[property];
    const activeHandler = (...args) => { if (!disposed) return handler(...args); };
    target[property] = activeHandler;
    removers.push(() => { if (target[property] === activeHandler) target[property] = previous; });
  }
  const ko = locale.startsWith('ko');
  const t = (a, b) => ko ? a : b;
  const $ = (id) => scope.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name) => {
    const paths = {package:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>', plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', check:'<path d="m5 12 4 4L19 6"/>', local:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>', github:'<path d="M9 19c-5 1-5-3-7-3m14 6v-4c0-1-.3-2-1-2 4-.5 7-2 7-6 0-2-.5-3-2-4 .2-1 .2-3-.2-4-2 0-3 1-4 2a15 15 0 0 0-8 0C7 3 5 2 3 2c-.5 1-.5 3 0 4C2 7 2 8 2 10c0 4 3 6 7 6-.5.5-1 1-1 2v4"/>', refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>', moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', profile:'<circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>', arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'};
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.package) + '</svg>';
  };
  const image = (p) => typeof p.image === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(p.image) ? '<img src="'+esc(p.image)+'" alt="">' : icon('package');
  const profileImage = p => '<span class="profile-avatar">'+(p.image ? image(p) : icon('profile'))+'</span>';
  const protectedProfile = p => p.isDefault || p.isTemplate || p.builtin || p.readOnly || ['builtin','template'].includes(p.source?.kind);
  const cardMenu = (name, content) => '<details class="card-menu"><summary aria-label="'+esc(t('추가 작업: ','More actions: ')+name)+'">⋯</summary><div class="card-menu-items">'+content+'</div></details>';
  const formImages = new WeakMap();
  function imageField(readonly = false) {
    return '<fieldset class="image-field"'+(readonly ? ' disabled' : '')+'><legend>'+t('이미지','Image')+'</legend><div class="image-editor-preview"></div>'+(!readonly ? '<label>'+t('로컬 이미지 선택','Choose local image')+'<input type="file" name="localImage" accept="image/png,image/jpeg,image/webp"></label><small class="muted">PNG, JPEG, WebP · '+t('최대 2 MiB','Up to 2 MiB')+'</small><button type="button" data-remove-image>'+t('이미지 제거','Remove image')+'</button>' : '')+'</fieldset>';
  }
  function attachImage(form, initial = '', readonly = false) {
    const field = form.querySelector('.image-field'), preview = field.querySelector('.image-editor-preview'), input = field.querySelector('input'), remove = field.querySelector('[data-remove-image]');
    let serial = 0;
    const render = () => { const value = formImages.get(form) || ''; preview.innerHTML = value ? image({image:value}) : '<span class="muted">'+t('이미지 없음','No image')+'</span>'; if (remove) remove.hidden = !value; };
    formImages.set(form,initial); render();
    if (readonly) return;
    let reading = false;
    listen(form,'submit',event => { if (reading) { event.preventDefault(); event.stopImmediatePropagation(); error(new Error(t('이미지를 읽는 중입니다. 잠시 후 저장하세요.','The image is loading. Save again when it is ready.')),$('dialog-error')); } },true);
    on(remove,'click',() => { serial++; reading = false; formImages.set(form,''); input.value = ''; render(); });
    on(input,'change',async () => {
      const file = input.files?.[0], request = ++serial; if (!file) return;
      reading = true;
      try {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) throw new Error(t('2 MiB 이하의 PNG, JPEG 또는 WebP 이미지를 선택하세요.','Choose a PNG, JPEG or WebP image up to 2 MiB.'));
        const value = await dataURL(file);
        if (disposed || !form.isConnected || serial !== request) return;
        formImages.set(form,value); render();
      } catch (err) { if (form.isConnected && serial === request) error(err,$('dialog-error')); }
      finally { if (serial === request) { reading = false; input.value = ''; } }
    });
  }
  function confirmDelete(name, submit) {
    openDialog(t('삭제 확인','Confirm deletion'),'<form id="delete-confirmation"><p>'+esc(t('삭제할 항목: ','Delete: ')+name)+'</p><p class="muted">'+t('이 작업은 되돌릴 수 없습니다.','This action cannot be undone.')+'</p><div class="composer-footer">'+button(t('취소','Cancel'),'close')+'<button type="submit" class="danger">'+t('삭제','Delete')+'</button></div></form>');
    const form = $('delete-confirmation'); on(form,'submit',event => { event.preventDefault(); submit(form); });
    form.querySelector('[data-action="close"]').focus();
  }
  const badge = (label, glyph) => '<span class="badge" title="'+esc(label)+'">'+icon(glyph)+'<span>'+esc(label)+'</span></span>';
  const button = (label, action, value = '', cls = '') => '<button type="button" class="'+cls+'" data-action="'+action+'" data-value="'+esc(value)+'"'+(action === 'duplicate-profile' ? ' data-busy-action="duplicateProfile"' : '')+'>'+esc(label)+'</button>';
  const markupCache = new WeakMap();
  const html = (el, markup) => { if (markupCache.get(el) !== markup) { el.innerHTML = markup; markupCache.set(el,markup); } };
  let state = null, project = native ? projectId : '', generation = 0, poll = null, detail = null, draft = null, pending = new Set(), detailSerial = 0;
  let projectStatusFailed = false, projectPending = true;
  let roleState = null, roleLoading = false;
  let pointerDrag = null, nativeDragProject = null, suppressHandleClick = false;
  const projectReady = () => Boolean(!projectPending && state && (state.projectId || '') === project);
  const captured = [];
  const profileSelectors = new WeakMap();
  const profileProjects = new WeakMap();
  const profileComposers = new WeakMap();
  const headers = {'X-Azrael-Token':token};
  const requests = new Map();
  const requestPrefix = 'workbench-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-';
  let bridge = null, bridgeError = null, requestSerial = 0;
  if (native) {
    try { bridge = postMessage ? {postMessage} : acquireVsCodeApi(); } catch (err) { bridgeError = err; }
    const receive = message => {
      if (disposed) return;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'azraelWorkbenchContextChanged') {
        if (typeof message.projectId !== 'string') return;
        if (project !== message.projectId) {
          project = message.projectId; generation++; projectPending = true; projectStatusFailed = false;
          if (state) render(); else renderPendingProject();
        }
        refresh();
        loadRoles();
        return;
      }
      if (message.type === 'azraelWorkbenchChanged') {
        if (message.projectId === undefined || message.projectId === project) refresh();
        return;
      }
      if (message.type !== 'azraelWorkbenchResponse' || typeof message.ok !== 'boolean') return;
      const request = requests.get(message.id);
      if (!request) return;
      requests.delete(message.id); clearTimeout(request.timer);
      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(typeof message.error === 'string' ? message.error : t('요청을 처리하지 못했습니다.','Unable to complete the request.')));
    };
    if (subscribe) removers.push(subscribe(receive));
    else listen(window, 'message', event => receive(event.data));
    if (!root) listen(window, 'pagehide', dispose);
  }
  async function api(path, body) {
    if (disposed) throw new Error(t('화면이 닫혔습니다.','The view was closed.'));
    if (native) {
      if (!bridge) throw bridgeError || new Error(t('앱 연결을 사용할 수 없습니다.','The app connection is unavailable.'));
      return new Promise((resolve, reject) => {
        const id = requestPrefix+(++requestSerial);
        const timer = setTimeout(() => { requests.delete(id); reject(new Error(t('요청 시간이 초과되었습니다. 다시 시도하세요.','The request timed out. Please retry.'))); }, 60000);
        requests.set(id, {resolve,reject,timer});
        try { bridge.postMessage({type:'azraelWorkbenchRequest',id,path,...(body === undefined ? {} : {body})}); }
        catch (err) { requests.delete(id); clearTimeout(timer); reject(err); }
      });
    }
    const response = await fetch(path, {method:body ? 'POST' : 'GET', headers:body ? {...headers,'Content-Type':'application/json'} : headers, body:body ? JSON.stringify(body) : undefined, cache:'no-store'});
    let result; try { result = await response.json(); } catch { throw new Error(t('응답을 읽을 수 없습니다.', 'Unable to read server response.')); }
    if (!response.ok || result?.error) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || response.statusText);
    return result;
  }
  function error(err, target = $('error')) { if (disposed || !target) return; target.textContent = err?.message || String(err); target.hidden = false; }
  async function act(action, payload = {}, {close = false} = {}) {
    if (disposed) return;
    if ((['equip','unequip','captureRequest','saveProfile','duplicateProfile','deleteProfile'].includes(action) || (action === 'createProfile' && payload.equip)) && !projectReady()) return;
    if (pending.has(action)) return;
    pending.add(action);
    const submittedForm = close ? $('dialog-body').querySelector('form') : null;
    const dialogError = $('dialog-error');
    if (dialogError) dialogError.hidden = true;
    $('error').hidden = true;
    scope.querySelectorAll('[data-busy-action="'+action+'"]').forEach(el => el.disabled = true);
    try {
      const result = await api('/api/action', {action,payload});
      if (disposed) return;
      if (action === 'captureRequest') { captured.unshift(result); renderSnapshots(); }
      if (close && (!submittedForm || submittedForm === $('dialog-body').querySelector('form'))) $('dialog').close();
      await refresh();
      if (['saveProfile','duplicateProfile','deleteProfile'].includes(action)) await loadRoles();
      if (disposed) return;
      $('notice').textContent = action === 'captureRequest' ? t('요청 접수 당시 스냅샷을 보관했습니다.', 'Captured the request-time snapshot.') : native ? t('저장했습니다.', 'Saved.') : t('개발 작업공간에 저장했습니다.', 'Saved to the development workspace.');
      return result;
    } catch (err) { error(err, $('dialog').open && $('dialog-error') ? $('dialog-error') : $('error')); return null; }
    finally { pending.delete(action); if (!disposed) { scope.querySelectorAll('[data-busy-action="'+action+'"]').forEach(el => el.disabled = false); updateProjectControls(); } }
  }
  async function refresh() {
    if (disposed) return;
    const requestGeneration = ++generation, requestedProject = project;
    clearTimeout(poll);
    try {
      const next = await api('/api/state?project='+encodeURIComponent(requestedProject));
      if (requestGeneration !== generation || requestedProject !== project) return;
      if (native && (next.projectId || '') !== project) { project = next.projectId || ''; generation++; }
      if (projectPending || projectStatusFailed) $('error').hidden = true;
      state = next; projectPending = false; projectStatusFailed = false; render();
      if (next.github?.phase === 'loading') poll = setTimeout(refresh, 1000);
    } catch (err) { if (requestGeneration === generation) { error(err); if (!projectReady()) { projectStatusFailed = true; if (state) render(); else renderPendingProject(); } } }
  }
  const rootProfile = p => p && (p.allowedRoles || ['root']).includes('root');
  function updateProjectControls() {
    if (disposed) return;
    scope.querySelectorAll('[data-action="equip"],[data-action="unequip"]').forEach(el => { el.disabled = !projectReady() || !project || pending.has(el.dataset.action) || (el.dataset.action === 'equip' && !rootProfile(state?.profiles?.find(p => p.id === el.dataset.value))); if (el.matches('[role="button"]')) el.setAttribute('aria-disabled',String(el.disabled)); });
    scope.querySelectorAll('[data-action="duplicate-profile"]').forEach(el => { el.disabled = !projectReady() || pending.has('duplicateProfile'); });
    scope.querySelectorAll('[data-action="capture"]').forEach(el => { el.disabled = !projectReady() || pending.has('captureRequest'); });
    const save = scope.querySelector('#profile-form [type="submit"]');
    if (save) save.disabled = !projectReady() || pending.has('saveProfile') || profileComposers.get($('profile-form'))?.readOnly;
  }
  function renderPendingProject() {
    html($('active-slot'), '<div class="slot-symbol">'+icon('profile')+'</div><div class="grow"><span class="eyebrow">'+t('활성 프로필','ACTIVE PROFILE')+'</span><h3>'+t(projectStatusFailed ? '프로필 상태를 확인하지 못했습니다.' : '프로필 상태 확인 중',projectStatusFailed ? 'Unable to load profile status.' : 'Checking profile status')+'</h3><p>'+t('선택한 프로젝트의 상태를 확인한 뒤 장착할 수 있습니다.','Equip a profile after the selected project status is loaded.')+'</p></div>'+(projectStatusFailed ? button(t('재시도','Retry'),'retry-project') : ''));
    $('active-slot').setAttribute('aria-disabled','true');
    updateProjectControls();
  }
  function render() {
    const options = native ? '<option value="'+esc(project)+'">'+esc((state.projects || []).find(p => p.id === project)?.name || project || t('프로젝트 없음 · 기본 설정','No project · defaults'))+'</option>' : '<option value="">'+t('프로젝트 없음 · 기본 설정','No project · defaults')+'</option>' + (state.projects || []).map(p => '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
    if ($('project').innerHTML !== options) $('project').innerHTML = options;
    $('project').value = project;
    const active = project && projectReady() ? state.active : null;
    html($('active-slot'), '<div class="slot-symbol">'+icon(active ? 'check' : 'profile')+'</div><div class="grow"><span class="eyebrow">'+t('활성 프로필','ACTIVE PROFILE')+'</span><h3>'+esc(active?.name || t('Azrael 기본 설정','Azrael defaults'))+'</h3><p>'+esc(active ? [active.model,active.reasoningEffort].filter(Boolean).join(' · ') : project ? t('아래 프로필을 끌어 놓거나 장착하세요.','Drop a saved profile here or choose Equip.') : t('프로젝트 없는 대화는 기본 설정을 사용합니다.','Conversations without a project use defaults.'))+'</p>'+(active?.appliedDiffers ? '<p class="profile-diagnostic">'+t('저장된 설정과 적용된 설정이 다릅니다.','Saved settings differ from applied settings.')+'</p>' : '')+'</div>'+(active && !active.isDefault ? button(t('해제','Unequip'),'unequip') : ''));
    $('active-slot').setAttribute('aria-disabled', String(!project));
    const profiles = state.profiles || [];
    html($('profiles'), profiles.length ? profiles.map(p => '<article class="profile interactive-card" data-profile="'+esc(p.id)+'" data-action="edit-profile" data-value="'+esc(p.id)+'" role="button" tabindex="0" aria-label="'+esc(p.name)+'">'+cardMenu(p.name,button(t("복제","Duplicate"),'duplicate-profile',p.id)+(!protectedProfile(p) ? button(t("삭제","Delete"),'delete-profile',p.id,'danger') : ''))+'<div class="profile-heading">'+profileImage(p)+'<strong>'+esc(p.name)+'</strong>'+(active?.id === p.id ? badge(t("활성","Active"),'check') : '')+(p.isDefault ? badge(t("기본","Default"),'profile') : '')+'</div>'+(p.allowedRoles ? '<p class="profile-role-label">'+esc(p.allowedRoles.map(roleName).join(' \u00b7 '))+'</p>' : '')+'<p>'+esc([p.model,p.reasoningEffort].filter(Boolean).join(' · '))+'</p>'+profileDiagnostics(p)+(p.appliedDiffers ? '<small>'+t("저장됨 · 적용 설정과 다름","Saved · differs from applied settings")+'</small>' : '')+(rootProfile(p) ? '<div class="profile-actions"><span class="profile-drag-handle" role="button" tabindex="0" draggable="true" data-action="equip" data-value="'+esc(p.id)+'" aria-label="'+esc(t("장착: ","Equip: ")+p.name)+'" title="'+t("끌어 놓거나 클릭해 장착","Drag or click to equip")+'">'+icon('arrow')+'<span>'+t("장착","Equip")+'</span></span></div>' : '')+'</article>').join('') : '<p class="empty compact">'+t("저장한 프로필이 없습니다. 패키지에서 가져오거나 직접 만들어 보세요.","No saved profiles. Create one or use a package profile.")+'</p>');
    $('profiles').querySelectorAll('[data-action="equip"]').forEach(el => el.disabled = !project || pending.has('equip'));
    if (!projectReady()) renderPendingProject();
    updateProjectControls();
    renderCards();
    const sourceErrors = (state.sources || []).filter(source => source.message);
    $('source-error').textContent = sourceErrors.map(source => [source.label,source.message].filter(Boolean).join(': ')).join(' · ');
    $('source-error').hidden = !sourceErrors.length;
    const g = state.github || {};
    html($('github-status'), (g.phase === 'loading' ? '<span class="spinner"></span> ' + t('GitHub 조회 중','Checking GitHub') : g.phase === 'error' ? esc(g.message || t('GitHub 확인 실패','GitHub check failed')) + ' ' + button(t('재시도','Retry'),'refresh') : g.checkedAt ? t('GitHub 확인: ','GitHub checked: ')+esc(new Date(g.checkedAt).toLocaleString()) : t('GitHub 업데이트 확인 전','GitHub updates not checked')));
    $('refresh').disabled = g.phase === 'loading';
    $('legacy-count').textContent = String((state.legacy || []).length);
    html($('legacy-list'), (state.legacy || []).map(p => '<li><span>'+esc(p.name)+'</span><span class="muted">'+esc(p.kind)+'</span></li>').join('') || '<li class="muted">'+t('등록된 기존 항목이 없습니다.','No legacy entries.')+'</li>');
  }
  const componentLabel = kind => ({instruction:t('기본 지침','Instructions'),skill:t('스킬','Skills'),mcp:'MCP',playbook:t('플레이북','Playbooks'),context:t('컨텍스트','Context'),'agent-role':t('에이전트 역할','Agent roles'),'task-profile':t('프로필','Profiles')})[kind] || kind;
  function renderCards() {
    if (!state) return;
    const search = $('search').value.trim().toLocaleLowerCase();
    const source = $('source').value, kind = $('kind').value, downloaded = $('downloaded').value;
    const packages = (state.packages || []).filter(p => (!search || [p.title,p.description,p.source?.label,...(p.componentNames || p.componentMetadata?.map(c => c.name) || [])].join(' ').toLocaleLowerCase().includes(search)) && (!source || p.source?.kind === source) && (!kind || (p.componentKinds || []).includes(kind)) && (!downloaded || Boolean(p.downloaded) === (downloaded === 'yes')));
    const kinds = [...new Set((state.packages || []).flatMap(p => p.componentKinds || []))].sort();
    const opts = '<option value="">'+t('모든 구성 종류','All component types')+'</option>'+kinds.map(k => '<option value="'+esc(k)+'">'+esc(componentLabel(k))+'</option>').join('');
    if ($('kind').innerHTML !== opts) { $('kind').innerHTML = opts; $('kind').value = kind; }
    $('count').textContent = packages.length;
    html($('cards'), packages.map(p => '<button class="package-card" type="button" data-action="detail" data-value="'+esc(p.key)+'"><span class="package-image">'+image(p)+'</span><span class="package-content"><strong>'+esc(p.title)+'</strong><span class="description">'+esc(p.description || t('설명 없음','No description'))+'</span>'+((p.componentCount ?? p.componentMetadata?.length) !== undefined ? '<span class="package-composition">'+t('구성요소 ','Components ')+(p.componentCount ?? p.componentMetadata.length)+' · '+t('프로필 ','Profiles ')+(p.profileCount || 0)+'</span>' : '')+'<span class="badges">'+badge(p.source?.kind === 'github' ? 'GitHub' : t('로컬','Local'),p.source?.kind === 'github' ? 'github' : 'local')+badge(p.downloaded ? t('사용 가능','Available') : t('미다운로드','Not downloaded'),p.downloaded ? 'check' : 'download')+(p.updateAvailable ? badge(t('새 버전','Update'),'refresh') : '')+(projectReady() && p.used ? badge(t('사용 중','In use'),'check') : '')+'</span></span></button>').join('') || '<div class="empty"><h3>'+t('표시할 패키지가 없습니다.','No matching packages.')+'</h3><p>'+t('검색 조건을 바꾸거나 새 패키지를 만드세요.','Change the filters or create a package.')+'</p></div>');
  }
  function openDialog(title, content, cls = '') {
    const d = $('dialog');
    d.className = cls;
    $('dialog-title').textContent = title;
    $('dialog-body').innerHTML = '<p id="dialog-error" class="error" role="alert" hidden></p>'+content;
    if (!d.open) d.showModal();
  }
  async function loadRoles() {
    if (roleLoading || disposed) return;
    roleLoading = true;
    try { roleState = await api('/api/role-profiles'); if (!disposed) renderRoles(); }
    catch (err) { error(err, $('role-error')); }
    finally { roleLoading = false; }
  }
  const roleName = role => ({lead:'Lead',root:'Root',subagent:'Subagent'})[role];
  const builtinRole = profile => protectedProfile(profile) || ['azrael-lead','azrael-root','sol_executor','luna_explorer'].includes(profile.id);
  function renderRoles() {
    if (!roleState) return;
    $('role-error').hidden = true;
    html($('team-presets'), roleState.teamPresets.map(p => '<article class="profile team-preset interactive-card" data-action="team-edit" data-value="'+esc(p.id)+'" role="button" tabindex="0" aria-label="'+esc(p.name)+'"><div class="team-card-image">'+(p.image ? image(p) : icon('profile'))+'</div>'+cardMenu(p.name,button(t("삭제","Delete"),'team-delete',p.id,'danger'))+'<div class="team-card-content"><strong>'+esc(p.name)+'</strong><p>'+t("Lead 1 · Root ","Lead 1 · Root ")+p.rootProfileIds.length+' · Subagent '+p.subagentProfileIds.length+'</p></div></article>').join('') || '<p class="muted">'+t("저장한 Team 구성이 없습니다.","No saved Team configurations.")+'</p>');
    $('direct-summary').textContent = [roleState.direct.rootProfileId,...roleState.direct.subagentProfileIds].map(id => roleState.profiles.find(p => p.id === id)?.name || id).join(' · ');
    html($('team-instances'), (roleState.teams || []).map(team => '<article class="team-instance"><h3>'+esc(team.name)+'</h3><p class="muted">'+esc(team.leadThreadId)+'</p><div class="profiles">'+team.profiles.map(p => '<article class="profile"><strong>'+esc(p.name)+'</strong><p>'+esc(p.allowedRoles.map(roleName).join(' · '))+'</p><p>'+esc([p.provider,p.model,p.reasoningEffort].filter(Boolean).join(' · '))+'</p>'+button(t('편집','Edit'),'team-profile-edit',JSON.stringify([team.id,p.id]))+'</article>').join('')+'</div></article>').join('') || '<p class="muted">'+t('실행 중인 팀이 없습니다.','No running teams.')+'</p>');
  }
  async function roleAction(action, payload, form = null) {
    if (pending.has('role-write')) return;
    pending.add('role-write');
    if (form) form.querySelectorAll('button').forEach(el => el.disabled = true);
    try {
      const next = await api('/api/role-profiles', {action,payload});
      if (disposed) return;
      roleState = {...next,models:next.models || roleState.models}; renderRoles();
      await refresh();
      if (form && form === $('dialog-body').querySelector('form')) $('dialog').close();
      $('notice').textContent = t('저장했습니다. 새 세션부터 적용됩니다.','Saved. Applies to new sessions.');
    } catch (err) { error(err,form?.isConnected ? $('dialog-error') : $('role-error')); }
    finally { pending.delete('role-write'); if (form?.isConnected) form.querySelectorAll('button').forEach(el => el.disabled = false); }
  }
  function roleForm(profile = null, copy = false, teamId = null) {
    if (!roleState) return;
    const readonly = profile && !copy && !teamId && builtinRole(profile), p = profile || {};
    const models = roleState.models || [];
    const modelId = row => row.model || row.id, providerId = row => row.modelProvider || row.provider || 'openai';
    openDialog(t(copy ? '역할 프로필 복제' : '역할 프로필',copy ? 'Duplicate role profile' : 'Role profile'), '<form id="role-form">'+imageField(readonly)+'<label>'+t('이름','Name')+'<input name="name" required maxlength="160" value="'+esc((copy ? p.name+' '+t('복사본','copy') : p.name) || '')+'"></label><fieldset><legend>'+t('사용 가능한 역할','Allowed roles')+'</legend><div class="role-choices">'+['lead','root','subagent'].map(role => '<label class="check-row"><input type="checkbox" name="roles" value="'+role+'"'+(p.allowedRoles?.includes(role) ? ' checked' : '')+'>'+roleName(role)+'</label>').join('')+'</div></fieldset><label>'+t('모델','Model')+'<select name="model" required><option value="">'+t('모델 선택','Select model')+'</option>'+models.map((m,i) => '<option value="'+i+'">'+esc((m.displayName || modelId(m))+' · '+providerId(m)+' / '+modelId(m))+'</option>').join('')+'</select></label><label>Reasoning effort<select name="effort"></select></label><label>'+t('지침','Instructions')+'<textarea name="instructions" rows="10">'+esc(p.instructions || '')+'</textarea></label>'+(readonly ? '' : '<div class="composer-footer"><button class="primary" type="submit">'+t('저장','Save')+'</button></div>')+'</form>');
    const form = $('role-form'), model = form.elements.model, effort = form.elements.effort;
    attachImage(form,p.image || '',readonly);
    const selected = models.findIndex(m => modelId(m) === p.model && providerId(m) === (p.provider || 'openai'));
    model.value = selected < 0 ? '' : String(selected);
    if (p.model && selected < 0) model.insertAdjacentHTML('beforeend','<option value="" selected>'+esc(p.model)+' · '+t('사용 불가','Unavailable')+'</option>');
    function efforts(preferred = '') {
      const row = model.value === '' ? null : models[Number(model.value)];
      const values = (row?.supportedReasoningEfforts || []).map(e => typeof e === 'string' ? e : e.reasoningEffort).filter(Boolean);
      effort.innerHTML = '<option value="">'+t('선택 안 함','Not specified')+'</option>'+values.map(e => '<option>'+esc(e)+'</option>').join('');
      if (readonly && preferred && !values.includes(preferred)) effort.insertAdjacentHTML('beforeend','<option value="'+esc(preferred)+'">'+esc(preferred)+' · '+t('사용 불가','Unavailable')+'</option>');
      effort.value = readonly && preferred || (values.includes(preferred) ? preferred : values.includes(row?.defaultReasoningEffort) ? row.defaultReasoningEffort : '');
      effort.disabled = readonly || !values.length;
    }
    efforts(p.reasoningEffort); on(model,'change',() => efforts());
    if (readonly) Array.from(form.elements).forEach(el => el.disabled = true);
    if (teamId) form.querySelectorAll('[name="roles"]').forEach(el => el.disabled = true);
    on(form,'submit',event => {
      event.preventDefault(); if (readonly) return;
      const allowedRoles = [...form.querySelectorAll('[name="roles"]:checked')].map(el => el.value), row = models[Number(model.value)];
      if (!allowedRoles.length || model.value === '' || !row) { error(new Error(t('역할과 사용 가능한 모델을 선택하세요.','Select roles and an available model.')),$('dialog-error')); return; }
      roleAction(teamId ? 'saveTeamProfile' : 'saveProfile',{...(teamId ? {teamId} : {}),profile:{id:!copy && p.id ? p.id : 'profile-'+crypto.randomUUID(),name:form.elements.name.value,allowedRoles:teamId ? [...p.allowedRoles] : allowedRoles,model:modelId(row),provider:providerId(row),...(effort.value ? {reasoningEffort:effort.value} : {}),instructions:form.elements.instructions.value,image:formImages.get(form) || ''}},form);
    });
  }
  function configurationForm(preset = null, direct = false) {
    if (!roleState) return;
    const p = preset || {}, profiles = roleState.profiles;
    const choices = (role,multiple,selected) => '<label>'+roleName(role)+'<select name="'+role+'"'+(multiple ? ' multiple size="4"' : ' required')+'>'+(!multiple ? '<option value="">'+t('프로필 선택','Select profile')+'</option>' : '')+profiles.filter(item => item.allowedRoles.includes(role)).map(item => '<option value="'+esc(item.id)+'"'+(selected.includes(item.id) ? ' selected' : '')+'>'+esc(item.name)+'</option>').join('')+'</select></label>';
    const fields = direct ? choices('root',false,[roleState.direct.rootProfileId])+choices('subagent',true,roleState.direct.subagentProfileIds) : imageField()+'<label>'+t('\uc774\ub984','Name')+'<input name="name" required maxlength="160" value="'+esc(p.name || '')+'"></label>'+choices('lead',false,[p.leadProfileId])+choices('root',true,p.rootProfileIds || [])+choices('subagent',true,p.subagentProfileIds || []);
    openDialog(direct ? t('Direct 공통 설정','Direct defaults') : t('Team \uad6c\uc131','Team configuration'),'<form id="role-configuration">'+fields+'<div class="composer-footer"><button type="submit" class="primary">'+t('\uc800\uc7a5','Save')+'</button></div></form>');
    const form = $('role-configuration'), selected = name => [...form.elements[name].selectedOptions].map(el => el.value);
    if (!direct) attachImage(form,p.image || '');
    on(form,'submit',event => { event.preventDefault(); if (direct) roleAction('saveDirect',{direct:{rootProfileId:form.elements.root.value,subagentProfileIds:selected('subagent')}},form); else roleAction('saveTeamPreset',{preset:{id:p.id || 'team-'+crypto.randomUUID(),name:form.elements.name.value,image:formImages.get(form) || '',leadProfileId:form.elements.lead.value,rootProfileIds:selected('root'),subagentProfileIds:selected('subagent')}},form); });
  }
  async function openDetail(key) {
    const serial = ++detailSerial;
    openDialog(t('패키지 상세','Package details'), '<p class="muted">'+t('구성 파일을 읽는 중…','Reading component files…')+'</p>', 'wide');
    try {
      const d = await api('/api/package?key='+encodeURIComponent(key));
      if (serial !== detailSerial || !$('dialog').open) return;
      detail = {...d,key:d.key || key};
      const p = detail;
      const components = p.components || [], profiles = p.profiles || [];
      const counts = [...new Set(components.map(c => c.kind))].map(kind => esc(componentLabel(kind))+' '+components.filter(c => c.kind === kind).length).join(' · ');
      const metadata = '<dl class="package-metadata"><div><dt>'+t('출처','Source')+'</dt><dd>'+esc(p.source?.label || p.source?.kind || '')+'</dd></div><div><dt>'+t('버전','Version')+'</dt><dd>'+esc(p.version || '—')+'</dd></div><div><dt>'+t('포함 항목','Contents')+'</dt><dd>'+t('구성요소 ','Components ')+components.length+' · '+t('프로필 ','Profiles ')+profiles.length+'</dd></div></dl>';
      const tree = components.map((c,i) => '<details class="package-component"><summary><strong>'+esc(c.name)+'</strong><small>'+esc(componentLabel(c.kind))+' · '+t('파일 ','Files ')+c.files.length+'</small></summary><label class="check-row"><input type="checkbox" name="copy-component" value="'+esc(c.id)+'" checked>'+t('새 패키지에 포함','Include in new package')+'</label>'+c.files.map((f,j) => button(f.path,'file',i+':'+j,'file-button')).join('')+'</details>').join('');
      const included = profiles.map((profile,i) => '<article class="included-profile"><strong>'+esc(profile.name)+'</strong><p class="muted">'+esc([profile.provider,profile.model,profile.reasoningEffort].filter(Boolean).join(' · '))+'</p><p>'+t('사용 구성요소: ','Uses: ')+esc((profile.componentIds || []).map(id => components.find(c => c.id === id)?.name || id).join(', ') || t('없음','None'))+'</p>'+(profile.instructions ? '<pre>'+esc(profile.instructions)+'</pre>' : '')+button(t('가져와 장착','Import and equip'),'use-profile',i)+'</article>').join('');
      openDialog(p.title, '<div class="detail-heading"><div class="package-image">'+image(p)+'</div><div><p>'+esc(p.description || t('설명 없음','No description'))+'</p>'+metadata+'</div></div><div class="actions">'+(!p.downloaded ? button(t('다운로드','Download'),'download',key,'primary') : badge(t('로컬 사용 가능','Available locally'),'check'))+button(t('이 패키지로 프로필 만들기','Create profile from package'),'profile-package',key)+button(t('선택 요소로 새 패키지','New package from selection'),'derive-start',key)+'</div><h3>'+t('구성요소','Components')+' <span class="count">'+components.length+'</span></h3><p class="muted">'+counts+'</p>'+(p.previewAvailable === false ? '<p class="muted">'+t('다운로드하면 파일 원문을 확인할 수 있습니다.','Download to preview full file contents.')+'</p>' : '')+'<div class="file-layout"><div class="component-tree">'+(tree || '<p class="muted">'+t('포함된 구성요소가 없습니다.','No included components.')+'</p>')+'</div><pre id="file-preview" tabindex="0" aria-label="'+t('파일 내용','File content')+'">'+t('구성요소를 펼치고 파일을 선택하면 내용을 확인할 수 있습니다.','Expand a component and select a file to preview its content.')+'</pre></div><h3>'+t('제공 프로필','Included profiles')+' <span class="count">'+profiles.length+'</span></h3>'+(included || '<p class="muted">'+t('제공 프로필이 없습니다.','No included profiles.')+'</p>')+(p.digest ? '<details class="package-integrity"><summary>'+t('패키지 식별 정보','Package identity')+'</summary><code>'+esc(p.id)+'</code><pre>'+esc(p.digest)+'</pre></details>' : ''), 'wide');
    } catch (err) { if (serial === detailSerial && $('dialog').open) { const summary = (state.packages || []).find(p => p.key === key); if (summary && !summary.downloaded) { detail = {...summary,components:[],profiles:[]}; openDialog(summary.title,'<p>'+esc(summary.description)+'</p><p class="muted">'+t('다운로드 후 검증된 구성 파일을 확인할 수 있습니다.','Download to inspect verified component files.')+'</p><div class="actions">'+button(t('다운로드','Download'),'download',key,'primary')+'</div>'); } error(err,$('dialog-error')); } }
  }
  function attachProfileOptions(host, template = {}, {allowInvalid = false} = {}) {
    host.innerHTML = '<label class="check-row"><input type="checkbox" data-provider-enabled>'+t('Provider 지정','Specify provider')+'</label><div data-provider-fields hidden><p class="muted" role="status" data-options-status>'+t('모델 설정을 불러오는 중…','Loading model options…')+'</p><label>Provider<select data-provider disabled><option value="">'+t('Provider 선택','Select provider')+'</option></select></label><label>Model<select data-model disabled><option value="">'+t('모델 선택','Select model')+'</option></select></label><label>Reasoning effort<select data-effort disabled><option value="">'+t('선택 안 함','Not specified')+'</option></select></label></div>';
    const toggle = host.querySelector('[data-provider-enabled]'), fields = host.querySelector('[data-provider-fields]'), provider = host.querySelector('[data-provider]'), model = host.querySelector('[data-model]'), effort = host.querySelector('[data-effort]'), status = host.querySelector('[data-options-status]');
    let options = null;
    const alive = () => !disposed && host.isConnected && $('dialog').open;
    const selectedModel = () => options?.models.find(item => item.id === model.value);
    const option = (value,label) => '<option value="'+esc(value)+'">'+esc(label)+'</option>';
    function renderEfforts(preferred = '', initial = false) {
      const selected = selectedModel(), values = selected?.supportedReasoningEfforts || [];
      effort.innerHTML = option('',t('선택 안 함','Not specified'))+values.map(item => option(item.reasoningEffort,item.reasoningEffort+(item.description ? ' · '+item.description : ''))).join('');
      const valid = value => values.some(item => item.reasoningEffort === value);
      if (allowInvalid && preferred && !valid(preferred)) effort.insertAdjacentHTML('beforeend',option(preferred,preferred));
      effort.value = allowInvalid && preferred ? preferred : valid(preferred) ? preferred : initial && valid(selected?.defaultReasoningEffort) ? selected.defaultReasoningEffort : '';
      effort.disabled = !toggle.checked || !selected || !values.length;
    }
    function renderModels(initial = false) {
      const previous = model.value, previousEffort = effort.value;
      const available = options.models.filter(item => !toggle.checked || item.providerIds.includes(provider.value));
      model.innerHTML = option('',t('모델 선택','Select model'))+available.map(item => {
        const label = item.displayName || item.model;
        const duplicate = available.filter(other => (other.displayName || other.model) === label).length > 1;
        return option(item.id,label+(duplicate ? ' · '+item.model+' · '+item.providerIds.join(', ')+' · '+item.id : ''));
      }).join('');
      let chosen = available.find(item => item.id === previous);
      if (initial && template.model) {
        const matches = available.filter(item => item.model === template.model);
        if (matches.length === 1) chosen = matches[0];
      }
      if (allowInvalid && initial && template.model && !chosen) { model.insertAdjacentHTML('beforeend',option(template.model,template.model)); model.value = template.model; }
      else model.value = chosen?.id || '';
      model.disabled = !toggle.checked;
      renderEfforts(initial ? template.reasoningEffort : previousEffort,initial);
    }
    function syncFields() {
      fields.hidden = !toggle.checked;
      provider.disabled = !toggle.checked || !options;
      provider.required = toggle.checked && !allowInvalid;
      model.required = toggle.checked && !allowInvalid;
      model.disabled = !toggle.checked || !options;
      if (options) renderModels();
      else effort.disabled = true;
    }
    on(toggle, 'change', syncFields);
    on(provider, 'change', () => renderModels());
    on(model, 'change', () => renderEfforts(effort.value));
    const controller = {read() {
      if (!toggle.checked) return {};
      const selected = selectedModel();
      if (allowInvalid) return {provider:provider.value || (options ? '' : template.provider || ''),model:selected?.model || model.value || (options ? '' : template.model || ''),reasoningEffort:effort.value || (options ? '' : template.reasoningEffort || '')};
      if (!options || !selected) throw new Error(t('사용 가능한 모델을 선택하세요.','Select an available model.'));
      if (toggle.checked && (!provider.value || !selected.providerIds.includes(provider.value))) throw new Error(t('Provider와 모델 선택을 확인하세요.','Check the provider and model selection.'));
      return {model:selected.model,...(toggle.checked ? {provider:provider.value} : {}),...(effort.value ? {reasoningEffort:effort.value} : {})};
    }};
    async function load() {
      status.className = 'muted'; status.textContent = t('모델 설정을 불러오는 중…','Loading model options…');
      try {
        const result = await api('/api/profile-options');
        if (!alive()) return;
        if (!Array.isArray(result.providers) || !Array.isArray(result.models)) throw new Error(t('모델 목록 응답이 올바르지 않습니다.','Invalid model options response.'));
        options = result;
        provider.innerHTML = option('',t('Provider 선택','Select provider'))+options.providers.map(item => option(item.id,item.label+(options.providers.filter(other => other.label === item.label).length > 1 ? ' · '+item.id : ''))).join('');
        const account = template.providerAccount;
        const matches = account
          ? options.providers.filter(item => account.providerId && account.accountId && item.account?.providerId === account.providerId && item.account?.accountId === account.accountId)
          : options.providers.filter(item => template.provider && item.id === template.provider);
        if (allowInvalid && template.provider && !matches.length) provider.insertAdjacentHTML('beforeend',option(template.provider,template.provider));
        provider.value = matches.length === 1 ? matches[0].id : allowInvalid ? template.provider || '' : '';
        syncFields();
        renderModels(true);
        status.textContent = result.message || '';
        status.hidden = !status.textContent;
      } catch (err) {
        if (!alive()) return;
        status.className = 'error'; status.textContent = (err?.message || String(err))+' ';
        const retry = ownerDocument.createElement('button'); retry.type = 'button'; retry.textContent = t('다시 불러오기','Retry'); on(retry, 'click', load); status.append(retry);
      }
    }
    toggle.checked = Boolean(template.providerAccount || template.provider || template.model);
    syncFields();
    load();
    return controller;
  }
  function profileDiagnostics(profile, predicate = () => true) {
    return (profile.diagnostics || []).filter(predicate).map(d => '<p class="profile-diagnostic" role="status">'+esc(d.message)+'</p>').join('');
  }
  function profileForm(pkg = null, profile = null) {
    detailSerial++;
    const p = profile || {}, readOnly = Boolean(protectedProfile(p) && !pkg);
    openDialog(t(readOnly ? '프로필 보기' : p.id && !pkg ? '프로필 편집' : '프로필 만들기',readOnly ? 'View profile' : p.id && !pkg ? 'Edit profile' : 'Create profile'), '<form id="profile-form" novalidate><div class="composer-layout"><section class="composer-slots" aria-label="'+t('프로필 구성','Profile composition')+'"><label>'+t('이름','Name')+'<input name="name" required maxlength="160" value="'+esc(p.name)+'"'+(readOnly ? ' readonly' : '')+'></label>'+imageField(readOnly)+'<div id="composer-core" class="composer-slot"></div><div id="composer-selections"></div><section class="composer-slot"><h3>'+t('직접 작성한 지침','Authored instructions')+'</h3><label class="sr-only" for="profile-instructions">'+t('추가 지침','Additional instructions')+'</label><textarea id="profile-instructions" name="instructions" rows="5"'+(readOnly ? ' readonly' : '')+'>'+esc(p.instructions)+'</textarea></section><section class="composer-model-settings"><h3>'+t('모델 설정','Model settings')+'</h3><fieldset id="profile-options" class="profile-settings"'+(readOnly ? ' disabled' : '')+'></fieldset><div id="composer-model-diagnostics"></div></section><div id="composer-diagnostics"></div></section><section class="composer-library" aria-label="'+t('리소스 라이브러리','Resource library')+'"><h3>'+t('리소스','Resources')+'</h3><label class="search-field">'+icon('search')+'<input id="resource-search" type="search" aria-label="'+t('리소스 검색','Search resources')+'" placeholder="'+t('리소스 검색','Search resources')+'"></label><div id="resource-tabs" class="resource-tabs" role="group" aria-label="'+t('리소스 종류','Resource categories')+'"></div><label>'+t('출처','Source')+'<select id="resource-source"><option value="">'+t('모든 출처','All sources')+'</option></select></label><div id="resource-status" class="muted" role="status">'+t('리소스를 불러오는 중…','Loading resources…')+'</div><div id="resource-list" class="resource-list"></div></section></div><div class="composer-footer">'+(readOnly ? button(t('복제','Duplicate'),'duplicate-profile',p.id) : '<button class="primary" type="submit" data-busy-action="saveProfile">'+t('저장','Save')+'</button>')+'</div></form>', 'composer-dialog');
    const form = $('profile-form'), alive = () => !disposed && form.isConnected && $('profile-form') === form && $('dialog').open;
    attachImage(form,p.image || '',readOnly);
    const roleChoices = ownerDocument.createElement('fieldset');
    roleChoices.className = 'profile-role-choices';
    roleChoices.disabled = readOnly;
    roleChoices.innerHTML = '<legend>'+t('사용 가능한 역할','Allowed roles')+'</legend><div class="role-choices">'+['lead','root','subagent'].map(role => '<label class="check-row"><input type="checkbox" name="allowedRoles" value="'+role+'"'+((p.allowedRoles || ['lead','root','subagent']).includes(role) ? ' checked' : '')+'>'+roleName(role)+'</label>').join('')+'</div>';
    form.querySelector('.image-field').after(roleChoices);
    const kinds = ['instruction','skill','mcp','playbook','context','agent-role'];
    const labels = {instruction:t('추가 지침','Additional instructions'),skill:t('스킬','Skills'),mcp:'MCP',playbook:t('플레이북','Playbooks'),context:t('컨텍스트','Context'),'agent-role':t('에이전트 역할','Agent roles')};
    const composer = {readOnly,profileId:!pkg ? p.id : undefined,expectedRevision:state.revision,expectedRepoRevision:state.repoRevision,ids:[...new Set(p.resourceIds || [])]};
    profileComposers.set(form,composer);
    profileProjects.set(form,project);
    profileSelectors.set(form,attachProfileOptions($('profile-options'),p,{allowInvalid:true}));
    let resources = [], category = '', core = null, dragging = null;
    const find = id => resources.find(r => r.id === id) || {id,name:id,kind:'instruction',available:false,error:t('리소스를 찾을 수 없습니다.','Resource not found.')};
    const sourceLabel = r => typeof r.source === 'string' ? r.source : r.source?.label || r.source?.kind || '';
    function renderLibrary() {
      const search = $('resource-search').value.toLocaleLowerCase(), source = $('resource-source').value;
      $('resource-tabs').innerHTML = [''].concat(kinds).map(kind => '<button type="button" data-composer="category" data-value="'+kind+'" aria-pressed="'+(category === kind)+'">'+(labels[kind] || t('전체','All'))+'</button>').join('');
      const visible = resources.filter(r => (!category || r.kind === category) && (!source || sourceLabel(r) === source) && (!search || [r.name,r.description,sourceLabel(r)].join(' ').toLocaleLowerCase().includes(search)));
      $('resource-list').innerHTML = visible.map(r => '<article class="resource-item" draggable="'+(!readOnly && r.available !== false)+'" data-resource="'+esc(r.id)+'"><div class="grow"><strong>'+esc(r.name)+'</strong><small>'+esc([labels[r.kind],sourceLabel(r)].filter(Boolean).join(' · '))+'</small>'+(r.description ? '<p class="resource-description" title="'+esc(r.description)+'">'+esc(r.description)+'</p>' : '')+(r.error ? '<p class="profile-diagnostic">'+esc(r.error)+'</p>' : '')+'</div><button type="button" data-composer="add" data-value="'+esc(r.id)+'" aria-label="'+esc(r.name+' · '+t('추가','Add'))+'"'+(readOnly || r.available === false || composer.ids.includes(r.id) ? ' disabled' : '')+'>'+ (composer.ids.includes(r.id) ? icon('check') : icon('plus'))+'</button></article>').join('') || '<p class="empty compact">'+t('리소스가 없습니다.','No resources found.')+'</p>';
    }
    function renderSlots() {
      const focus = scope.activeElement, focusedAction = focus?.dataset?.composer, focusedId = focus?.dataset?.value;
      html($('composer-core'), '<details><summary><strong>'+esc(core?.name || t('핵심 지침','Core instructions'))+'</strong><span class="badge">'+t('고정','Locked')+'</span></summary><pre>'+esc(core?.text || '')+'</pre></details>');
      $('composer-selections').innerHTML = kinds.map(kind => {
        const ids = composer.ids.filter(id => find(id).kind === kind);
        return '<section class="composer-slot" data-slot="'+kind+'"><h3>'+labels[kind]+' <span class="count">'+ids.length+'</span></h3><div class="slot-resources">'+ids.map((id,i) => { const r = find(id); return '<div class="selected-resource" data-selected="'+esc(id)+'" draggable="'+(!readOnly && kind === 'instruction')+'"><div class="grow"><strong>'+esc(r.name)+'</strong>'+(r.error ? '<p class="profile-diagnostic">'+esc(r.error)+'</p>' : '')+profileDiagnostics(p,d => d.resourceId === id)+'</div><div class="slot-actions">'+(kind === 'instruction' ? '<button type="button" data-composer="up" data-value="'+esc(id)+'" aria-label="'+esc(r.name+' · '+t('위로','Move up'))+'"'+(readOnly || !i ? ' disabled' : '')+'>↑</button><button type="button" data-composer="down" data-value="'+esc(id)+'" aria-label="'+esc(r.name+' · '+t('아래로','Move down'))+'"'+(readOnly || i === ids.length-1 ? ' disabled' : '')+'>↓</button>' : '')+'<button type="button" data-composer="remove" data-value="'+esc(id)+'" aria-label="'+esc(r.name+' · '+t('제거','Remove'))+'"'+(readOnly ? ' disabled' : '')+'>'+icon('close')+'</button></div></div>'; }).join('')+(ids.length ? '' : '<p class="slot-empty">'+t('선택한 리소스 없음','No resources selected')+'</p>')+'</div></section>';
      }).join('');
      $('composer-model-diagnostics').innerHTML = profileDiagnostics(p,d => !d.resourceId && ['provider','providerAccount','model','reasoningEffort'].includes(d.field));
      $('composer-diagnostics').innerHTML = profileDiagnostics(p,d => !d.resourceId && !['provider','providerAccount','model','reasoningEffort'].includes(d.field));
      renderLibrary();
      if (focusedAction && focusedId) {
        const controls = Array.from(form.querySelectorAll('[data-composer]'));
        const next = controls.find(el => el.dataset.composer === focusedAction && el.dataset.value === focusedId && !el.disabled) || controls.find(el => el.dataset.value === focusedId && !el.disabled) || controls.find(el => el.dataset.composer === (focusedAction === 'add' ? 'add' : 'remove') && !el.disabled) || $('resource-search');
        next.focus();
      }
    }
    function add(id) {
      const resource = resources.find(r => r.id === id);
      if (readOnly || !resource || resource.available === false || composer.ids.includes(id) || id === core?.id) return;
      composer.ids.push(id); renderSlots();
    }
    function move(id, target) {
      if (readOnly || id === target || find(id).kind !== 'instruction' || find(target).kind !== 'instruction') return;
      const from = composer.ids.indexOf(id), to = composer.ids.indexOf(target);
      if (from < 0 || to < 0) return;
      composer.ids.splice(from,1); composer.ids.splice(to,0,id); renderSlots();
    }
    listen(form,'click',event => {
      const el = event.target.closest('[data-composer]'); if (!el || el.disabled) return;
    if (event.target.closest('.card-menu') && !event.target.closest('.card-menu button')) return;
      const id = el.dataset.value;
      switch (el.dataset.composer) {
        case 'category': category = id; renderLibrary(); Array.from($('resource-tabs').querySelectorAll('button')).find(b => b.dataset.value === id)?.focus(); break;
        case 'add': add(id); break;
        case 'remove': if (!readOnly) { composer.ids = composer.ids.filter(value => value !== id); renderSlots(); } break;
        case 'up': case 'down': { const ids = composer.ids.filter(value => find(value).kind === 'instruction'), i = ids.indexOf(id); move(id,ids[i+(el.dataset.composer === 'up' ? -1 : 1)]); break; }
      }
    });
    listen($('resource-search'),'input',renderLibrary);
    listen($('resource-source'),'change',renderLibrary);
    listen(form,'dragstart',event => {
      const el = event.target.closest('[data-resource],[data-selected]');
      if (!el || readOnly || event.target.closest('button,input,textarea,select') || el.getAttribute('draggable') !== 'true') { event.preventDefault(); return; }
      dragging = {id:el.dataset.resource || el.dataset.selected,selected:Boolean(el.dataset.selected)};
      event.dataTransfer.setData('application/x-azrael-resource',dragging.id); event.dataTransfer.effectAllowed = dragging.selected ? 'move' : 'copy';
    });
    listen(form,'dragover',event => {
      const slot = event.target.closest('[data-slot]');
      if (!readOnly && dragging && slot && find(dragging.id).kind === slot.dataset.slot) { event.preventDefault(); event.dataTransfer.dropEffect = dragging.selected ? 'move' : 'copy'; slot.classList.add('dragover'); }
    });
    listen(form,'dragleave',event => { const slot = event.target.closest('[data-slot]'); if (slot && !slot.contains(event.relatedTarget)) slot.classList.remove('dragover'); });
    listen(form,'drop',event => {
      const slot = event.target.closest('[data-slot]');
      if (!slot || !dragging || readOnly) return;
      event.preventDefault(); slot.classList.remove('dragover');
      if (find(dragging.id).kind === slot.dataset.slot) {
        const target = event.target.closest('[data-selected]')?.dataset.selected;
        if (dragging.selected && target) move(dragging.id,target); else add(dragging.id);
      }
      dragging = null;
    });
    listen(form,'dragend',() => { dragging = null; form.querySelectorAll('.dragover').forEach(el => el.classList.remove('dragover')); });
    on(form,'submit',event => { event.preventDefault(); saveProfile(); });
    renderSlots(); updateProjectControls();
    (async () => {
      try {
        const result = await api('/api/resources');
        if (!alive()) return;
        core = result.core; resources = (result.resources || []).filter(r => kinds.includes(r.kind) && r.id !== core?.id);
        composer.ids = composer.ids.filter(id => id !== core?.id);
        if (p.isDefault) composer.ids = (result.defaultResourceIds || []).filter(id => resources.some(r => r.id === id));
        if (pkg && !p.resourceIds) {
          const selected = p.componentIds || (pkg.components || []).map(c => c.id);
          const matchesPackage = r => r.source?.packageKey === pkg.key || r.component?.packageKey === pkg.key || r.packageKey === pkg.key;
          resources.filter(r => matchesPackage(r) && selected.includes(typeof r.component === 'string' ? r.component : r.component?.id || r.componentId)).forEach(r => { if (!composer.ids.includes(r.id)) composer.ids.push(r.id); });
        }
        const sources = [...new Set(resources.map(sourceLabel).filter(Boolean))];
        $('resource-source').innerHTML = '<option value="">'+t('모든 출처','All sources')+'</option>'+sources.map(source => '<option value="'+esc(source)+'">'+esc(source)+'</option>').join('');
        $('resource-status').textContent = (result.errors || []).map(e => typeof e === 'string' ? e : e.message).join(' · ');
        $('resource-status').className = (result.errors || []).length ? 'error' : 'muted';
        renderSlots();
      } catch (err) { if (alive()) { $('resource-status').textContent = err.message || String(err); $('resource-status').className = 'error'; } }
    })();
  }
  async function saveProfile() {
    const form = $('profile-form'), composer = profileComposers.get(form);
    if (!form || !composer || composer.readOnly) return;
    if (profileProjects.get(form) !== project) { error(new Error(t('프로젝트가 변경되었습니다. 현재 프로젝트에서 프로필을 다시 여세요.','The project changed. Reopen the profile for the current project.')),$('dialog-error')); return; }
    if (!projectReady()) { error(new Error(t('현재 프로젝트를 확인한 뒤 다시 저장하세요.','Wait for the current project to load before saving.')),$('dialog-error')); return; }
    const name = form.elements.name;
    if (!name.value.trim()) { name.setCustomValidity(t('이름을 입력하세요.','Enter a name.')); name.reportValidity(); name.setCustomValidity(''); return; }
    const settings = profileSelectors.get(form).read();
    const allowedRoles = [...form.querySelectorAll('[name="allowedRoles"]:checked')].map(el => el.value);
    if (!allowedRoles.length) { error(new Error(t('사용 가능한 역할을 하나 이상 선택하세요.','Select at least one allowed role.')),$('dialog-error')); return; }
    await act('saveProfile',{projectId:project || null,...(composer.profileId ? {profileId:composer.profileId} : {}),name:name.value.trim(),image:formImages.get(form) || '',allowedRoles,instructions:form.elements.instructions.value,resourceIds:composer.ids.slice(),...settings,...(composer.expectedRevision === undefined ? {} : {expectedRevision:composer.expectedRevision}),...(composer.expectedRepoRevision === undefined ? {} : {expectedRepoRevision:composer.expectedRepoRevision})},{close:true});
  }
  function startPackage(selection = null) {
    draft = {components:[],selections:[],image:undefined};
    if (selection) draft.selections.push(selection);
    openDialog(t('새 패키지 만들기','Create a package'), '<form id="package-form"><label>'+t('제목','Title')+'<input name="title" required maxlength="160"></label><label>'+t('설명','Description')+'<textarea name="description" rows="2" required></textarea></label><label>'+t('이미지 (선택)','Image (optional)')+'<input id="image-input" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="image-preview"></div><hr><h3>'+t('구성요소','Components')+'</h3><div id="staged"></div><div class="import-row"><label>'+t('기존 패키지에서 복사','Copy from a package')+'<select id="copy-package"><option value="">'+t('패키지 선택','Select package')+'</option>'+(state.packages || []).map(p => '<option value="'+esc(p.key)+'">'+esc(p.title)+'</option>').join('')+'</select></label>'+button(t('요소 선택','Choose components'),'choose-copy')+'</div><div id="copy-choices"></div><div class="component-editor"><div class="form-grid"><label>'+t('요소 이름','Component name')+'<input id="component-name"></label><label>'+t('종류','Type')+'<select id="component-kind"><option value="instruction">instruction</option><option value="context">context</option><option value="skill">skill</option><option value="playbook">playbook</option><option value="agent-role">agent-role</option></select></label></div><label>'+t('기본 파일 경로','Main file path')+'<input id="component-path" value="instructions.md"></label><label>'+t('본문','Main text')+'<textarea id="component-text" rows="5"></textarea></label><label class="file-import">'+t('지원 파일을 포함한 전체 폴더 가져오기','Import complete folder with support files')+'<input id="folder-input" type="file" webkitdirectory multiple></label><div id="import-summary" class="muted"></div>'+button(t('구성요소 추가','Add component'),'add-component')+'</div><p class="muted">'+t('여러 원본에서 복사한 요소는 독립된 새 패키지로 저장됩니다. 실행 중 패키지를 합치지 않습니다.','Copied components are stored in one independent new package.')+'</p><div class="actions"><button type="submit" class="primary" data-busy-action="createPackage" data-secondary-action="derivePackage">'+t('패키지 저장','Save package')+'</button></div></form>', 'wide');
    const packageForm = $('package-form');
    packageForm.elements.title.maxLength = 200;
    const profileSection = ownerDocument.createElement('fieldset');
    profileSection.innerHTML = '<legend>'+t('제공 프로필 (선택)','Included profile (optional)')+'</legend><label class="check-row"><input id="include-package-profile" type="checkbox">'+t('모델 설정과 지침을 프로필로 포함','Include a profile with model settings and instructions')+'</label><div id="package-profile-fields" hidden><div class="form-grid"><label>'+t('프로필 이름','Profile name')+'<input name="packageProfileName" required maxlength="160" disabled></label></div><fieldset id="package-profile-options" disabled></fieldset><label>'+t('프로필 지침','Profile instructions')+'<textarea name="packageProfileInstructions" rows="4" disabled></textarea></label><p class="muted">'+t('새 패키지의 모든 구성요소를 사용합니다. 구성요소 없이 모델 프로필만 저장할 수도 있습니다.','Uses all components in the new package. You can also save a model profile without components.')+'</p></div>';
    packageForm.querySelector('.actions').before(profileSection);
    $('package-profile-fields').className = 'component-editor';
    const packageOptionsHost = $('package-profile-options');
    profileSelectors.set(packageForm,attachProfileOptions(packageOptionsHost));
    on($('include-package-profile'), 'change', () => {
      const enabled = $('include-package-profile').checked;
      $('package-profile-fields').hidden = !enabled;
      packageOptionsHost.disabled = !enabled;
      $('package-profile-fields').querySelectorAll('[name="packageProfileName"],[name="packageProfileInstructions"]').forEach(el => { el.disabled = !enabled; });
    });
    draft.importFiles = [];
    renderStaged();
    on($('image-input'), 'change', async () => {
      const f = $('image-input').files[0]; if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 2 * 1024 * 1024) { error(new Error(t('2 MiB 이하의 PNG, JPEG, WebP를 선택하세요.','Choose PNG, JPEG or WebP up to 2 MiB.')),$('dialog-error')); return; }
      const value = await dataURL(f); if (!draft || !$('image-preview')) return; draft.image = value; $('image-preview').innerHTML = '<img class="upload-preview" alt="'+t('선택한 이미지','Selected image')+'" src="'+esc(value)+'">';
    });
    on($('folder-input'), 'change', async () => {
      const files = [...$('folder-input').files];
      const oversized = files.find(file => file.size > 16 * 1024 * 1024);
      if (files.length > 10000 || files.reduce((sum,f) => sum+f.size,0) > 128 * 1024 * 1024 || oversized) { error(new Error(oversized ? t('파일당 16 MiB 제한을 초과했습니다: ','File exceeds the 16 MiB limit: ')+(oversized.webkitRelativePath || oversized.name) : t('폴더는 10,000개 파일, 총 128 MiB 이하여야 합니다. 전체 폴더를 가져오지 않았습니다.','Folder limit: 10,000 files and 128 MiB total. The folder was not imported.')),$('dialog-error')); return; }
      try {
        const imported = await Promise.all(files.map(async f => {
          const bytes = new Uint8Array(await f.arrayBuffer());
          let content, encoding;
          try { content = new TextDecoder('utf-8',{fatal:true}).decode(bytes); encoding = 'utf8'; } catch { content = (await dataURL(f)).split(',')[1]; encoding = 'base64'; }
          const relative = f.webkitRelativePath || f.name;
          return {path:relative.includes('/') ? relative.slice(relative.indexOf('/')+1) : relative,encoding,content};
        }));
        if (!draft || !$('import-summary')) return;
        draft.importFiles = imported;
        $('import-summary').textContent = imported.map(f => f.path).join(' · ');
        const main = imported.find(f => /(^|\/)SKILL\.md$/i.test(f.path)) || imported.find(f => /\.md$/i.test(f.path));
        if (main) { $('component-path').value = main.path; $('component-text').value = main.content; }
        if (!$('component-name').value && files[0]) $('component-name').value = (files[0].webkitRelativePath || files[0].name).split('/')[0];
      } catch (err) { error(err,$('dialog-error')); }
    });
    on($('component-kind'), 'change', () => { $('component-path').value = {skill:'SKILL.md','agent-role':'role.toml',playbook:'PLAYBOOK.md',context:'instructions.md'}[$('component-kind').value]; });
    on($('package-form'), 'submit', event => { event.preventDefault(); savePackage(); });
  }
  function dataURL(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
  function renderStaged() {
    $('staged').innerHTML = draft.components.map((c,i) => '<div class="staged-row"><span><strong>'+esc(c.name)+'</strong> · '+esc(c.kind)+' · '+c.files.length+' '+t('파일','files')+'</span>'+button(t('제거','Remove'),'remove-component',i)+'</div>').join('')+draft.selections.map((s,i) => '<div class="staged-row"><span>'+esc(s.title || s.key)+' · '+s.componentIds.length+' '+t('복사 요소','copied components')+'</span>'+button(t('제거','Remove'),'remove-selection',i)+'</div>').join('');
  }
  function addComponent() {
    const name = $('component-name').value.trim(), path = $('component-path').value.trim();
    if (!name || !path) { error(new Error(t('요소 이름과 기본 파일 경로를 입력하세요.','Enter a component name and main file path.')),$('dialog-error')); return; }
    const files = draft.importFiles.filter(f => f.path !== path);
    files.unshift({path,encoding:'utf8',content:$('component-text').value});
    draft.components.push({name,kind:$('component-kind').value,files});
    draft.importFiles = []; $('component-name').value = ''; $('component-text').value = ''; $('folder-input').value = ''; $('import-summary').textContent = '';
    renderStaged();
  }
  async function chooseCopy() {
    const key = $('copy-package').value; if (!key) return;
    try {
      const p = await api('/api/package?key='+encodeURIComponent(key));
      if (disposed || !$('copy-choices')) return;
      $('copy-choices').innerHTML = '<fieldset><legend>'+esc(p.title)+'</legend>'+(p.components || []).map(c => '<label class="check-row"><input name="stage-copy" type="checkbox" value="'+esc(c.id)+'" checked>'+esc(c.name)+' · '+esc(c.kind)+'</label>').join('')+button(t('선택 요소 가져오기','Copy selected components'),'stage-copy')+'</fieldset>';
      $('copy-choices').dataset.key = key; $('copy-choices').dataset.title = p.title;
    } catch (err) { error(err,$('dialog-error')); }
  }
  async function savePackage() {
    const form = $('package-form'); if (!form.reportValidity()) return;
    const includeProfile = $('include-package-profile').checked;
    if (!draft.components.length && !draft.selections.length && !includeProfile) { error(new Error(t('구성요소나 제공 프로필을 하나 이상 추가하세요.','Add at least one component or included profile.')),$('dialog-error')); return; }
    const fields = new FormData(form), payload = {title:fields.get('title'),description:fields.get('description'),image:draft.image,profiles:[]};
    if (includeProfile) {
      let settings;
      try { settings = profileSelectors.get(form).read(); } catch (err) { error(err,$('dialog-error')); return; }
      const provided = {name:String(fields.get('packageProfileName')).trim(),...settings};
      const instructions = String(fields.get('packageProfileInstructions') || '').trim();
      if (instructions) provided.instructions = instructions;
      // Omitting componentIds binds the profile to the final component IDs
      // assigned by the backend, including copies from every selected package.
      payload.profiles.push(provided);
    }
    if (draft.selections.length) {
      // Derivation is kept as a single backend transaction; supplied components
      // are newly authored copies, not live dependencies on other packages.
      payload.selections = draft.selections.map(({key,componentIds}) => ({key,componentIds}));
      payload.components = draft.components;
      await act('derivePackage',payload,{close:true});
    } else { payload.components = draft.components; await act('createPackage',payload,{close:true}); }
  }
  function renderSnapshots() {
    if (native || !$('snapshots')) return;
    $('snapshots').innerHTML = captured.map((s,i) => '<details'+(i === 0 ? ' open' : '')+'><summary>'+t('접수 스냅샷','Captured snapshot')+' '+(captured.length-i)+'</summary><pre>'+esc(JSON.stringify(s,null,2))+'</pre></details>').join('');
  }
  listen(scope, 'click', async event => {
    const currentMenu = event.target.closest('.card-menu');
    scope.querySelectorAll('.card-menu[open]').forEach(menu => { if (menu !== currentMenu || event.target.closest('.card-menu button')) menu.open = false; });
    if (event.target.closest('.card-menu') && !event.target.closest('.card-menu button')) return;
    const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
    if (suppressHandleClick && el.classList.contains('profile-drag-handle')) { event.preventDefault(); return; }
    if (!state && ['new-package','new-profile','refresh','capture'].includes(el.dataset.action)) { await refresh(); if (disposed || !state) return; }
    const value = el.dataset.value;
    switch (el.dataset.action) {
      case 'role-refresh': await loadRoles(); break;
      case 'role-new': profileForm(); break;
      case 'role-edit': roleForm(roleState?.profiles.find(p => p.id === value)); break;
      case 'role-copy': roleForm(roleState?.profiles.find(p => p.id === value),true); break;
      case 'role-delete': { const p = roleState?.profiles.find(p => p.id === value); if (p && !builtinRole(p)) confirmDelete(p.name,form => roleAction('deleteProfile',{id:value},form)); break; }
      case 'team-new': configurationForm(); break;
      case 'direct-edit': configurationForm(null,true); break;
      case 'team-edit': configurationForm(roleState?.teamPresets.find(p => p.id === value)); break;
      case 'team-delete': { const p = roleState?.teamPresets.find(p => p.id === value); if (p) confirmDelete(p.name,form => roleAction('deleteTeamPreset',{id:value},form)); break; }
      case 'team-profile-edit': { const [teamId,profileId] = JSON.parse(value), team = roleState?.teams?.find(item => item.id === teamId), profile = team?.profiles.find(item => item.id === profileId); if (profile) roleForm(profile,false,teamId); break; }
      case 'detail': await openDetail(value); break;
      case 'close': $('dialog').close(); break;
      case 'refresh': await act('refresh'); break;
      case 'legacy-library': if (native) await act('legacyLibrary'); break;
      case 'retry-project': projectStatusFailed = false; renderPendingProject(); await refresh(); break;
      case 'equip': if (project) await act('equip',{projectId:project,profileId:value}); break;
      case 'unequip': if (project) await act('unequip',{projectId:project}); break;
      case 'new-profile': profileForm(); break;
      case 'edit-profile': { const profile = (state.profiles || []).find(p => p.id === value); if (profile) profileForm(null,profile); break; }
      case 'delete-profile': {
        const p = state.profiles.find(p => p.id === value), requestedProject = project, expectedRevision = state.revision, expectedRepoRevision = state.repoRevision;
        if (p && !protectedProfile(p)) confirmDelete(p.name,() => { if (project !== requestedProject) { error(new Error(t("프로젝트가 변경되었습니다. 다시 시도하세요.","The project changed. Please retry.")),$('dialog-error')); return; } return act('deleteProfile',{profileId:value,projectId:requestedProject || null,...(expectedRevision === undefined ? {} : {expectedRevision}),...(expectedRepoRevision === undefined ? {} : {expectedRepoRevision})},{close:true}); });
        break;
      }
      case 'duplicate-profile': {
        const currentForm = $('dialog').open ? $('profile-form') : null, requestedProject = project, requestedSerial = detailSerial;
        if (currentForm && profileProjects.get(currentForm) !== project) { error(new Error(t('프로젝트가 변경되었습니다. 프로필을 다시 여세요.','The project changed. Reopen the profile.')),$('dialog-error')); break; }
        const result = await act('duplicateProfile',{projectId:project || null,profileId:value,...(state.revision === undefined ? {} : {expectedRevision:state.revision}),...(state.repoRevision === undefined ? {} : {expectedRepoRevision:state.repoRevision})});
        const id = result?.profile?.id || result?.id || result?.profileId, copied = (state.profiles || []).find(p => p.id === id);
        if (copied && requestedProject === project && requestedSerial === detailSerial) profileForm(null,copied);
        break;
      }
      case 'new-package': startPackage(); break;
      case 'profile-package': profileForm(detail); break;
      case 'download': if (await act('download',{key:value})) await openDetail(value); break;
      case 'file': { const [i,j] = value.split(':').map(Number), file = detail.components[i].files[j]; $('file-preview').textContent = file.encoding === 'base64' ? t('바이너리 파일 (base64)\n','Binary file (base64)\n')+file.content : file.content; break; }
      case 'use-profile': profileForm(detail,detail.profiles[Number(value)]); break;
      case 'derive-start': { const componentIds = [...scope.querySelectorAll('[name="copy-component"]:checked')].map(input => input.value); if (!componentIds.length) { error(new Error(t('복사할 요소를 선택하세요.','Select components to copy.')),$('dialog-error')); break; } startPackage({key:detail.key,title:detail.title,componentIds}); break; }
      case 'choose-copy': await chooseCopy(); break;
      case 'stage-copy': { const holder = $('copy-choices'), componentIds = [...holder.querySelectorAll('input:checked')].map(input => input.value); if (componentIds.length) { draft.selections.push({key:holder.dataset.key,title:holder.dataset.title,componentIds}); holder.innerHTML = ''; renderStaged(); } break; }
      case 'add-component': addComponent(); break;
      case 'remove-component': draft.components.splice(Number(value),1); renderStaged(); break;
      case 'remove-selection': draft.selections.splice(Number(value),1); renderStaged(); break;
      case 'capture': if (!native) await act('captureRequest',{projectId:project || null}); break;
      case 'theme': { const dark = themeRoot.dataset.theme !== 'dark'; themeRoot.dataset.theme = dark ? 'dark' : 'light'; el.setAttribute('aria-pressed',String(dark)); break; }
    }
  });
  listen(scope,'keydown',event => { const card = event.target.closest('.interactive-card'); if (card === event.target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); card.click(); } });
  on($('project'), 'change', () => { project = $('project').value; generation++; projectPending = true; projectStatusFailed = false; if (state) render(); else renderPendingProject(); refresh(); });
  ['search','source','kind','downloaded'].forEach(id => listen($(id), id === 'search' ? 'input' : 'change',renderCards));
  on($('profiles'), 'dragstart', event => { const profile = event.target.closest('[data-profile]'); if (pointerDrag || !profile || event.target.closest('button') || !event.target.closest('.profile-drag-handle') || !project || !projectReady()) { event.preventDefault(); return; } nativeDragProject = project; event.dataTransfer.setData('application/x-azrael-profile',profile.dataset.profile); event.dataTransfer.effectAllowed = 'copy'; });
  on($('profiles'), 'dragend', () => { nativeDragProject = null; $('active-slot').classList.remove('dragover'); });
  on($('active-slot'), 'dragover', event => { if (project && projectReady() && event.dataTransfer.types.includes('application/x-azrael-profile')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; $('active-slot').classList.add('dragover'); } });
  on($('active-slot'), 'dragleave', () => $('active-slot').classList.remove('dragover'));
  on($('active-slot'), 'drop', event => { event.preventDefault(); $('active-slot').classList.remove('dragover'); const profileId = event.dataTransfer.getData('application/x-azrael-profile'); if (project && nativeDragProject === project && projectReady() && (state.profiles || []).some(p => p.id === profileId && rootProfile(p))) act('equip',{projectId:project,profileId}); nativeDragProject = null; });
  function pointerOverSlot(event) {
    const rect = $('active-slot').getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  }
  function finishPointerDrag(event, cancelled = false) {
    const drag = pointerDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    pointerDrag = null;
    drag.handle.classList.remove('dragging');
    $('active-slot').classList.remove('dragover');
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    if (drag.moved) {
      // Releasing over the slot must not also activate the handle's click action.
      suppressHandleClick = true;
      suppressClickTimer = setTimeout(() => { suppressHandleClick = false; },0);
      if (!cancelled && project === drag.projectId && projectReady() && pointerOverSlot(event) && (state.profiles || []).some(p => p.id === drag.profileId && rootProfile(p))) act('equip',{projectId:drag.projectId,profileId:drag.profileId});
    }
  }
  listen($('profiles'), 'keydown', event => {
    const profile = event.target.closest('.profile-drag-handle');
    if (profile && !profile.disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); profile.click(); }
  });
  listen($('profiles'), 'pointerdown', event => {
    const handle = event.target.closest('.profile-drag-handle');
    if (!handle || handle.disabled || event.button !== 0 || !event.isPrimary || !project || !projectReady()) return;
    event.preventDefault();
    handle.focus({preventScroll:true});
    suppressHandleClick = false;
    pointerDrag = {pointerId:event.pointerId,handle,profileId:handle.dataset.value,projectId:project,x:event.clientX,y:event.clientY,moved:false};
    handle.setPointerCapture(event.pointerId);
  });
  listen(scope, 'pointermove', event => {
    const drag = pointerDrag; if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    drag.handle.classList.add('dragging');
    $('active-slot').classList.toggle('dragover',project === drag.projectId && projectReady() && pointerOverSlot(event));
  },{passive:false});
  listen(scope, 'pointerup',event => finishPointerDrag(event));
  listen(scope, 'pointercancel',event => finishPointerDrag(event,true));
  listen(scope, 'lostpointercapture',event => finishPointerDrag(event,true));
  listen(scope, 'keydown',event => { if (event.key === 'Escape' && pointerDrag) finishPointerDrag({pointerId:pointerDrag.pointerId},true); });
  listen($('dialog'), 'close',() => { detailSerial++; });
  function dispose() {
    if (disposed) return;
    disposed = true; generation++; detailSerial++; draft = null;
    clearTimeout(poll); clearTimeout(suppressClickTimer);
    if (pointerDrag) {
      const {handle,pointerId} = pointerDrag; pointerDrag = null;
      handle.classList.remove('dragging');
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      $('active-slot')?.classList.remove('dragover');
    }
    for (const remove of removers.splice(0).reverse()) if (typeof remove === 'function') remove();
    for (const request of requests.values()) { clearTimeout(request.timer); request.reject(new Error(t('화면이 닫혔습니다.','The view was closed.'))); }
    requests.clear();
  }
  renderPendingProject();
  loadRoles();
  refresh();
  return {dispose};
}

function renderWorkbenchPage({token,locale = 'ko',native = false,projectId = '',cspSource,nonce} = {}) {
  const ko = locale.startsWith('ko'), t = (a,b) => ko ? a : b;
  const serialize = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const attribute = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nonceAttribute = native && nonce ? ' nonce="'+attribute(nonce)+'"' : '';
  const csp = native && cspSource && nonce ? '<meta http-equiv="Content-Security-Policy" content="'+attribute("default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; img-src "+cspSource+" data:;")+'">' : '';
  return `<!doctype html><html lang="${ko ? 'ko' : 'en'}"><head><meta charset="utf-8">${csp}<meta name="viewport" content="width=device-width,initial-scale=1"><title>${t('Agent 프로필 · Azrael','Agent profiles · Azrael')}</title><style${nonceAttribute}>
:root{color-scheme:light;--bg:#fff;--surface:#f7f7f7;--hover:#f0f0f0;--fg:#202020;--muted:#747474;--line:#e6e6e6;--strong:#202020;--inverse:#fff;--error:#aa3535;--focus:#686868}*{box-sizing:border-box}html[data-theme=dark]{color-scheme:dark;--bg:#202020;--surface:#292929;--hover:#333;--fg:#ececec;--muted:#aaa;--line:#414141;--strong:#ececec;--inverse:#202020;--error:#ff9999;--focus:#c4c4c4}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 13px;display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px}button:hover{background:var(--hover)}button:disabled{opacity:.45;cursor:default}.primary{background:var(--strong);color:var(--inverse);border-color:var(--strong)}.primary:hover{opacity:.85;background:var(--strong)}:focus-visible{outline:2px solid var(--focus);outline-offset:3px}svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}input,textarea,select{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:9px 11px;max-width:100%;min-width:0}input:not([type=checkbox]):not([type=file]),textarea{width:100%}input[type=checkbox]{accent-color:var(--strong);width:16px;height:16px}textarea{resize:vertical}h1,h2,h3,p{margin:0}h1{font-size:27px;letter-spacing:-.7px;font-weight:600}h2{font-size:18px;font-weight:600;letter-spacing:-.25px}h3{font-size:15px;font-weight:600}p{margin-top:7px}.muted,small{color:var(--muted)}small{font-size:12px}header{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 32px;gap:12px}.brand{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:600}.brand-mark{border:1px solid var(--line);width:28px;height:28px;border-radius:9px;display:grid;place-items:center}.saved-profiles-label{font-size:12px}.dev-label{font-size:11px;letter-spacing:.5px;color:var(--muted);border:1px solid var(--line);padding:2px 7px;border-radius:5px}.header-actions{display:flex;align-items:center;gap:10px}.icon-button{width:36px;padding:8px}.workspace{max-width:1376px;margin:0 auto;padding:40px 40px 70px}.page-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:29px}.page-heading p{color:var(--muted)}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:16px 0}.page-heading .actions{margin:0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:15px}.project-context{display:flex;gap:10px;align-items:center;color:var(--muted);font-size:12px}.project-context select{font-size:13px;color:var(--fg);max-width:240px}.active-slot{display:flex;align-items:center;gap:15px;border:1px dashed var(--line);border-radius:14px;padding:19px 22px;min-height:108px;background:var(--surface);margin-bottom:14px}.active-slot.dragover{outline:2px solid var(--focus);background:var(--hover)}.slot-symbol{width:42px;height:42px;display:grid;place-items:center;background:var(--bg);border:1px solid var(--line);border-radius:12px}.slot-symbol svg{width:22px;height:22px}.grow{flex:1;min-width:0}.eyebrow{font-size:10px;letter-spacing:1px;color:var(--muted)}.active-slot h3{font-size:17px;margin-top:2px}.active-slot p{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.profiles{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 10px}.profile{flex:0 0 240px;border:1px solid var(--line);border-radius:12px;padding:14px}.profile[draggable=true]{cursor:grab}.profile-heading{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.profile .profile-drag-handle{cursor:grab;touch-action:none;user-select:none}.profile[aria-disabled=true]{opacity:.45;cursor:default}.profile .profile-drag-handle.dragging{cursor:grabbing;background:var(--hover);outline:2px solid var(--focus)}.profile strong{overflow-wrap:anywhere}.profile p{color:var(--muted);font-size:12px;margin-bottom:12px}.profile button{font-size:12px;min-height:30px;padding:4px 10px}.profile small{display:block;margin-top:7px}.catalog-section{margin-top:35px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin:20px 0}.toolbar .search-field{display:flex;flex-direction:row;align-items:center;gap:8px;flex:1 1 250px;border:1px solid var(--line);border-radius:10px;padding-left:12px}.search-field input{border:0;background:transparent;outline-offset:0}.search-field svg{color:var(--muted)}.toolbar select{font-size:12px}.count{font-size:12px;font-weight:400;color:var(--muted);margin-left:8px}.cards{display:grid;grid-template-columns:repeat(auto-fill,min(100%,400px));gap:16px;justify-content:start}.package-card{height:144px;min-width:0;text-align:left;justify-content:flex-start;gap:18px;padding:20px;border-radius:14px;transition:background .15s,border-color .15s}.package-card:hover{border-color:var(--muted)}.package-image{width:88px;height:88px;background:var(--surface);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;color:var(--muted)}.package-image>svg{width:32px;height:32px;stroke-width:1.1}.package-image img{width:100%;height:100%;object-fit:cover}.package-content{display:flex;flex-direction:column;min-width:0;gap:7px}.package-content>strong{font-size:15px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-weight:600}.description{font-size:12px;color:var(--muted);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;line-height:1.6;min-height:38px}.badges{display:flex;gap:8px;flex-wrap:wrap;max-height:21px;overflow:hidden}.badge{font-size:10px;color:var(--muted);display:inline-flex;align-items:center;gap:3px;white-space:nowrap}.badge svg{width:12px;height:12px}.empty{grid-column:1/-1;text-align:center;padding:46px 18px;color:var(--muted);border:1px dashed var(--line);border-radius:12px}.empty.compact{width:100%;padding:22px;font-size:12px}.request-section{margin-top:34px;border-top:1px solid var(--line);padding-top:24px}.request-section .section-title{margin-bottom:4px}.request-section p{font-size:12px;color:var(--muted)}#snapshots details{margin-top:12px}.legacy{margin-top:28px;padding-top:22px;border-top:1px solid var(--line)}summary{cursor:pointer;overflow-wrap:anywhere}.legacy summary{font-size:13px;color:var(--muted)}.legacy ul{list-style:none;padding:0}.legacy li{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:12px 0;font-size:12px;overflow-wrap:anywhere}.corner-status{position:fixed;bottom:15px;right:22px;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:7px 11px;font-size:11px;color:var(--muted);box-shadow:0 2px 12px #00000006;max-width:calc(100vw - 32px);z-index:2}.corner-status button{font-size:11px;min-height:24px;padding:0 7px}.spinner{display:inline-block;width:10px;height:10px;border:1.5px solid var(--line);border-top-color:var(--muted);border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.error{color:var(--error);font-size:13px;margin:10px 0;overflow-wrap:anywhere}.notice{font-size:12px;color:var(--muted);min-height:18px;margin-top:10px}dialog{border:1px solid var(--line);border-radius:17px;padding:0;width:min(580px,calc(100vw - 32px));max-height:calc(100dvh - 48px);color:var(--fg);background:var(--bg);box-shadow:0 20px 90px #0003}dialog.wide{width:min(860px,calc(100vw - 32px))}dialog::backdrop{background:#0005;backdrop-filter:blur(2px)}.dialog-header{position:sticky;top:0;z-index:1;background:var(--bg);border-bottom:1px solid var(--line);padding:17px 22px;display:flex;justify-content:space-between;align-items:center;gap:15px}.dialog-header h2{overflow-wrap:anywhere}#dialog-body{padding:20px 24px 26px;overflow-wrap:anywhere}#dialog-body>h3{margin:24px 0 12px}form{display:flex;flex-direction:column;gap:15px}label{display:flex;flex-direction:column;gap:6px;font-size:12px}label.check-row{flex-direction:row;align-items:center;gap:8px;padding:5px 0}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}fieldset{margin:0;border:1px solid var(--line);padding:12px;border-radius:10px}.profile-settings,[data-provider-fields]{display:flex;flex-direction:column;gap:14px}#package-profile-options{border:0;padding:0;border-radius:0}fieldset:empty{display:none}legend{font-size:12px;color:var(--muted);padding:0 5px}hr{border:0;border-top:1px solid var(--line);width:100%;margin:4px 0}.detail-heading{display:flex;gap:20px;align-items:center}.detail-heading p{margin:0 0 8px}.detail-heading .muted{font-size:11px;word-break:break-all}.file-layout{display:grid;grid-template-columns:minmax(170px,1fr) minmax(0,2fr);gap:14px}.component-tree{border:1px solid var(--line);border-radius:10px;padding:10px;max-height:380px;overflow:auto}.component-tree details{margin-bottom:8px}.component-tree summary label{display:inline;cursor:pointer}.file-button{display:block;width:100%;font-size:11px;border:0;text-align:left;padding:5px 10px;min-height:30px;overflow-wrap:anywhere}.component-tree small{font-size:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--surface);padding:16px;border-radius:10px;font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;max-height:380px;overflow:auto;margin:0}.included-profile{border:1px solid var(--line);border-radius:10px;padding:15px;margin-top:10px}.included-profile p{font-size:12px;color:var(--muted);margin-bottom:10px}.included-profile pre{max-height:120px;margin-bottom:12px}.import-row{display:flex;gap:10px;align-items:flex-end}.import-row label{flex:1;min-width:0}.component-editor{background:var(--surface);padding:16px;border:1px solid var(--line);border-radius:12px;display:flex;flex-direction:column;gap:12px}.staged-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:12px}.staged-row button{font-size:11px;padding:3px 8px;min-height:28px}.upload-preview{width:72px;height:72px;border-radius:10px;object-fit:cover}#import-summary{font-size:11px;max-height:100px;overflow:auto}.file-import input{font-size:11px}button,input,select,textarea{touch-action:manipulation}[hidden]{display:none!important}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}@media(min-width:1500px){.workspace{max-width:1700px}}@media(max-width:850px){.workspace{padding:28px 24px 65px}.page-heading{flex-direction:column;gap:16px}.section-title{align-items:flex-start;flex-wrap:wrap}.package-card{gap:14px;padding:17px}.project-context{flex-wrap:wrap}.file-layout{grid-template-columns:1fr}.component-tree{max-height:220px}}@media(max-width:480px){header{padding:0 16px}.brand{font-size:13px}.dev-label{font-size:9px}.workspace{padding:24px 16px 65px}h1{font-size:24px}.toolbar{gap:7px}.toolbar select{flex:1;min-width:0;padding:8px 6px;font-size:11px}.toolbar .search-field{flex-basis:100%}.package-card{height:144px;gap:12px;padding:13px}.package-image{width:76px;height:88px}.badges{gap:6px}.badge{font-size:9px}.badge svg{width:10px;height:10px}.active-slot{padding:15px;gap:10px}.active-slot h3{font-size:15px}.slot-symbol{width:34px;height:34px}.active-slot button{font-size:11px;padding:5px 8px}.project-context select{max-width:220px}dialog,dialog.wide{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}#dialog-body{padding:16px}.dialog-header{padding:14px 16px}.form-grid{grid-template-columns:1fr}.detail-heading{align-items:flex-start;gap:12px}.detail-heading .package-image{width:62px;height:62px}.import-row{align-items:stretch;flex-direction:column}.corner-status{right:12px;bottom:10px}}
dialog.composer-dialog{width:min(1120px,calc(100vw - 32px))}.composer-layout{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:28px;align-items:start}.composer-slots{display:flex;flex-direction:column;gap:14px}.composer-slot{border:1px solid var(--line);border-radius:12px;padding:14px;min-width:0}.composer-slot h3{margin-bottom:10px}.composer-slot summary{display:flex;align-items:center;justify-content:space-between;gap:12px}.composer-slot pre{margin-top:12px;max-height:220px}.composer-slot textarea{margin-top:10px}.composer-slot.dragover{outline:2px solid var(--focus);background:var(--hover)}#composer-selections{display:flex;flex-direction:column;gap:14px}.slot-empty{font-size:12px;color:var(--muted);margin:0;min-height:22px}.selected-resource{display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line);font-size:12px}.selected-resource:first-child{border-top:0}.selected-resource[draggable=true]{cursor:grab}.slot-actions{display:flex;gap:4px}.slot-actions button{padding:4px;min-height:28px;min-width:28px}.slot-actions svg{width:14px;height:14px}.composer-library{position:sticky;top:77px;display:flex;flex-direction:column;gap:14px;min-width:0}.composer-library .search-field{display:flex;flex-direction:row;align-items:center;gap:6px;border:1px solid var(--line);border-radius:9px;padding-left:10px}.composer-library .search-field input{border:0;background:transparent}.resource-tabs{display:flex;gap:5px;flex-wrap:wrap}.resource-tabs button{padding:5px 9px;min-height:30px;font-size:12px;border-color:transparent}.resource-tabs button[aria-pressed=true]{background:var(--surface);border-color:var(--line)}.resource-list{max-height:62dvh;overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);border-radius:12px}.resource-item{display:flex;align-items:center;gap:12px;padding:14px;border-bottom:1px solid var(--line);font-size:12px}.resource-item:last-child{border-bottom:0}.resource-item[draggable=true]{cursor:grab}.resource-item small{display:block;font-size:11px}.resource-item p{font-size:12px;color:var(--muted)}.resource-item button{padding:6px;min-width:32px;min-height:32px}.resource-item .profile-diagnostic,.profile-diagnostic{color:var(--error);font-size:12px;overflow-wrap:anywhere}.profile-actions{display:flex;gap:6px;margin-top:10px}.profile-drag-handle{border-radius:6px}.composer-footer{display:flex;justify-content:flex-end;border-top:1px solid var(--line);padding-top:16px}.composer-footer button{min-width:92px}#profile-options{padding:0;border:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:760px){.composer-layout{grid-template-columns:1fr;gap:24px}.composer-library{position:static}.resource-list{max-height:380px}dialog.composer-dialog{width:calc(100vw - 16px)}.slot-actions{gap:2px}}@media(forced-colors:active){.resource-tabs button[aria-pressed=true]{border-color:Highlight}.composer-slot.dragover{outline-color:Highlight}}.composer-model-settings{display:flex;flex-direction:column;gap:10px}.resource-item .resource-description{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden}.package-metadata{display:flex;flex-wrap:wrap;gap:12px 24px;margin:12px 0}.package-metadata div{min-width:0}.package-metadata dt{font-size:11px;color:var(--muted)}.package-metadata dd{margin:3px 0 0;font-size:13px;overflow-wrap:anywhere}.package-component{padding:12px 0;border-bottom:1px solid var(--line)}.package-component summary{cursor:pointer;overflow-wrap:anywhere}.package-component summary strong{font-size:13px}.package-component summary small{display:block;margin:4px 0 0 16px;color:var(--muted)}.package-component .check-row{margin:12px 0;font-size:11px}.package-integrity{margin-top:20px;color:var(--muted);font-size:12px}.package-integrity pre{overflow-wrap:anywhere;white-space:pre-wrap}.package-composition{font-size:11px;color:var(--muted)}.role-settings{margin-bottom:40px;padding-bottom:24px;border-bottom:1px solid var(--line)}.role-settings>.section-title{margin-top:24px}.role-choices{display:flex;flex-wrap:wrap;gap:20px}#role-form fieldset{border:0;padding:0;margin:16px 0}#role-form legend{font-size:13px;margin-bottom:10px}#role-configuration select[multiple]{min-height:124px}#role-form textarea{min-height:180px}.interactive-card{position:relative;cursor:pointer;padding-right:48px}.interactive-card:focus-visible,.profile-drag-handle:focus-visible,.card-menu summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.profile-avatar{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;flex:none;border-radius:50%;overflow:hidden;background:var(--surface)}.profile-avatar img{width:100%;height:100%;object-fit:cover}.profile-heading .profile-avatar svg{width:18px;height:18px}.profile-drag-handle{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;font-size:12px;border:1px solid var(--line);cursor:grab}.profile-drag-handle svg{width:14px;height:14px}.card-menu{position:absolute;right:10px;top:10px;z-index:2}.card-menu summary{list-style:none;border-radius:7px;min-width:30px;min-height:30px;display:flex;justify-content:center;align-items:center;font-size:21px;cursor:pointer;background:var(--bg)}.card-menu summary::-webkit-details-marker{display:none}.card-menu-items{position:absolute;right:0;top:35px;min-width:140px;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:5px;box-shadow:0 6px 20px #0002}.card-menu-items button{text-align:left;border:0}.danger{color:var(--error)}.team-preset{padding:0;overflow:visible}.team-card-image{width:100%;aspect-ratio:4/3;background:var(--surface);border-radius:13px 13px 0 0;overflow:hidden;display:flex;align-items:center;justify-content:center}.team-card-image img{width:100%;height:100%;object-fit:cover}.team-card-image svg{width:40px;height:40px}.team-card-content{padding:16px}.image-field{display:flex;flex-direction:column;align-items:flex-start;gap:10px}.image-editor-preview img{display:block;width:96px;height:96px;object-fit:cover;border-radius:10px}.composer-footer{gap:8px}</style></head><body><header><div class="brand"><span class="brand-mark">A</span>Azrael ${native ? '' : `<span class="dev-label">${t('개발 작업공간','DEVELOPMENT')}</span>`}</div><div class="header-actions"><button class="icon-button" type="button" data-action="theme" aria-label="${t('밝은 테마 / 어두운 테마 전환','Toggle light / dark theme')}" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/></svg></button></div></header><main class="workspace"><div class="page-heading"><div><h1>${t('Agent 프로필','Agent profiles')}</h1></div><div class="actions"><button type="button" data-action="new-package" class="primary">+ ${t('새 패키지','New package')}</button></div></div><p id="error" class="error" role="alert" hidden></p><section aria-labelledby="profiles-heading"><div class="section-title"><h2 id="profiles-heading">${t('프로필','Profiles')}</h2><label class="project-context" for="project"${native ? ' hidden' : ''}>${t('현재 프로젝트','Current project')}<select id="project"${native ? ' disabled' : ''} aria-label="${t('현재 프로젝트','Current project')}"><option value="">${t('프로젝트 없음 · 기본 설정','No project · defaults')}</option></select></label></div><div id="active-slot" class="active-slot" aria-label="${t('활성 프로필 드롭 영역','Active profile drop zone')}"></div><div class="section-title"><span class="muted saved-profiles-label">${t('저장한 프로필 · 클릭해 편집, 장착 버튼으로 활성화','Saved profiles · click to edit, use Equip to activate')}</span><button type="button" data-action="new-profile">+ ${t('프로필 만들기','Create profile')}</button></div><div id="profiles" class="profiles"></div></section><section class="role-settings" aria-label="Team / Direct"><p id="role-error" class="error" role="alert" hidden></p><div class="section-title"><h3>Team</h3><button type="button" data-action="team-new">+ ${t('Team 구성','Team configuration')}</button></div><div id="team-presets" class="profiles"></div><div class="section-title"><h3>${t('실행 중인 팀','Running teams')}</h3></div><p class="muted">${t('Team 프로필 변경은 이후 생성하는 세션부터 적용됩니다.','Team profile changes apply to sessions created afterward.')}</p><div id="team-instances"></div><div class="section-title"><div><h3>${t('Direct \uacf5\ud1b5 \uc124\uc815','Direct defaults')}</h3><p id="direct-summary" class="muted"></p></div><button type="button" data-action="direct-edit">${t('\ud3b8\uc9d1','Edit')}</button></div></section><section class="catalog-section" aria-labelledby="catalog-heading"><div class="section-title"><h2 id="catalog-heading">${t('패키지 라이브러리','Package library')}<span class="count" id="count">0</span></h2><button id="refresh" type="button" data-action="refresh">${t('업데이트 확인','Check for updates')}</button></div><div class="toolbar"><label class="search-field"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="search" type="search" aria-label="${t('패키지 검색','Search packages')}" placeholder="${t('제목이나 설명으로 검색','Search title or description')}"></label><select id="source" aria-label="${t('출처 필터','Source filter')}"><option value="">${t('모든 출처','All sources')}</option><option value="local">${t('로컬','Local')}</option><option value="github">GitHub</option></select><select id="kind" aria-label="${t('구성 종류 필터','Component type filter')}"><option value="">${t('모든 구성 종류','All component types')}</option></select><select id="downloaded" aria-label="${t('다운로드 상태 필터','Download status filter')}"><option value="">${t('모든 상태','All states')}</option><option value="yes">${t('사용 가능','Available')}</option><option value="no">${t('미다운로드','Not downloaded')}</option></select></div><p id="source-error" class="error" role="status" hidden></p><div id="cards" class="cards"></div></section>${native ? '' : `<section class="request-section" aria-labelledby="request-heading"><div class="section-title"><h2 id="request-heading">${t('요청 스냅샷 확인','Request snapshot preview')}</h2><button type="button" data-action="capture">${t('요청 접수 스냅샷','Capture request snapshot')}</button></div><p>${t('프로필 전환 전후의 실제 개발 스냅샷을 비교하세요. 이 탭은 설치된 Azrael 앱이나 실행 중인 요청을 변경하지 않습니다.','Compare actual development snapshots before and after switching profiles. This tab does not change the installed Azrael app or running requests.')}</p><div id="snapshots"></div></section>`} <details class="legacy"><summary>${t('기존 라이브러리','Legacy library')} <span id="legacy-count">0</span></summary><ul id="legacy-list"></ul>${native ? `<button type="button" data-action="legacy-library">${t('기존 라이브러리 관리','Manage legacy library')}</button>` : ''}</details><p class="notice" id="notice" role="status"></p></main><div id="github-status" class="corner-status" role="status"></div><dialog id="dialog" aria-labelledby="dialog-title"><div class="dialog-header"><h2 id="dialog-title"></h2><button type="button" class="icon-button" data-action="close" aria-label="${t('닫기','Close')}">×</button></div><div id="dialog-body"></div></dialog><script${nonceAttribute}>(${workbenchClient.toString()})(${serialize(token || '')},${serialize(locale)}${native ? ','+serialize({native:true,projectId}) : ''});</script></body></html>`;
}

module.exports = {renderWorkbenchPage,workbenchClient};
