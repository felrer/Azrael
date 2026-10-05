"use strict";

const SESSION_LINK_ASSETS = [
  "out/extension.js",
  "webview/assets/app-initial-4bd9e54bcd58.js",
  "webview/assets/app-initial-9cbfb5c07b41.js",
  "webview/assets/chatgpt-conversation-turn-content-8f307c03dd18.js",
  "webview/assets/app-initial-7d34126aa1b5.js",
  "webview/assets/app-initial-8b38f95f65ff.js",
  "webview/assets/chatgpt-conversation-turn-content-3b059e762d69.js",
];
const MARKER = "/*azrael-local-session-links-v1*/";
function injectSessionLinks(text, relativePath) {
  if (!SESSION_LINK_ASSETS.includes(relativePath)) return { text, count: 0 };
  if (text.includes(MARKER)) return { text, count: 0 };
  let count = 0;
  function once(before, after) {
    if (text.split(before).length !== 2) throw new Error(`Pinned session-link anchor drift: ${relativePath}: ${before.slice(0, 90)}`);
    text = text.replace(before, after);
    count++;
  }
  if (relativePath === SESSION_LINK_ASSETS[0]) {
    once('host:c.literal("threads"),protocol:c.literal("codex:")', 'host:c.literal("threads"),protocol:c.literal("azrael:")');
    const current = text.includes("let y=new ZN(t.extensionUri,u);e.push(y);");
    const connection = current ? "ZN" : "XN", api = current ? "kt" : "Mt";
    once(`let y=new ${connection}(t.extensionUri,u);e.push(y);`, `let y=new ${connection}(t.extensionUri,u);e.push(y);e.push(require("./session-links.cjs").registerMigrationCommand(${api},y));`);
  } else if ([SESSION_LINK_ASSETS[1], SESSION_LINK_ASSETS[4]].includes(relativePath)) {
    const current = relativePath === SESSION_LINK_ASSETS[4];
    const name = current ? "f5n" : "B$n", host = current ? "oh" : "eh", copy = current ? "bj" : "qA", decorate = current ? "vW" : "yW";
    once(`function ${name}(e,t=${host}){if(!e)return;let n=\`codex://threads/\${e}\`;${copy}(t===\`local\`?n:${decorate}(n,t))}`,
      `function ${name}(e,t=${host}){if(!e)return;let n=t===\`local\`?\`azrael://threads/\${e}\`:\`codex://threads/\${e}\`;${copy}(t===\`local\`?n:${decorate}(n,t))}`);
  } else if ([SESSION_LINK_ASSETS[2], SESSION_LINK_ASSETS[5]].includes(relativePath)) {
    const current = relativePath === SESSION_LINK_ASSETS[5];
    const literal = current ? "Mf" : "xu", parser = current ? "Yut" : "Xlt", classifier = current ? "tlt" : "cct", handoff = current ? "YIn" : "kPn", template = current ? "ZIn" : "jPn", markdown = current ? "Zre" : "tue";
    once(`host:${literal}(\`threads\`),protocol:${literal}(\`codex:\`)`, `host:${literal}(\`threads\`),protocol:${literal}(\`azrael:\`)`);
    once('if(n.protocol!==`codex:`||n.host!==`threads`)return null;',
      'if((n.protocol!==`azrael:`&&!(n.protocol===`codex:`&&n.searchParams.has(`hostId`)&&n.searchParams.get(`hostId`)!==`local`&&n.searchParams.get(`hostId`)!==``))||n.host!==`threads`||n.username!==``||n.password!==``||n.port!==``||(n.protocol===`azrael:`&&((n.searchParams.has(`hostId`)&&n.searchParams.get(`hostId`)!==`local`)||n.searchParams.has(`threadAccess`))))return null;');
    once('host:n.host,protocol:n.protocol,reviewPath:', 'host:n.host,protocol:n.protocol===`codex:`?`azrael:`:n.protocol,reviewPath:');
    // Keep upstream non-thread protocols and page artifact surfaces. Ordinary
    // local thread navigation only accepts the new scheme, with no fallback.
    once('return t==null||t.protocol!==`codex:`&&t.protocol!==`codex-dev:`?null:',
      'return t==null||(t.protocol!==`azrael:`&&t.protocol!==`codex:`&&t.protocol!==`codex-dev:`)||(t.protocol===`azrael:`&&'+parser+'(t)==null)||(t.host===`threads`&&t.protocol!==`azrael:`&&!(t.searchParams.has(`hostId`)&&t.searchParams.get(`hostId`)!==`local`)&&![`artifact`,`artifactTask`,`ephemeral`].some(e=>t.searchParams.has(e)))?null:');
    once(`function ${handoff}(e,t){return e.replaceAll(${template},\`codex://threads/\${t}\`)}`,
      `function ${handoff}(e,t){return e.replaceAll(${template},\`azrael://threads/\${t}\`)}`);
    once('e.startsWith(`codex://`)&&!0', `(e.startsWith(\`codex://\`)||e.startsWith(\`azrael://\`))&&${classifier}(e)!=null`);
    once('start(e){return e.search(/\\bcodex:\\/\\//i)},tokenizer(e){let t=this.lexer.options.tokenizer;if(!/^codex:\\/\\//i.test(e)',
      'start(e){return e.search(/\\b(?:azrael|codex):\\/\\//i)},tokenizer(e){let t=this.lexer.options.tokenizer;if(!/^(?:azrael|codex):\\/\\//i.test(e)');
    once('let n='+markdown+'.prototype.url.call(t,`https://${e.slice(8)}`);if(n==null)return;let r=e.slice(0,n.raw.length);',
      'let a=/^azrael:\\/\\//i.test(e)?1:0,n='+markdown+'.prototype.url.call(t,`https://${e.slice(8+a)}`);if(n==null)return;let r=e.slice(0,n.raw.length+a);');
    if (current) {
      const review = "codex://threads/<threadId>?view=review";
      if (text.split(review).length !== 3) throw new Error("Pinned review-link description anchor drift");
      text = text.replaceAll(review, "azrael://threads/<threadId>?view=review");
      count += 2;
    }
  } else {
    once('s=`codex://threads/${a}`,c;', 's=`azrael://threads/${a}`,c;');
  }
  return { text: `${MARKER}${text}`, count };
}
module.exports = { SESSION_LINK_ASSETS, MARKER, injectSessionLinks };
