"use strict";

const PINNED_STARTUP_GUARD = 'class{constructor(e){this.onTimeout=e}timeout;disposed=!1;receivedWebviewMessage=!1;start(){if(this.disposed||this.timeout!=null)return;let e=Date.now();this.timeout=setTimeout(()=>{this.timeout=void 0,this.onTimeout({elapsedMs:Date.now()-e,receivedWebviewMessage:this.receivedWebviewMessage,timeoutMs:3e4})},3e4)}markMessageReceived(){this.receivedWebviewMessage=!0}handleStartupPhase(e){e==="renderer_ready"&&this.dispose()}dispose(){this.disposed=!0,this.timeout!=null&&(clearTimeout(this.timeout),this.timeout=void 0)}}';
const STARTUP_GUARD = `class{constructor(onTimeout){this.onTimeout=onTimeout}timeout;disposed=false;receivedWebviewMessage=false;startedAt;lastProgressAt;start(){if(this.disposed||this.startedAt!==undefined)return;this.startedAt=this.lastProgressAt=Date.now();this.arm()}arm(){if(this.disposed)return;clearTimeout(this.timeout);const now=Date.now(),remaining=Math.min(30000-(now-this.lastProgressAt),120000-(now-this.startedAt));this.timeout=setTimeout(()=>{this.timeout=undefined;const now=Date.now();if(now-this.lastProgressAt<30000&&now-this.startedAt<120000){this.arm();return}this.dispose();this.onTimeout({elapsedMs:now-this.startedAt,receivedWebviewMessage:this.receivedWebviewMessage,timeoutMs:30000,maximumTimeoutMs:120000})},Math.max(0,remaining))}markMessageReceived(){this.receivedWebviewMessage=true;if(this.startedAt!==undefined&&!this.disposed){this.lastProgressAt=Date.now();this.arm()}}handleStartupPhase(phase){if(phase==="renderer_ready")this.dispose();else if(phase==="renderer_entry_evaluated"||phase==="host_services_ready")this.markMessageReceived()}dispose(){this.disposed=true;clearTimeout(this.timeout);this.timeout=undefined}}`;

function injectStartupGuard(text) {
  if (text.split(PINNED_STARTUP_GUARD).length !== 2) throw new Error("Pinned renderer startup guard changed.");
  return { text: text.replace(PINNED_STARTUP_GUARD, STARTUP_GUARD), count: 1 };
}

// Pin structural boundaries, not minified variable names. Fail packaging when
// upstream changes a contract instead of silently shipping a partial hook.
function injectRecovery(text, filename, ts) {
  text = injectStartupGuard(text).text;
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [];
  const counts = { sendProviderRequest: 0, routeIncomingMessage: 0, teardownProcess: 0 };
  let webviewCount = 0;
  const visit = node => {
    if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) &&
        node.left.name.text === "html" && ts.isAwaitExpression(node.right) &&
        ts.isCallExpression(node.right.expression) && ts.isPropertyAccessExpression(node.right.expression.expression) &&
        node.right.expression.expression.name.text === "getWebviewContent") {
      edits.push({ start: node.right.getStart(source), end: node.right.end,
        text: `require("./optional-diagnostics.cjs").injectUiInputPolicy(${node.right.getText(source)})` });
      webviewCount++;
    }
    if (ts.isMethodDeclaration(node) && node.name?.text === "sendProviderRequest") {
      if (!node.body || node.parameters.length !== 6 || !node.parameters.every(p => ts.isIdentifier(p.name))) {
        throw new Error("Pinned recovery request signature changed.");
      }
      const names = node.parameters.map(p => p.name.text).join(",");
      const body = text.slice(node.body.getStart(source) + 1, node.body.end - 1);
      edits.push({ start: node.body.getStart(source), end: node.body.end,
        text: `{return require("./azrael-recovery.cjs").dispatch(this,[${names}],function(${names}){${body}}.bind(this))}` });
      counts.sendProviderRequest++;
      for (const sibling of node.parent.members) {
        const name = sibling.name?.text;
        if (name === "routeIncomingMessage" && sibling.parameters.length === 2 && ts.isIdentifier(sibling.parameters[0].name)) {
          const message = sibling.parameters[0].name.text;
          edits.push({ start: sibling.body.getStart(source) + 1, end: sibling.body.getStart(source) + 1,
            text: `require("./azrael-recovery.cjs").observe(this,${message});` });
          counts.routeIncomingMessage++;
        }
        if (name === "teardownProcess" && sibling.parameters.length === 0) {
          edits.push({ start: sibling.body.getStart(source) + 1, end: sibling.body.getStart(source) + 1,
            text: 'require("./azrael-recovery.cjs").disconnect(this);' });
          counts.teardownProcess++;
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (Object.values(counts).some(count => count !== 1)) throw new Error(`Pinned recovery bridge changed: ${JSON.stringify(counts)}`);
  if (webviewCount !== 1) throw new Error(`Pinned UI diagnostics bootstrap changed: ${webviewCount}`);
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  if (ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).parseDiagnostics.length) {
    throw new Error("Invalid recovery bridge transform.");
  }
  return { text, count: edits.length + 1 };
}

module.exports = { injectRecovery, injectStartupGuard };
