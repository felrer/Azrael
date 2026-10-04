import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { ChatSession } from "./chatSession";

export class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private started = false;
  constructor(private readonly session: ChatSession) {
    session.on("change", () => this.render());
  }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = html(view.webview.cspSource);
    view.webview.onDidReceiveMessage((message: unknown) => {
      void this.dispatch(message).catch(error => {
        const reason = error instanceof Error ? error.message : "Chat action failed";
        void vscode.window.showErrorMessage(reason);
      });
    });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    this.render();
    this.start();
  }
  start(): void { if (!this.started) { this.started = true; void this.session.start(); } }
  private render(): void { void this.view?.webview.postMessage({ type: "state", state: this.session.state }); }
  private async dispatch(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") return;
    const value = message as Record<string, unknown>;
    switch (value.type) {
      case "models": await this.session.refreshModels(true); break;
      case "threads": await this.session.refreshThreads(); break;
      case "model": if (typeof value.id === "string") this.session.selectModel(value.id, typeof value.effort === "string" ? value.effort : undefined); break;
      case "new": await this.session.newThread(); break;
      case "open": if (typeof value.id === "string") await this.session.openThread(value.id); break;
      case "send": if (typeof value.text === "string" && value.text.length <= 200_000) await this.session.send(value.text); break;
      case "compact": await this.session.compact(); break;
      case "queue-refresh": await this.session.refreshQueue(); break;
      case "queue-cancel": if (typeof value.id === "string") await this.session.cancelQueued(value.id); break;
      case "queue-move": if (typeof value.id === "string" && (value.offset === -1 || value.offset === 1)) await this.session.moveQueued(value.id, value.offset); break;
      case "stop": await this.session.stop(); break;
      case "approval": if ((typeof value.id === "string" || typeof value.id === "number") && (value.decision === "accept" || value.decision === "decline")) this.session.approve(value.id, value.decision); break;
    }
  }
  dispose(): void { this.session.dispose(); }
}

function html(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';"><style nonce="${nonce}">
    body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:10px;margin:0}button,select,textarea{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:3px}button{padding:4px 8px;cursor:pointer}select{max-width:100%;padding:4px}textarea{width:100%;box-sizing:border-box;min-height:72px;resize:vertical}header,.controls,.compose{display:flex;gap:6px;align-items:center;margin-bottom:8px}.controls{flex-wrap:wrap}.threads{max-height:150px;overflow:auto;border-bottom:1px solid var(--vscode-panel-border);margin-bottom:8px}.threads button{display:block;width:100%;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:0;background:transparent}.threads button:hover{background:var(--vscode-list-hoverBackground)}.messages{overflow:auto;max-height:calc(100vh - 420px)}.message,.queued{padding:6px 0;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;overflow-wrap:anywhere}.message strong{display:block;margin-bottom:3px}.queue{max-height:160px;overflow:auto}.queued button{margin-left:4px}.approval{border:1px solid var(--vscode-editorWarning-foreground);padding:8px;margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.error{color:var(--vscode-errorForeground)}.compose{display:block}.compose button{margin-top:6px}
  </style></head><body><header><strong>Azrael</strong><span id="status"></span><span title="All providers use the Azrael engine with no tool approval prompts or sandbox restrictions">Full access</span><button id="refresh" title="Refresh models and threads">↻</button></header><div class="controls"><select id="models" aria-label="Model"></select><select id="efforts" aria-label="Reasoning effort"></select><button id="new">New chat</button></div><div id="threads" class="threads"></div><div id="error" class="error" role="alert"></div><div id="approvals"></div><div id="messages" class="messages" aria-live="polite"></div><section><strong>Pending queue</strong> <button id="queue-refresh" title="Refresh pending queue">↻</button><div id="queue" class="queue" aria-live="polite"></div></section><div class="compose"><textarea id="prompt" aria-label="Message" placeholder="Ask Azrael…"></textarea><button id="send">Send</button><button id="compact">Compact context</button><button id="stop">Stop</button></div>
  <script nonce="${nonce}">const api=acquireVsCodeApi();const by=id=>document.getElementById(id);let current;const send=(type,extra={})=>api.postMessage({type,...extra});function option(parent,value,label){const el=document.createElement('option');el.value=value;el.textContent=label;parent.append(el)}function draw(state){current=state;by('status').textContent=state.status;by('error').textContent=state.error||'';const models=by('models');models.replaceChildren();for(const model of state.models)option(models,model.id,model.label);models.value=state.selectedModel||'';models.disabled=!!state.modelSelectionLocked;models.title=state.modelSelectionLocked?'Wait for or cancel pending queue items to change model':'';const selected=state.models.find(m=>m.id===models.value);const efforts=by('efforts');efforts.replaceChildren();option(efforts,'','Default effort');for(const effort of selected?.efforts||[])option(efforts,effort,effort);efforts.value=state.selectedEffort||'';efforts.disabled=!!state.modelSelectionLocked;efforts.title=models.title;const threads=by('threads');threads.replaceChildren();for(const thread of state.threads){const button=document.createElement('button');button.textContent=thread.title;button.title=thread.id;button.onclick=()=>send('open',{id:thread.id});threads.append(button)}const approvals=by('approvals');approvals.replaceChildren();for(const approval of state.approvals){const box=document.createElement('div');box.className='approval';const detail=document.createElement('div');detail.textContent=approval.kind+' approval in '+approval.threadId+': '+approval.detail;box.append(detail);for(const decision of ['accept','decline']){const button=document.createElement('button');button.textContent=decision==='accept'?'Approve':'Decline';button.onclick=()=>send('approval',{id:approval.id,decision});box.append(button)}approvals.append(box)}const messages=by('messages');messages.replaceChildren();for(const item of state.items){const box=document.createElement('div');box.className='message';const role=document.createElement('strong');role.textContent=item.role;const text=document.createElement('span');text.textContent=item.text;box.append(role,text);messages.append(box)}messages.scrollTop=messages.scrollHeight;const queue=by('queue');queue.replaceChildren();for(const [index,entry] of state.queue.entries()){const row=document.createElement('div');row.className='queued';const label=document.createElement('span');label.textContent=(entry.kind==='contextCompaction'?'Compact context':entry.text)||'Message';row.append(label);for(const [title,type,offset] of [['↑','queue-move',-1],['↓','queue-move',1],['Cancel','queue-cancel',0]]){const button=document.createElement('button');button.textContent=title;button.title=title==='Cancel'?'Cancel queued item':'Move queued item';button.disabled=type==='queue-move'&&(index+offset<0||index+offset>=state.queue.length);button.onclick=()=>send(type,{id:entry.id,offset});row.append(button)}queue.append(row)}by('stop').disabled=!state.turnId}window.addEventListener('message',event=>{if(event.data?.type==='state')draw(event.data.state)});by('refresh').onclick=()=>{send('models');send('threads');send('queue-refresh')};by('queue-refresh').onclick=()=>send('queue-refresh');by('new').onclick=()=>send('new');by('models').onchange=()=>send('model',{id:by('models').value});by('efforts').onchange=()=>send('model',{id:by('models').value,effort:by('efforts').value});by('send').onclick=()=>{const prompt=by('prompt');if(prompt.value.trim()){send('send',{text:prompt.value});prompt.value=''}};by('compact').onclick=()=>send('compact');by('stop').onclick=()=>send('stop');</script></body></html>`;
}
