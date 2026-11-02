import { createDetailPanel } from './detail-panel.mjs';
import { createDialogs } from './dialogs.mjs';
import '@xterm/xterm/css/xterm.css';
import './detail-panel.css';
import './shell.css';

const bridge = window.azraelDesktop;
const dialogs = createDialogs({ bridge });
const detail = document.getElementById('detail');
const error = document.getElementById('app-error');
const params = new URLSearchParams(location.search);
const cwd = params.get('workspace');
document.getElementById('workspace').textContent = cwd;
document.documentElement.style.colorScheme = params.get('theme') || 'light dark';
const panel = createDetailPanel({ container: detail, bridge, getWorkingDirectory: () => cwd, onClose: () => layout(false) });
function layout(visible) {
  detail.hidden = !visible;
  panel.setVisible(visible);
  bridge.layout({ detailWidth: visible ? innerWidth <= 900 ? innerWidth : Math.min(540, Math.max(300, Math.round(innerWidth * .42))) : 0 });
}
function report(cause) { error.textContent = cause.message; error.hidden = false; }
document.getElementById('open-file').addEventListener('click', async () => {
  try { const selected = await bridge.chooseTextFile(); if (selected) { layout(true); await panel.openTextFile({ path: selected }); } }
  catch (cause) { report(cause); }
});
document.getElementById('terminal').addEventListener('click', async () => { try { layout(true); await panel.openTerminal(); } catch (cause) { report(cause); } });
document.getElementById('chat').addEventListener('click', () => bridge.showChat());
bridge.onAction(async action => {
  try {
    if (dialogs.handleAction(action)) return;
    if (action.type === 'theme') { document.documentElement.style.colorScheme = action.dark ? 'dark' : 'light'; return; }
    if (action.type === 'file') { layout(true); await panel.openTextFile(action); }
    else if (action.type === 'terminal') { layout(true); await panel.openTerminal(); }
    else if (action.type === 'error') report(new Error(action.message));
  } catch (cause) { report(cause); }
});
addEventListener('resize', () => layout(!detail.hidden));
addEventListener('keydown', event => { if (event.key === 'Escape' && !detail.hidden) { layout(false); document.getElementById('open-file').focus(); } });
