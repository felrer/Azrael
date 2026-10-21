'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// Explicit output ownership is required. No child session, window, or real input is created.
test('Windows x64 native viewer preflight and confirmed release accounting', {
  skip: process.platform !== 'win32' || !process.env.AZRAEL_CHILD_VIEWER_TEST_ROOT,
}, () => {
  const root = path.resolve(process.env.AZRAEL_CHILD_VIEWER_TEST_ROOT);
  const attempt = process.env.AZRAEL_CHILD_VIEWER_TEST_ATTEMPT || '';
  assert.match(attempt, /^[a-zA-Z0-9_-]*$/, 'Attempt is a single owned directory name');
  const temporary = path.join(root, 'temporary/native', attempt);
  const logs = path.join(root, 'logs/native', attempt);
  fs.mkdirSync(temporary, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });
  const source = path.resolve(__dirname, '../native/windows-child-session/ChildSession.cs');
  const frozen = path.join(temporary, 'ChildSession.cs');
  const fixture = path.join(temporary, 'ViewerSafetyTests.cs');
  const binary = path.join(temporary, 'viewer-safety-tests.exe');
  const helper = path.join(temporary, 'child-session-test.exe');
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  fs.copyFileSync(source, frozen, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(fixture, String.raw`
using System;
using System.Collections.Generic;
partial class ChildSession {
 static void Check(bool value,string label) { if(!value)throw new Exception(label); }
 public static void RunViewerSafetyTests() {
  int checks=0;
  foreach(string operation in new[]{"launch","capture","input"}) {
   var blocked=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(ViewerPreflight(operation,false,()=>{ checks++; return true; })));
   Check(Text(blocked,"code")=="isolated_viewer_minimized","minimized code");
   Check(Text(blocked,"actionExecuted")=="False"&&Text(blocked,"mutationOutcome")=="not_executed","no delivery proof");
   Check(Text(blocked,"viewerState")=="minimized"&&Text(blocked,"requiredUserAction")=="restore_isolated_viewer","restore guidance");
   Check(ViewerPreflight(operation,false,()=>false)==null,"restored viewer proceeds");
   Check(ViewerPreflight(operation,true,()=>{ throw new Exception("Recovered mode has no active viewer"); })==null,"recovered viewer absent");
  }
  Check(checks==3,"all viewer-sensitive operations checked");
  foreach(string operation in new[]{"status","releaseInput","prepareStop","stop"})
   Check(ViewerPreflight(operation,false,()=>{ throw new Exception("Recovery operation must bypass minimize check"); })==null,"recovery operation available");
  HeldKeys.Add(30); HeldKeys.Add(0x1001D); HeldUnicode.Add(0x3042); HeldMouse=4|16|64;
  int sends=0;
  Check(!ReleaseHeld(items=>{ sends++; Check(items.Length==1,"individual release confirmation"); return sends==1?1u:0u; }),"partial release rejected");
  Check(HeldKeys.Count==1&&HeldUnicode.Count==1&&HeldMouse==(4|16|64),"only confirmed key retired");
  Check(!ReleaseHeld(items=>{ throw new Exception("fixture sender failed"); }),"release throw is unconfirmed");
  Check(HeldKeys.Count==1&&HeldUnicode.Count==1&&HeldMouse==(4|16|64),"exception preserves tracking");
  var flags=new HashSet<uint>();
  Check(ReleaseHeld(items=>{ flags.Add(items[0].type==1?items[0].data.keyboard.flags:items[0].data.mouse.flags); return 1; }),"confirmed releases succeed");
  Check(!HasHeldInput()&&flags.Contains(6)&&flags.Contains(4)&&flags.Contains(16)&&flags.Contains(64),"unicode and every mouse button released");
  Check(ReleaseHeld(items=>{ throw new Exception("Empty release must not send"); }),"empty release succeeds without delivery");
  var textPackets=new List<Native.Input>();
  foreach(char unit in "AB") { var down=new Native.Input(); down.type=1; down.data.keyboard.scan=unit; down.data.keyboard.flags=4; textPackets.Add(down); var up=down; up.data.keyboard.flags=6; textPackets.Add(up); }
  foreach(uint sent in new[]{0u,1u,2u,3u,4u}) {
   HeldUnicode.Add('A'); HeldUnicode.Add('B'); var attempt=new InputAttempt{deliveryAttempted=true,outcome="unknown"};
   RecordTextDelivery(textPackets,sent,attempt);
   Check(HeldUnicode.Count==(sent%2==1?1:0),"only an unmatched Unicode press requires release");
   if(sent%2==1)Check(HeldUnicode.Contains(sent==1?'A':'B'),"partial prefix retains the exact pending UTF-16 unit");
   Check(attempt.outcome==(sent==0?"not_executed":sent==4?"executed":"partial"),"text delivery count establishes outcome");
   Check(ReleaseHeld(items=>1),"partial text release confirmed");
  }
  var released=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(Handle(new Dictionary<string,object>{{"operation","releaseInput"}})));
  Check(Text(released,"ok")=="True"&&Text(released,"inputReleased")=="True"&&Text(released,"heldInput")=="False","release response proof");
  platformAdmitted=false;
  var rejected=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(Handle(new Dictionary<string,object>{{"operation","input"}})));
  Check(Text(rejected,"code")=="native_child_input_precondition"&&Text(rejected,"actionExecuted")=="False"&&Text(rejected,"inputReleaseConfirmed")=="True","actual pre-input rejection and release proof");
  foreach(string outcome in new[]{"partial","unknown"}) {
   var failed=(Dictionary<string,object>)InputFailure(new Exception("fixture"),new InputAttempt{deliveryAttempted=true,outcome=outcome},false);
   Check(Text(failed,"mutationOutcome")==outcome&&!failed.ContainsKey("actionExecuted"),"uncertain mutation cannot claim no execution");
   Check(Text(failed,"inputReleaseConfirmed")=="False","release failure retained");
  }
  Console.WriteLine("PASS native viewer preflight, recovery bypass, release accounting, input failure protocol; no live session or native input");
 }
}
class NativeSafetyTests {
 static int Main() { try { ChildSession.RunViewerSafetyTests(); return 0; } catch(Exception e) { Console.Error.WriteLine(e); return 1; } }
}
`, { flag: 'wx' });
  const pinned = hash(frozen);
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const common = ['/nologo', '/target:exe', '/platform:x64', '/optimize+',
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    '/reference:System.Web.Extensions.dll', '/reference:System.ServiceProcess.dll', '/reference:Microsoft.CSharp.dll'];
  const compile = spawnSync(compiler, [...common, `/out:${helper}`, frozen], { encoding: 'utf8' });
  fs.writeFileSync(path.join(logs, 'compile.log'), `${compile.stdout || ''}${compile.stderr || ''}\nexit=${compile.status}\n`, { flag: 'wx' });
  assert.equal(compile.status, 0, 'Product helper preparation: inspect logs/native/compile.log');
  const built = spawnSync(compiler, [...common, '/main:NativeSafetyTests', `/out:${binary}`, frozen, fixture], { encoding: 'utf8' });
  const run = built.status === 0 ? spawnSync(binary, [], { encoding: 'utf8' }) : null;
  fs.writeFileSync(path.join(logs, 'viewer-safety-tests.log'),
    `compile=${built.status}\n${built.stdout || ''}${built.stderr || ''}\nrun=${run?.status}\n${run?.stdout || ''}${run?.stderr || ''}`, { flag: 'wx' });
  assert.equal(built.status, 0, 'Fixture preparation: inspect logs/native/viewer-safety-tests.log');
  assert.equal(run.status, 0, 'Native method checks: inspect logs/native/viewer-safety-tests.log');
  assert.equal(hash(frozen), pinned, 'Frozen compile input unchanged');
  assert.equal(hash(source), pinned, 'Assigned native source unchanged during validation');
});
