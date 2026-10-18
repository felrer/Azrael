"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { CSS_ASSET, RUNTIME, injectCommandDragBlock } = require("./inject-command-drag-block.cjs");
function makeHtml() {
  const css = injectCommandDragBlock(fs.readFileSync(path.resolve(__dirname, "../artifacts/upstream-ui/26.1007.21434", CSS_ASSET), "utf8"), CSS_ASSET).text;
  return `<!doctype html><meta charset="utf-8"><style>${css}
body{font:16px sans-serif;margin:24px}#ordinary{margin-bottom:16px}
.azrael-command-execution{border:1px solid #888;border-radius:8px;padding:12px;width:500px}
#output{height:100px;overflow:auto;white-space:pre-wrap;margin-top:12px}button{border:1px solid #888;padding:4px;margin-right:8px}
#composer{border:1px solid #888;margin-top:20px;padding:12px;width:500px}</style>
<p id="ordinary">Ordinary assistant text remains selectable for copying.</p>
<section class="azrael-command-execution"><span id="command">node synthetic-command.js --check</span>
<p><button id="toggle">Expand / collapse</button><button id="copy">Copy command</button></p>
<pre id="output"></pre></section><div id="composer" contenteditable="true">Composer drop target</div>
<script>${RUNTIME}
document.querySelector('#output').textContent=Array.from({length:80},(_,i)=>'Synthetic command output line '+i).join('\\n');
window.toggleCount=0;window.copyCount=0;window.dropCount=0;
document.querySelector('#toggle').onclick=()=>{window.toggleCount++;const o=document.querySelector('#output');o.hidden=!o.hidden};
document.querySelector('#copy').onclick=()=>{window.copyCount++;window.copiedText=document.querySelector('#command').textContent};
document.querySelector('#composer').ondrop=()=>{window.dropCount++};
</script>`;
}
async function check({ evaluate, view, shot, result }) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const click = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector('${selector}').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await view.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await view.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  const drag = async selector => {
    const points = await evaluate(`(()=>{getSelection().removeAllRanges();const node=document.querySelector('${selector}').firstChild;const r=document.createRange();r.setStart(node,0);r.setEnd(node,1);const a=r.getBoundingClientRect();r.setStart(node,20);r.setEnd(node,21);const b=r.getBoundingClientRect();return {start:{x:a.left+1,y:a.top+a.height/2},end:{x:b.right,y:b.top+b.height/2}}})()`);
    await view.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...points.start });
    for (let i = 1; i <= 8; i++) await view.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: points.start.x + (points.end.x - points.start.x) * i / 8, y: points.start.y + (points.end.y - points.start.y) * i / 8 });
    await view.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...points.end });
    return evaluate("getSelection().toString()");
  };
  result.before = await evaluate("({ua:navigator.userAgent})");
  result.commandDragChecks = [];
  for (const theme of ["light", "dark"]) {
    await evaluate(`document.body.style.background='${theme === "dark" ? "#212121" : "#fff"}';document.body.style.color='${theme === "dark" ? "#eee" : "#111"}';document.body.className='vscode-${theme}';window.toggleCount=0;void 0`);
    assert.ok((await drag("#ordinary")).length > 0, "ordinary conversation must remain selectable with trusted input");
    assert.equal(await drag("#command"), "", "command text drag must not select");
    assert.equal(await drag("#output"), "", "command output drag must not select");
    const events = await evaluate(`(()=>{const checks={};for(const name of ['selectstart','dragstart'])for(const id of ['command','ordinary']){const e=new Event(name,{bubbles:true,cancelable:true});document.querySelector('#'+id).dispatchEvent(e);checks[id+':'+name]=e.defaultPrevented}return checks})()`);
    assert.deepEqual(events, { "command:selectstart": true, "ordinary:selectstart": false, "command:dragstart": true, "ordinary:dragstart": false });
    for (let i = 0; i < 6; i++) await click("#toggle");
    await click("#copy");
    const controls = await evaluate("({toggleCount,copyCount,copiedText,focused:document.activeElement.id,hidden:document.querySelector('#output').hidden})");
    assert.equal(controls.toggleCount, 6); assert.ok(controls.copyCount > 0); assert.equal(controls.copiedText, "node synthetic-command.js --check"); assert.equal(controls.focused, "copy"); assert.equal(controls.hidden, false);
    const point = await evaluate("(()=>{const r=document.querySelector('#output').getBoundingClientRect();return {x:r.left+100,y:r.top+35}})()");
    await view.send("Input.dispatchMouseEvent", { type: "mouseWheel", deltaX: 0, deltaY: 180, ...point });
    await sleep(180);
    const scrollTop = await evaluate("document.querySelector('#output').scrollTop");
    assert.ok(scrollTop > 0, "native output wheel scroll remains available");
    await evaluate("document.querySelector('#output').scrollTop=0;document.querySelector('#composer').dispatchEvent(new Event('drop',{bubbles:true,cancelable:true}));void 0");
    const dropCount = await evaluate("window.dropCount"); assert.ok(dropCount > 0);
    await shot("command-drag-" + theme);
    result.commandDragChecks.push({ theme, trustedCommandSelectionBlocked: true, trustedOutputSelectionBlocked: true, ordinarySelectionPreserved: true, events, controls, scrollTop, dropCount });
  }
  result.after = { toggleCount: 6 };
  result.limitations.push("Synthetic DOM exercises production policy/CSS in native Windows Webview; it does not mount the full application, use the OS clipboard, attach a real file or establish installed-package acceptance.");
}
module.exports = { makeHtml, check };
