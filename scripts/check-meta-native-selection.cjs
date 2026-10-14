'use strict';
// Compile the actual small native selection boundary without compiling the full
// engine. Core catalog JSON tests and packaged engine acceptance remain separate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sourceRoot = process.argv[2] || path.join(root, 'engine');
const source = fs.readFileSync(path.join(sourceRoot, 'codex-rs/core/src/managed_catalog.rs'), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^(?:pub\\(crate\\) )?fn ${name}\\(`, 'm'));
  assert(start >= 0, `Missing native declaration ${name}`);
  const next = source.indexOf('\n}', start);
  assert(next >= 0, `Missing native declaration terminator ${name}`);
  return source.slice(start, next + 2);
}
const verification = path.join(root, 'artifacts/verification');
fs.mkdirSync(verification, { recursive: true });
const fixture = fs.mkdtempSync(path.join(verification, 'meta-native-selection-'));
assert(path.dirname(fixture) === verification && !fs.lstatSync(fixture).isSymbolicLink());
const binary = path.join(fixture, process.platform === 'win32' ? 'selection-tests.exe' : 'selection-tests');
const input = path.join(fixture, 'selection.rs');
fs.writeFileSync(input, `use std::borrow::Cow;
type Result<T> = std::result::Result<T,String>;
macro_rules! anyhow { ($message:literal) => { $message.to_string() }; }
trait Context<T> { fn context(self,message:&str)->Result<T>; }
impl<T> Context<T> for Option<T> { fn context(self,message:&str)->Result<T> { self.ok_or_else(||message.to_string()) } }
${declaration('known_managed_provider')}
${declaration('supports_client_tool_search')}
${declaration('valid_api_id')}
${declaration('selection')}
#[test] fn meta_native_selection_and_shared_provider_admission() {
 for provider in ["google","google-antigravity","xai","openrouter","anthropic","meta-muse"] {
  assert!(known_managed_provider(provider));
  let key=format!("managed/{provider}/vendor/model:opaque");
  assert_eq!(selection(&key).unwrap(),(Cow::Borrowed(provider),"vendor/model:opaque"));
 }
 for key in ["managed/meta/unknown","managed/meta-muse/","managed/meta-muse/ ","managed/meta-muse/model\\n","invalid"] { assert!(selection(key).is_err()); }
 assert!(!known_managed_provider("Meta-Muse"));
 assert!(selection(&format!("managed/meta-muse/{}","x".repeat(257))).is_err());
 let api=format!("api/{}/vendor/model","a".repeat(32));
 assert_eq!(selection(&api).unwrap().0,format!("api-{}","a".repeat(32)));
 assert!(selection("api/short/model").is_err());
 assert!(supports_client_tool_search("meta-muse",None));
 assert!(supports_client_tool_search("api-fixture",Some(true)));
 assert!(!supports_client_tool_search("api-fixture",Some(false)));
 assert!(!supports_client_tool_search("api-fixture",None));
 assert!(!supports_client_tool_search("anthropic",None));
}
`);
try {
  for (const [command, args] of [['rustc', ['--edition=2024', '--test', input, '-o', binary]], [binary, ['--test-threads=1']]]) {
    const result = spawnSync(command, args, { cwd: sourceRoot, windowsHide: true, stdio: 'inherit', timeout: 120000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Native selection check failed');
  }
} finally {
  // All owned producers have ended. Delete only this freshly allocated fixture.
  if (process.platform === 'win32') {
    const cleaned = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:AZRAEL_META_FIXTURE -Recurse'], { windowsHide: true, env: { ...process.env, AZRAEL_META_FIXTURE: fixture }, stdio: 'inherit' });
    assert.equal(cleaned.status, 0, 'Native selection fixture cleanup failed');
  } else fs.rmSync(fixture, { recursive: true });
  assert(!fs.existsSync(fixture), 'Native selection fixture remains');
}
