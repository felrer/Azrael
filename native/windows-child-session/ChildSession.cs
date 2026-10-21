// Windows-only source backend. Compilation is preparation, not admission evidence.
// Protocol: newline JSON on stdin/stdout. Elevation is confined to bounded setup/recovery modes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

partial class ChildSession {
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
 static readonly string Sid = WindowsIdentity.GetCurrent().User.Value;
 static readonly int Session = Process.GetCurrentProcess().SessionId;
 static readonly string Profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
 static string Exe { get { return Assembly.GetExecutingAssembly().Location; } }
 static string Hash(string file) { using(var sha=SHA256.Create()) using(var stream=File.OpenRead(file)) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
 static string HashText(string value) { using(var sha=SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant(); }
 static string Text(Dictionary<string,object> value,string key) { object item; return value.TryGetValue(key,out item) ? Convert.ToString(item) : ""; }
 static int Number(Dictionary<string,object> value,string key) { return Convert.ToInt32(value[key]); }
 static Dictionary<string,object> Read(StreamReader reader,int timeout=10000) {
  string line;
  if(timeout==0) line=reader.ReadLine();
  else { var task=Task.Run(()=>reader.ReadLine()); Guard(task.Wait(timeout),"Child transport response timed out"); line=task.Result; }
  if(line==null || line.Length>16*1024*1024) throw new IOException("Transport closed or oversized response"); return Json.Deserialize<Dictionary<string,object>>(line);
 }
 static void Write(StreamWriter writer,object value) { writer.WriteLine(Json.Serialize(value)); writer.Flush(); }
 sealed class RecoveryError : InvalidOperationException { internal readonly string Code; internal RecoveryError(string code,string message):base(message) { Code=code; } }
 static object Failure(Exception e) { return new { ok=false, code=e is RecoveryError?((RecoveryError)e).Code:"native_child_error", message=e.Message, hresult=e.HResult,mutationOutcome="unknown" }; }
 static void RecoveryGuard(bool value,string code,string reason) { if(!value)throw new RecoveryError(code,reason); }
 static void Guard(bool value,string reason) { if(!value) throw new InvalidOperationException(reason); }
 static string RandomSecret() { var b=new byte[32]; using(var r=RandomNumberGenerator.Create()) r.GetBytes(b); return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant(); }
 static bool SameSecret(string a,string b) { if(a.Length!=b.Length)return false; int difference=0; for(int i=0;i<a.Length;i++)difference|=a[i]^b[i]; return difference==0; }

 [STAThread] static int Main(string[] args) {
  Console.InputEncoding=Encoding.UTF8; Console.OutputEncoding=new UTF8Encoding(false);
  try {
   if(args.Length==1&&args[0]=="--self-test") {
    Guard(Marshal.SizeOf(typeof(Native.Input))==(IntPtr.Size==8?40:28),"INPUT ABI size mismatch");
    Guard(SameSecret("abc","abc")&&!SameSecret("abc","abd")&&!SameSecret("abc","abcd"),"Secret comparison failure");
    BootstrapJournal.SelfTest(); MachineSetup.SelfTest(); Recovery.SelfTest(); ClosureSelfTest(); Host.ReconnectSelfTest();
    var admissionGates=new Dictionary<string,object>(); foreach(string name in new[]{"connection","render","keyboard","mouse","parentIdentity","dataProfile"})admissionGates[name]=Gate(true,"fixture");
    Guard(AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Complete admission gates rejected");
    admissionGates["keyboard"]=Gate(false,"fixture"); Guard(!AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Failed keyboard gate accepted");
    admissionGates["keyboard"]=new { passed="true" }; Guard(!AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Unknown keyboard evidence accepted");
    Console.WriteLine(Json.Serialize(new { ok=true, inputBytes=Marshal.SizeOf(typeof(Native.Input)), bootstrapJournalFixtureChecks=14,bootstrapLaunchFixtureChecks=10,machineSetupFixtureChecks=17,recoveryFixtureChecks=12,reconnectFixtureChecks=25,admissionGateFixtureChecks=3,closureIdentityFixtureChecks=11,sessionAnchorRead=ProbeCurrentSessionAnchorWmi(),connected=false, configurationWritten=false })); return 0;
   }
   if(args.Length>0&&args[0]=="--prepare-machine") return MachineSetup.Prepare(args);
   if(args.Length>0&&args[0]=="--recover-child") return Recovery.Elevated(args);
   if(args.Length==1&&(args[0]=="--inspect-closure"||args[0]=="--logoff-child")) {
    var request=ReadBoundedIdentityRequest();
    Guard(Text(request,"helperSha256")==Hash(Exe),"Trusted helper content hash mismatch");
    var identity=request["identity"] as Dictionary<string,object>;
    ValidateClosureIdentity(identity);
    if(args[0]=="--logoff-child") {
     Guard(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Explicit child logoff requires administrator token");
     ValidateLiveClosureIdentity(identity);
     ValidateLiveClosureIdentity(identity);
     Guard(Native.WTSLogoffSession(IntPtr.Zero,(uint)Number(identity,"childSessionId"),true),"Explicit child logoff failed");
    }
    Console.WriteLine(Json.Serialize(InspectClosure(identity))); return 0;
   }
   Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
   Guard(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Ordinary user token required");
   if(args.Length==1&&args[0]=="--request-machine-setup") { var result=MachineSetup.Request(); Console.WriteLine(Json.Serialize(result)); return Convert.ToBoolean(result["ok"])?0:1; }
   if(args.Length==1&&args[0]=="--reconcile-bootstrap") {
    var request=Read(new StreamReader(Console.OpenStandardInput(),Encoding.UTF8),0);
    Guard(Text(request,"helperSha256")==Hash(Exe),"Trusted helper content hash mismatch");
    Console.WriteLine(Json.Serialize(BootstrapJournal.Reconcile(Text(request,"bootstrapJournalPath")))); return 0;
   }
   if(args.Length==2 && args[0]=="--bootstrap") return BootstrapJournal.StartWorker(args[1]);
   if(args.Length==5 && args[0]=="--worker") return Worker(args[1],args[2],Int32.Parse(args[3]),args[4]);
   Guard(args.Length==0,"Unsupported native arguments");
   Application.EnableVisualStyles();
   using(var host=new Host()) Application.Run(host);
   return 0;
  } catch(Exception e) { Console.WriteLine(Json.Serialize(Failure(e))); return 1; }
 }

 // A returned child ID can outlive its session. Only a successful enumeration proves it stale.
 static bool ChildAbsent(bool found,uint id,int error) {
  if(!found)return error==1168;
  if(id==UInt32.MaxValue)return true;
  IntPtr buffer=IntPtr.Zero; int count;
  if(!Native.WTSEnumerateSessions(IntPtr.Zero,0,1,out buffer,out count))return false;
  try {
   Guard(count>=0&&count<=65536&&(count==0||buffer!=IntPtr.Zero),"Invalid WTS session count");
   for(int i=0;i<count;i++)if(((Native.WtsSession)Marshal.PtrToStructure(IntPtr.Add(buffer,i*Marshal.SizeOf(typeof(Native.WtsSession))),typeof(Native.WtsSession))).id==id)return false;
   return true;
  } finally { if(buffer!=IntPtr.Zero)Native.WTSFreeMemory(buffer); }
 }

 static readonly string[] ClosureIdentityKeys={"sid","profile","parentSessionId","childSessionId","workerPid","workerCreated","sessionAnchorPid","sessionAnchorCreated"};
 static Dictionary<string,object> ReadBoundedIdentityRequest() {
  var reader=new StreamReader(Console.OpenStandardInput(),Encoding.UTF8); var line=new StringBuilder(); int c;
  while((c=reader.Read())!=-1&&c!='\n') { Guard(line.Length<8192,"Closure request exceeded bounded payload"); line.Append((char)c); }
  Guard(line.Length>0,"Closure request required"); return Json.Deserialize<Dictionary<string,object>>(line.ToString());
 }
 static void ValidateClosureIdentity(Dictionary<string,object> value) {
  Guard(value!=null&&value.Count==ClosureIdentityKeys.Length&&ClosureIdentityKeys.All(key=>value.ContainsKey(key)),"Complete original session identity required");
  Guard(Text(value,"sid")==Sid&&Text(value,"profile")==Profile&&Number(value,"parentSessionId")==Session,"Closure parent identity mismatch");
  Guard(Number(value,"childSessionId")>0&&Number(value,"childSessionId")!=Session&&Number(value,"workerPid")>0&&Number(value,"sessionAnchorPid")>0&&Number(value,"workerPid")!=Number(value,"sessionAnchorPid"),"Invalid closure process/session identity");
  long ticks; Guard(Int64.TryParse(Text(value,"workerCreated"),out ticks)&&ticks>0&&Int64.TryParse(Text(value,"sessionAnchorCreated"),out ticks)&&ticks>0,"Original process creation proof required");
 }
 static string ProcessCreated(Process process) {
  IntPtr handle=Native.OpenProcess(0x1000,false,(uint)process.Id); Guard(handle!=IntPtr.Zero,"Process creation proof unavailable");
  try { long created,exited,kernel,user; Guard(Native.GetProcessTimes(handle,out created,out exited,out kernel,out user),"Process creation query failed"); return DateTime.FromFileTimeUtc(created).Ticks.ToString(); }
  finally { Native.CloseHandle(handle); }
 }
 static string AnchorCreated(Process process) {
  object locator=null,services=null,results=null; string phase="locator";
  try {
   locator=Activator.CreateInstance(Type.GetTypeFromProgID("WbemScripting.SWbemLocator",true));
   phase="connect"; services=((dynamic)locator).ConnectServer(".","root\\cimv2");
   phase="query";
   results=((dynamic)services).Get("Win32_Process.Handle=\""+process.Id+"\"");
   dynamic item=results;
    phase="identity";
    Guard(Convert.ToInt32(item.ProcessId)==process.Id&&Convert.ToInt32(item.SessionId)==process.SessionId&&String.Equals(Convert.ToString(item.Name),"winlogon.exe",StringComparison.OrdinalIgnoreCase),"WMI session anchor identity mismatch");
    phase="creation"; string value=Convert.ToString(item.CreationDate);
    Guard(value!=null&&value.Length==25&&value[14]=='.'&&(value[21]=='+'||value[21]=='-')&&value.Where((c,i)=>i!=14&&i!=21).All(c=>c>='0'&&c<='9'),"WMI anchor creation date unavailable");
    var date=DateTime.ParseExact(value.Substring(0,14),"yyyyMMddHHmmss",System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None);
    int minutes=Int32.Parse(value.Substring(22,3),System.Globalization.CultureInfo.InvariantCulture)*(value[21]=='-'?-1:1);
    string created=new DateTimeOffset(DateTime.SpecifyKind(date,DateTimeKind.Unspecified),TimeSpan.FromMinutes(minutes)).UtcDateTime.AddTicks(Int64.Parse(value.Substring(15,6),System.Globalization.CultureInfo.InvariantCulture)*10).Ticks.ToString();
   Guard(!String.IsNullOrEmpty(created),"WMI session anchor unavailable"); return created;
  } catch(Exception e) { throw new InvalidOperationException("WMI anchor "+phase+" query failed: "+e.Message,e); } finally {
   foreach(object item in new[]{results,services,locator})if(item!=null&&Marshal.IsComObject(item))Marshal.ReleaseComObject(item);
  }
 }
 static object ProbeCurrentSessionAnchorWmi() {
  int pid=-1; string created=null;
  try {
   Guard(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Ordinary token required for WMI anchor evidence");
   foreach(var candidate in Process.GetProcessesByName("winlogon"))using(candidate) {
    if(candidate.SessionId!=Session)continue;
    Guard(pid==-1,"Ambiguous current-session anchor"); pid=candidate.Id; created=AnchorCreated(candidate);
    Guard(created==AnchorCreated(candidate),"WMI anchor creation identity changed");
   }
   Guard(pid>0&&!String.IsNullOrEmpty(created),"Current-session anchor unavailable");
   return new { state="supported",ordinaryToken=true,sessionId=Session,sessionAnchorPid=pid,sessionAnchorCreated=created,precision="microsecond",repeatMatches=true };
  } catch(Exception e) { return new { state="not_accessible",sessionId=Session,sessionAnchorPid=pid,hresult=e.HResult,reason=e.Message }; }
 }
 static void RequireProcessAbsent(int pid) {
  // A reused PID is ambiguous evidence; preserve the files even if its creation time differs.
  Process process; try { process=Process.GetProcessById(pid); } catch(ArgumentException) { return; }
  using(process) { Guard(false,"Original process PID remains present or was reused"); }
 }
 static object InspectClosure(Dictionary<string,object> value) {
  ValidateClosureIdentity(value);
  RequireProcessAbsent(Number(value,"workerPid")); RequireProcessAbsent(Number(value,"sessionAnchorPid"));
  IntPtr buffer=IntPtr.Zero; int count;
  Guard(Native.WTSEnumerateSessions(IntPtr.Zero,0,1,out buffer,out count),"Closure WTS inventory unavailable");
  try {
   Guard(count>=0&&count<=65536&&(count==0||buffer!=IntPtr.Zero),"Invalid closure WTS inventory");
   for(int i=0;i<count;i++)Guard(((Native.WtsSession)Marshal.PtrToStructure(IntPtr.Add(buffer,i*Marshal.SizeOf(typeof(Native.WtsSession))),typeof(Native.WtsSession))).id!=(uint)Number(value,"childSessionId"),"Original session ID remains live or was reused");
  } finally { if(buffer!=IntPtr.Zero)Native.WTSFreeMemory(buffer); }
  uint current; bool found=Native.WTSGetChildSessionId(out current); int error=Marshal.GetLastWin32Error();
  Guard((!found&&error==1168)||(found&&(current==UInt32.MaxValue||current==(uint)Number(value,"childSessionId"))&&ChildAbsent(found,current,error)),"No-child result unavailable or a different child exists");
  RequireProcessAbsent(Number(value,"workerPid")); RequireProcessAbsent(Number(value,"sessionAnchorPid"));
  return new { ok=true,state="closed",identity=value,ownershipVerified=true,processesStopped=true,logoffConfirmed=true,
   pendingWork=false,directUser=false,unsavedWork=false,unknownState=false,unrelatedApps=false,pendingUserDecision=false,heldInput=false };
 }
 static void ValidateLiveClosureIdentity(Dictionary<string,object> value) {
  ValidateClosureIdentity(value);
  using(var worker=Process.GetProcessById(Number(value,"workerPid"))) {
   Guard(worker.SessionId==Number(value,"childSessionId")&&ProcessCreated(worker)==Text(value,"workerCreated")&&!worker.HasExited,"Original worker changed");
   Guard(String.Equals(worker.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase)&&Hash(worker.MainModule.FileName)==Hash(Exe),"Worker executable changed");
  }
  using(var anchor=Process.GetProcessById(Number(value,"sessionAnchorPid")))Guard(anchor.ProcessName=="winlogon"&&anchor.SessionId==Number(value,"childSessionId")&&AnchorCreated(anchor)==Text(value,"sessionAnchorCreated"),"Original session anchor changed");
  uint current; Guard(Native.WTSGetChildSessionId(out current)&&current==(uint)Number(value,"childSessionId"),"Original child session changed");
 }
 static void ClosureSelfTest() {
  var value=new Dictionary<string,object> { {"sid",Sid},{"profile",Profile},{"parentSessionId",Session},{"childSessionId",Session+1},{"workerPid",123},{"workerCreated","1234"},{"sessionAnchorPid",124},{"sessionAnchorCreated","1235"} };
  ValidateClosureIdentity(value);
  foreach(string key in ClosureIdentityKeys) { var missing=new Dictionary<string,object>(value); missing.Remove(key); bool rejected=false; try { ValidateClosureIdentity(missing); } catch { rejected=true; } Guard(rejected,"Incomplete closure identity accepted"); }
  var foreign=new Dictionary<string,object>(value); foreign["parentSessionId"]=Session+1;
  bool mismatch=false; try { ValidateClosureIdentity(foreign); } catch { mismatch=true; } Guard(mismatch,"Foreign closure parent accepted");
  bool live=false; try { RequireProcessAbsent(Process.GetCurrentProcess().Id); } catch { live=true; } Guard(live,"Live process accepted as stopped");
 }

 static class MachineSetup {
  static string Root { get { string local=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); Guard(!String.IsNullOrWhiteSpace(local)&&Path.IsPathRooted(local),"Local application data directory unavailable"); return Path.Combine(local,"Azrael","WindowUse","machine-setup"); } }
  static bool Hex(string value,int length) { return value!=null&&value.Length==length&&value.All(c=>"0123456789abcdef".IndexOf(c)>=0); }
  static void ValidatePath(string file,string root) {
   Guard(!String.IsNullOrWhiteSpace(file)&&Path.IsPathRooted(file)&&file==Path.GetFullPath(file),"Canonical machine setup receipt path required");
   var directory=Path.GetDirectoryName(file);
   Guard(Path.GetFileName(file)=="receipt.json"&&Hex(Path.GetFileName(directory),32)&&String.Equals(Path.GetDirectoryName(directory),Path.GetFullPath(root),StringComparison.OrdinalIgnoreCase),"Machine setup receipt must use its fixed private hierarchy");
  }
  static void ValidateIdentity(string nonce,string expectedSid,int expectedSession) {
   Guard(Hex(nonce,64),"Invalid machine setup nonce");
   Guard(expectedSid==Sid&&expectedSession==Session,"Machine setup requires the same signed-in user and parent session");
  }
  internal static void InspectDirectory(string file) {
   ValidatePath(file,Root);
   var directory=new DirectoryInfo(Path.GetDirectoryName(file)); Guard(directory.Exists,"Machine setup directory missing");
   for(var current=directory;current!=null;current=current.Parent)Guard((current.Attributes&FileAttributes.ReparsePoint)==0,"Machine setup path cannot contain reparse points");
   var security=directory.GetAccessControl();
   Guard(security.GetOwner(typeof(SecurityIdentifier)).Value==Sid&&security.AreAccessRulesProtected,"Machine setup directory must be private and user-owned");
   Guard(security.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().All(rule=>rule.IdentityReference.Value==Sid),"Machine setup directory includes another principal");
  }
  internal static void InspectExistingAncestors(string directory) {
   for(var current=new DirectoryInfo(directory);current!=null;current=current.Parent)if(current.Exists)Guard((current.Attributes&FileAttributes.ReparsePoint)==0,"Machine setup ancestors cannot contain reparse points");
  }
  static object State() {
   bool enabled; bool queried=Native.WTSIsChildSessionsEnabled(out enabled); int error=queried?0:Marshal.GetLastWin32Error();
   using(var service=new ServiceController("TermService"))return new { enabledQuerySucceeded=queried,enabled=queried?(object)enabled:null,enabledError=error,serviceStatus=service.Status.ToString() };
  }
  static bool Ready(object state) { var value=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(state)); return Text(value,"enabledQuerySucceeded")=="True"&&Text(value,"enabled")=="True"&&Text(value,"serviceStatus")=="Running"; }
  static Dictionary<string,object> Result(bool ok,string code,string message,string nonce,object before,object after) {
   return new Dictionary<string,object> { {"ok",ok},{"code",code},{"message",message},{"nonce",nonce},{"sid",Sid},{"parentSessionId",Session},{"before",before},{"after",after} };
  }
  internal static int Prepare(string[] args) {
   // This branch never enters the session host or worker, even after an error.
   try {
    Guard(args.Length==5,"Invalid machine setup arguments"); int expectedSession; Guard(Int32.TryParse(args[4],out expectedSession),"Invalid parent session");
    ValidateIdentity(args[2],args[3],expectedSession); InspectDirectory(args[1]);
    Guard(!File.Exists(args[1])&&!Directory.Exists(args[1]),"Machine setup receipt already exists");
    Guard(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Machine preparation requires an elevated token");
    object before=null,after=null; Dictionary<string,object> result;
    try {
     before=State(); var state=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(before));
     Guard(Text(state,"enabledQuerySucceeded")=="True","Child enablement query failed");
     if(Text(state,"enabled")!="True")Guard(Native.WTSEnableChildSessions(true),"Child session enablement failed: "+Marshal.GetLastWin32Error());
     using(var service=new ServiceController("TermService")) {
      if(service.Status==ServiceControllerStatus.Stopped)service.Start();
      service.Refresh();
      if(service.Status==ServiceControllerStatus.StartPending)service.WaitForStatus(ServiceControllerStatus.Running,TimeSpan.FromSeconds(20));
     }
     after=State(); bool ok=Ready(after); result=Result(ok,ok?"child_setup_ready":"child_setup_failed",ok?"Machine preparation verified":"Machine preparation prerequisites remain unavailable",args[2],before,after);
    } catch(Exception e) {
     try { after=State(); } catch { }
     result=Result(false,"child_setup_failed",e.Message,args[2],before,after);
    }
    InspectDirectory(args[1]); var bytes=new UTF8Encoding(false).GetBytes(Json.Serialize(result)); Guard(bytes.Length<=16384,"Machine setup receipt exceeds size limit");
    using(var stream=new FileStream(args[1],FileMode.CreateNew,FileAccess.Write,FileShare.None)) { stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
    return Convert.ToBoolean(result["ok"])?0:1;
   } catch { return 1; }
  }
  static void ValidateReceipt(Dictionary<string,object> result,string nonce) {
   Guard(SameSecret(Text(result,"nonce"),nonce)&&Text(result,"sid")==Sid&&Number(result,"parentSessionId")==Session,"Machine setup receipt identity mismatch");
   Guard(result.ContainsKey("ok")&&result["ok"] is bool&&Text(result,"code").StartsWith("child_setup_",StringComparison.Ordinal)&&Text(result,"message").Length<=8192,"Malformed machine setup receipt");
   if((bool)result["ok"])Guard(Text(result,"code")=="child_setup_ready"&&result.ContainsKey("after")&&Ready(result["after"]),"Machine setup receipt lacks verified readiness");
  }
  internal static Dictionary<string,object> Request() {
   string file=null; string nonce=RandomSecret(); bool launched=false,finished=false;
   try {
    // Query first: an already prepared machine needs no UAC request.
    var before=State(); if(Ready(before))return Result(true,"child_setup_ready","Machine prerequisites already verified",nonce,before,before);
    InspectExistingAncestors(Root); Directory.CreateDirectory(Root); InspectExistingAncestors(Root);
    string directory=Path.Combine(Root,Guid.NewGuid().ToString("N")); Guard(!Directory.Exists(directory)&&!File.Exists(directory),"Machine setup run identity collision");
    var access=new DirectorySecurity(); access.SetAccessRuleProtection(true,false); access.SetOwner(new SecurityIdentifier(Sid));
    access.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.CreateDirectory(directory,access); file=Path.Combine(directory,"receipt.json"); InspectDirectory(file);
    using(var process=Process.Start(new ProcessStartInfo(Exe) { UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden,Arguments="--prepare-machine \""+file+"\" "+nonce+" "+Sid+" "+Session })) {
     launched=true; Guard(process!=null,"Machine setup process identity unavailable");
     Guard(process.WaitForExit(30000),"Machine setup result timed out; elevated process may still be running"); finished=true;
     InspectDirectory(file); var info=new FileInfo(file);
     Guard(info.Exists&&(info.Attributes&FileAttributes.ReparsePoint)==0&&info.Length>0&&info.Length<=16384,"Machine setup receipt missing or unsafe");
     string receiptText;
     using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
      Guard(stream.Length>0&&stream.Length<=16384,"Machine setup receipt exceeds size limit");
      using(var reader=new StreamReader(stream,Encoding.UTF8))receiptText=reader.ReadToEnd();
     }
     var result=Json.Deserialize<Dictionary<string,object>>(receiptText); ValidateReceipt(result,nonce);
     Guard(process.ExitCode==((bool)result["ok"]?0:1),"Machine setup exit and receipt disagree");
     // Cleanup only the exact receipt and the now-empty owned run directory.
     File.Delete(file); Directory.Delete(directory,false); return result;
    }
   } catch(Exception e) {
    bool cancelled=e is System.ComponentModel.Win32Exception&&((System.ComponentModel.Win32Exception)e).NativeErrorCode==1223;
    var result=Result(false,cancelled?"child_setup_cancelled":"child_setup_unknown",e.Message,nonce,null,null);
    if(cancelled&&!launched&&file!=null) {
     try { InspectDirectory(file); Guard(!File.Exists(file),"Unexpected receipt after cancellation"); Directory.Delete(Path.GetDirectoryName(file),false); file=null; } catch { }
    }
    result["receiptPath"]=file; result["setupProcessExited"]=finished; result["cleanupUnconfirmed"]=file!=null; return result;
   }
  }
  internal static void SelfTest() {
   string root=Path.Combine(Path.GetTempPath(),"azrael-path-fixture"); string file=Path.Combine(root,new string('a',32),"receipt.json");
   ValidatePath(file,root); ValidateIdentity(new string('b',64),Sid,Session);
   foreach(string invalid in new[]{Path.Combine(root,"other","receipt.json"),Path.Combine(root,new string('a',32),"other.json"),Path.Combine(root,new string('a',32),"..",new string('a',32),"receipt.json"),Path.Combine(root+"-other",new string('a',32),"receipt.json")}) {
    bool rejected=false; try { ValidatePath(invalid,root); } catch { rejected=true; } Guard(rejected,"Unsafe machine setup path accepted");
   }
   foreach(string invalid in new[]{"",new string('b',63),new string('G',64),new string('b',65)}) { bool rejected=false; try { ValidateIdentity(invalid,Sid,Session); } catch { rejected=true; } Guard(rejected,"Invalid setup nonce accepted"); }
   bool identityRejected=false; try { ValidateIdentity(new string('b',64),Sid+"-other",Session); } catch { identityRejected=true; } Guard(identityRejected,"Alternate administrator identity accepted");
   bool sessionRejected=false; try { ValidateIdentity(new string('b',64),Sid,Session+1); } catch { sessionRejected=true; } Guard(sessionRejected,"Foreign parent session accepted");
   var receipt=Result(true,"child_setup_ready","fixture",new string('b',64),null,new { enabledQuerySucceeded=true,enabled=true,serviceStatus="Running" }); ValidateReceipt(receipt,new string('b',64));
   receipt["nonce"]=new string('c',64); bool forged=false; try { ValidateReceipt(receipt,new string('b',64)); } catch { forged=true; } Guard(forged,"Forged setup receipt nonce accepted");
   receipt["nonce"]=new string('b',64); receipt["after"]=new { enabledQuerySucceeded=false,enabled=true,serviceStatus="Running" }; bool unverified=false; try { ValidateReceipt(receipt,new string('b',64)); } catch { unverified=true; } Guard(unverified,"Unverified setup readiness accepted");
   receipt["ok"]=false; receipt["sid"]=Sid+"-other"; bool foreignSid=false; try { ValidateReceipt(receipt,new string('b',64)); } catch { foreignSid=true; } Guard(foreignSid,"Foreign setup receipt SID accepted");
   receipt["sid"]=Sid; receipt["parentSessionId"]=Session+1; bool foreignSession=false; try { ValidateReceipt(receipt,new string('b',64)); } catch { foreignSession=true; } Guard(foreignSession,"Foreign setup receipt session accepted");
  }
 }

 // Explicit, one-shot recovery broker. It cannot create or log off a session.
 static class Recovery {
  static string Root { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Azrael","WindowUse","child-recovery"); } }
  static bool Hex(string value,int length) { return value!=null&&value.Length==length&&value.All(c=>"0123456789abcdef".IndexOf(c)>=0); }
  static void ValidateTargetId(int target,int parent) { Guard(target>0&&target!=parent,"Recovery requires a positive, distinct child session"); }
  internal static void ValidateRequest(Dictionary<string,object> request) {
   Guid id; Guard(Text(request,"operation")=="recover"&&Guid.TryParseExact(Text(request,"recoveryRequestId"),"D",out id)&&id!=Guid.Empty,"Explicit recovery UUID required");
   ValidateTargetId(Number(request,"childSessionId"),Session);
   Guard(Hex(Text(request,"helperSha256"),64)&&!String.IsNullOrWhiteSpace(Text(request,"ownerId"))&&Text(request,"ownerId").Length<=256,"Invalid recovery helper or owner identity");
   if(request.ContainsKey("automaticRecovery"))Guard(request["automaticRecovery"] is bool,"Invalid automatic recovery flag");
   if(request.ContainsKey("expectedIdentity"))ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,Number(request,"childSessionId"),false);
  }
  internal static void ValidateExpected(Dictionary<string,object> identity,int target,bool live) {
   try {
    ValidateClosureIdentity(identity);
    Guard(Number(identity,"childSessionId")==target,"Recovery target mismatch");
    if(live) {
     uint current; Guard(Native.WTSGetChildSessionId(out current)&&current==(uint)target,"Recovery child changed");
     using(var anchor=Process.GetProcessById(Number(identity,"sessionAnchorPid")))Guard(anchor.ProcessName=="winlogon"&&anchor.SessionId==target&&AnchorCreated(anchor)==Text(identity,"sessionAnchorCreated"),"Recovery anchor changed");
    }
   } catch { throw new RecoveryError("child_identity_mismatch","Original child session identity no longer matches"); }
  }
  static string QueryText(int session,int kind) {
   IntPtr buffer; int bytes; Guard(Native.WTSQuerySessionInformation(IntPtr.Zero,session,kind,out buffer,out bytes),"Recovery WTS user query failed");
   try { Guard(bytes>=2&&bytes<=65536&&buffer!=IntPtr.Zero,"Invalid WTS user information"); return Marshal.PtrToStringUni(buffer); }
   finally { if(buffer!=IntPtr.Zero)Native.WTSFreeMemory(buffer); }
  }
  internal static void ValidateTarget(int target,bool rejectHelper) {
   try { ValidateTargetCore(target,rejectHelper); }
   catch(RecoveryError) { throw; }
   catch { throw new RecoveryError("child_recovery_blocked","Recovery child inventory or identity could not be verified"); }
  }
  static void ValidateTargetCore(int target,bool rejectHelper) {
   ValidateTargetId(target,Session); uint current; RecoveryGuard(Native.WTSGetChildSessionId(out current)&&current==(uint)target&&!ChildAbsent(true,current,0),"child_identity_mismatch","Exact recovery child is no longer present");
   string user=QueryText(target,5),domain=QueryText(target,7); Guard(!String.IsNullOrWhiteSpace(user),"Recovery child has no signed-in user");
   var account=new NTAccount(String.IsNullOrEmpty(domain)?user:domain+"\\"+user);
   RecoveryGuard(((SecurityIdentifier)account.Translate(typeof(SecurityIdentifier))).Value==Sid,"child_identity_mismatch","Recovery child belongs to another user");
   using(var key=Registry.LocalMachine.OpenSubKey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList\\"+Sid)) {
    RecoveryGuard(key!=null&&String.Equals(Environment.ExpandEnvironmentVariables(Convert.ToString(key.GetValue("ProfileImagePath"))),Profile,StringComparison.OrdinalIgnoreCase),"child_identity_mismatch","Recovery profile identity mismatch");
   }
   if(!rejectHelper)return;
   IntPtr inventory; int count; Guard(Native.WTSEnumerateProcesses(IntPtr.Zero,0,1,out inventory,out count),"Recovery process inventory unavailable");
   try {
    Guard(count>=0&&count<=1048576&&(count==0||inventory!=IntPtr.Zero),"Invalid recovery process inventory");
    for(int i=0;i<count;i++) {
     var item=(Native.WtsProcess)Marshal.PtrToStructure(IntPtr.Add(inventory,i*Marshal.SizeOf(typeof(Native.WtsProcess))),typeof(Native.WtsProcess));
     if(item.session!=target)continue;
     // Conservatively reject any helper with our executable name, including another build.
     RecoveryGuard(!String.Equals(Marshal.PtrToStringUni(item.name),Path.GetFileName(Exe),StringComparison.OrdinalIgnoreCase),"child_recovery_blocked","A live native helper already exists in the recovery child");
     Guard(item.sid!=IntPtr.Zero,"Recovery child process token identity is unknown");
     if(new SecurityIdentifier(item.sid).Value!=Sid)continue;
     try { using(var process=Process.GetProcessById(item.pid)) {
      Guard(process.SessionId==target,"Recovery process session changed during inventory");
      string image=process.MainModule.FileName;
      Guard(!String.Equals(image,Exe,StringComparison.OrdinalIgnoreCase)&&!(new FileInfo(image).Length==new FileInfo(Exe).Length&&Hash(image)==Hash(Exe)),"A matching helper already exists under another name in the recovery child");
     } } catch(ArgumentException) { /* Process ended before inspection; no live helper remains. */ }
    }
   } finally { if(inventory!=IntPtr.Zero)Native.WTSFreeMemory(inventory); }
  }
  static void ValidateFile(string file) {
   Guard(Path.IsPathRooted(file)&&file==Path.GetFullPath(file)&&Path.GetFileName(file)=="request.json","Canonical recovery request required");
   string directory=Path.GetDirectoryName(file);
   Guard(Hex(Path.GetFileName(directory),32)&&String.Equals(Path.GetDirectoryName(directory),Root,StringComparison.OrdinalIgnoreCase),"Invalid recovery request hierarchy");
   MachineSetup.InspectExistingAncestors(directory);
   var info=new DirectoryInfo(directory); Guard(info.Exists,"Recovery request directory missing");
   var security=info.GetAccessControl();
   Guard(security.GetOwner(typeof(SecurityIdentifier)).Value==Sid&&security.AreAccessRulesProtected&&security.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().All(rule=>rule.IdentityReference.Value==Sid),"Recovery directory is not private and user-owned");
  }
  static void ValidateParent(Dictionary<string,object> request) {
   Guard(Text(request,"sid")==Sid&&Text(request,"profile")==Profile&&Number(request,"parentSessionId")==Session&&Text(request,"helperPath")==Exe&&Text(request,"helperSha256")==Hash(Exe),"Recovery broker identity mismatch");
   using(var parent=Process.GetProcessById(Number(request,"parentPid"))) {
    Guard(parent.Id!=Process.GetCurrentProcess().Id&&parent.SessionId==Session&&parent.StartTime.ToUniversalTime().Ticks.ToString()==Text(request,"parentCreated")&&!parent.HasExited,"Recovery parent process changed");
    Guard(String.Equals(parent.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase)&&Hash(parent.MainModule.FileName)==Text(request,"helperSha256"),"Recovery parent helper changed");
    IntPtr token; Guard(Native.OpenProcessToken(parent.Handle,8,out token),"Recovery parent token unavailable");
    try { using(var identity=new WindowsIdentity(token))Guard(identity.User.Value==Sid,"Recovery parent token SID mismatch"); } finally { Native.CloseHandle(token); }
   }
  }
  internal static void Launch(Dictionary<string,object> request,string pipeName,string challenge) {
   ValidateRequest(request); ValidateTarget(Number(request,"childSessionId"),false);
   string directory=null; bool exited=false,launched=false;
   try {
    MachineSetup.InspectExistingAncestors(Root); Directory.CreateDirectory(Root); MachineSetup.InspectExistingAncestors(Root);
    directory=Path.Combine(Root,Guid.NewGuid().ToString("N")); Guard(!Directory.Exists(directory)&&!File.Exists(directory),"Recovery directory collision");
    var security=new DirectorySecurity(); security.SetAccessRuleProtection(true,false); security.SetOwner(new SecurityIdentifier(Sid));
    security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
    Directory.CreateDirectory(directory,security); string file=Path.Combine(directory,"request.json"); ValidateFile(file);
    var ticket=new Dictionary<string,object>(request);
    ticket["sid"]=Sid; ticket["profile"]=Profile; ticket["parentSessionId"]=Session; ticket["helperPath"]=Exe;
    ticket["parentPid"]=Process.GetCurrentProcess().Id; ticket["parentCreated"]=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString();
    ticket["pipeName"]=pipeName; ticket["challenge"]=challenge; ticket["brokerNonce"]=RandomSecret();
    byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(ticket)); Guard(bytes.Length<=16384,"Recovery request oversized");
    using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
    using(var process=Process.Start(new ProcessStartInfo(Exe) { UseShellExecute=true,Verb="runas",WindowStyle=ProcessWindowStyle.Hidden,Arguments="--recover-child \""+file+"\" "+Text(ticket,"brokerNonce")+" "+Hash(Exe) })) {
     launched=true; Guard(process!=null,"Recovery broker process unavailable");
     Guard(process.WaitForExit(150000),"Recovery broker timed out; launch and cleanup remain unknown"); exited=true;
     ValidateFile(file); string receipt=Path.Combine(directory,"receipt.json"); var info=new FileInfo(receipt);
     Guard(info.Exists&&(info.Attributes&FileAttributes.ReparsePoint)==0&&info.Length>0&&info.Length<=16384,"Recovery broker receipt unavailable or unsafe");
     var result=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(receipt,Encoding.UTF8));
     Guard(SameSecret(Text(result,"brokerNonce"),Text(ticket,"brokerNonce"))&&Text(result,"recoveryRequestId")==Text(ticket,"recoveryRequestId")&&Number(result,"childSessionId")==Number(ticket,"childSessionId")&&Text(result,"sid")==Sid&&Number(result,"parentSessionId")==Session,"Recovery receipt identity mismatch");
     Guard(result.ContainsKey("ok")&&result["ok"] is bool&&process.ExitCode==((bool)result["ok"]?0:1),"Recovery receipt and exit disagree");
     bool ok=(bool)result["ok"]; string message=Text(result,"message"); bool clean=Text(result,"taskRemoved")=="True";
     Guard(clean,"Recovery task registration cleanup unconfirmed: "+message);
     File.Delete(receipt); File.Delete(file); Directory.Delete(directory,false); directory=null;
     string code=Text(result,"code"); RecoveryGuard(ok,code=="child_identity_mismatch"?code:"child_recovery_blocked","Recovery broker failed: "+message);
    }
   } catch(RecoveryError) { throw; }
   catch(Exception e) {
    if(Text(request,"automaticRecovery")=="True")throw new RecoveryError("child_recovery_blocked","Automatic child recovery failed; broker completion or cleanup may require review");
    throw new InvalidOperationException(e.Message+"; recoveryDirectory="+(directory??"none")+"; brokerLaunched="+launched+"; brokerExited="+exited,e);
   }
  }
  internal static int Elevated(string[] args) {
   try {
    Guard(args.Length==4&&Hex(args[2],64)&&Hex(args[3],64)&&args[3]==Hash(Exe),"Invalid elevated recovery mode or helper hash");
    Guard(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Recovery broker requires manual elevation");
    string file=args[1]; ValidateFile(file); var info=new FileInfo(file);
    Guard(info.Exists&&(info.Attributes&FileAttributes.ReparsePoint)==0&&info.Length>0&&info.Length<=16384,"Recovery request unavailable or unsafe");
    using(var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.None)) using(var reader=new StreamReader(stream,Encoding.UTF8)) {
     Guard(stream.Length>0&&stream.Length<=16384,"Recovery request oversized"); var request=Json.Deserialize<Dictionary<string,object>>(reader.ReadToEnd());
     ValidateRequest(request); Guard(SameSecret(Text(request,"brokerNonce"),args[2]),"Recovery nonce mismatch");
     ValidateParent(request);
     Guard(Text(request,"pipeName").StartsWith("azrael-child-",StringComparison.Ordinal)&&Hex(Text(request,"pipeName").Substring(13),64)&&Hex(Text(request,"challenge"),64),"Invalid recovery worker transport");
     string receipt=Path.Combine(Path.GetDirectoryName(file),"receipt.json"); Guard(!File.Exists(receipt)&&!Directory.Exists(receipt),"Recovery receipt already exists");
     bool ok=false,removed=true,registered=false; string message="",code=""; dynamic folder=null;
     string taskName="Azrael.ChildRecovery."+Guid.NewGuid().ToString("N");
     try {
      // Trusted request failures get a bounded receipt, including pre-launch inventory rejection.
      ValidateTarget(Number(request,"childSessionId"),true);
      if(request.ContainsKey("expectedIdentity"))ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,Number(request,"childSessionId"),true);
      dynamic scheduler=Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service")); scheduler.Connect(); folder=scheduler.GetFolder("\\");
      dynamic definition=scheduler.NewTask(0); definition.Principal.UserId=Sid; definition.Principal.LogonType=3; definition.Principal.RunLevel=0;
      definition.Settings.Enabled=true; definition.Settings.Hidden=true; definition.Settings.AllowDemandStart=true; definition.Settings.ExecutionTimeLimit="PT0S";
      Guard((int)definition.Triggers.Count==0,"Recovery task must have no triggers");
      definition.Settings.DisallowStartIfOnBatteries=false; definition.Settings.StopIfGoingOnBatteries=false;
      dynamic action=definition.Actions.Create(0); action.Path=Exe; action.WorkingDirectory=Path.GetDirectoryName(Exe);
      action.Arguments="--worker "+Text(request,"pipeName")+" "+Text(request,"challenge")+" "+Session+" "+Hash(Exe);
      // TASK_CREATE only: never replace somebody else's registration.
      removed=false;
      dynamic task=folder.RegisterTaskDefinition(taskName,definition,2,Sid,null,3,null); registered=true;
      ValidateParent(request); ValidateTarget(Number(request,"childSessionId"),true);
      if(request.ContainsKey("expectedIdentity"))ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,Number(request,"childSessionId"),true);
      dynamic running=task.RunEx(null,4,Number(request,"childSessionId"),null);
      Guard(running!=null,"Task Scheduler returned no running task identity");
      var deadline=Stopwatch.StartNew();
      while((int)running.State!=4&&deadline.ElapsedMilliseconds<10000) { Thread.Sleep(100); running.Refresh(); }
      Guard((int)running.State==4,"Recovery task did not enter running state; worker launch unverified"); ok=true;
     } catch(Exception e) { message=e.Message; code=e is RecoveryError?((RecoveryError)e).Code:"child_recovery_blocked"; }
     finally {
      if(registered)try { folder.DeleteTask(taskName,0); removed=true; } catch(Exception e) { message+="; exact task cleanup failed: "+e.Message; }
     }
     ok=ok&&removed; ValidateFile(file);
     var result=new { ok=ok,code=code,brokerNonce=args[2],recoveryRequestId=Text(request,"recoveryRequestId"),sid=Sid,parentSessionId=Session,childSessionId=Number(request,"childSessionId"),taskName=taskName,taskRemoved=removed,message=message };
     byte[] bytes=Encoding.UTF8.GetBytes(Json.Serialize(result));
     using(var output=new FileStream(receipt,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { output.Write(bytes,0,bytes.Length); output.Flush(true); }
     return ok?0:1;
    }
   } catch { return 1; }
  }
  internal static void SelfTest() {
   var request=new Dictionary<string,object> { {"operation","recover"},{"recoveryRequestId","9f4e72c4-1526-4c1b-aed4-b52ca6244b58"},{"childSessionId",Session+1},{"helperSha256",new string('a',64)},{"ownerId","fixture"} };
   ValidateRequest(request);
   foreach(int target in new[]{-1,0,Session}) { bool rejected=false; try { ValidateTargetId(target,Session); } catch { rejected=true; } Guard(rejected,"Invalid recovery target accepted"); }
   foreach(string id in new[]{"","not-a-uuid",Guid.Empty.ToString("D")}) { request["recoveryRequestId"]=id; bool rejected=false; try { ValidateRequest(request); } catch { rejected=true; } Guard(rejected,"Invalid recovery UUID accepted"); }
   request["recoveryRequestId"]="9f4e72c4-1526-4c1b-aed4-b52ca6244b58";
   foreach(string mode in new[]{"start","","--worker"}) { request["operation"]=mode; bool rejected=false; try { ValidateRequest(request); } catch { rejected=true; } Guard(rejected,"Implicit recovery mode accepted"); }
   request["operation"]="recover"; request["helperSha256"]="bad"; bool hashRejected=false; try { ValidateRequest(request); } catch { hashRejected=true; } Guard(hashRejected,"Invalid recovery hash accepted");
   request["helperSha256"]=new string('a',64); request["ownerId"]=""; bool ownerRejected=false; try { ValidateRequest(request); } catch { ownerRejected=true; } Guard(ownerRejected,"Empty recovery owner accepted");
  }
 }

 sealed class BootstrapJournal : IDisposable {
  const string RegistryPath="Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
  const string Schema="azrael.windows-child-bootstrap/v2", LegacySchema="azrael.windows-child-bootstrap/v1";
  const int RunOnceLimit=260;
  internal static string Command(string exe,string launchId) {
   Guard(ValidLaunchId(launchId),"Bootstrap launch identity malformed");
   Guard(!String.IsNullOrWhiteSpace(exe)&&Path.IsPathRooted(exe)&&exe.IndexOf('"')<0&&exe.All(c=>!Char.IsControl(c)),"Bootstrap executable path malformed");
   string command="\""+exe+"\" --bootstrap "+launchId;
   Guard(command.Length<=RunOnceLimit,"Bootstrap RunOnce command exceeds 260 characters; a shorter installation path is required");
   return command;
  }
  static bool ValidLaunchId(string value) { return value!=null&&value.Length==32&&value.All(c=>"0123456789abcdef".IndexOf(c)>=0); }
  static string LaunchRoot { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Azrael","ChildBootstrap"); } }
  static string LaunchFile(string id) { Guard(ValidLaunchId(id),"Bootstrap launch identity malformed"); return Path.Combine(LaunchRoot,id+".json"); }
  static string ReadPrivate(string path) {
   MachineSetup.InspectExistingAncestors(Path.GetDirectoryName(path));
   var info=new FileInfo(path);
   Guard(info.Exists&&(info.Attributes&(FileAttributes.Directory|FileAttributes.ReparsePoint))==0&&info.Length>0&&info.Length<=16384,"Journal identity or size is uncertain");
   var access=File.GetAccessControl(path);
   Guard(access.GetOwner(typeof(SecurityIdentifier)).Value==Sid&&access.AreAccessRulesProtected,"Journal file owner or private permissions mismatch");
   Guard(access.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().All(rule=>rule.IdentityReference.Value==Sid),"Journal permissions include another principal");
   return File.ReadAllText(path,Encoding.UTF8);
  }
  static void WritePrivate(string path,string text) {
   var bytes=new UTF8Encoding(false).GetBytes(text); Guard(bytes.Length<=16384,"Bootstrap journal exceeds bounded storage");
   MachineSetup.InspectExistingAncestors(Path.GetDirectoryName(path));
   var security=new FileSecurity(); security.SetAccessRuleProtection(true,false);
   security.SetOwner(new SecurityIdentifier(Sid)); security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid),FileSystemRights.FullControl,AccessControlType.Allow));
   using(var stream=new FileStream(path,FileMode.CreateNew,FileSystemRights.Read|FileSystemRights.Write,FileShare.None,4096,FileOptions.WriteThrough,security)) { stream.Write(bytes,0,bytes.Length); stream.Flush(true); }
   Guard(ReadPrivate(path)==text,"Bootstrap journal write was not verified");
  }
  internal static int StartWorker(string launchId) {
   var value=Json.Deserialize<Dictionary<string,object>>(ReadPrivate(LaunchFile(launchId)));
   Guard(Text(value,"schema")==Schema&&Text(value,"launchId")==launchId,"Bootstrap launch request identity mismatch");
   int parent=Number(value,"parentSessionId");
   ValidateRecord(value,Sid,Profile,parent,Exe,Hash(Exe));
   Guard(parent!=Session,"Bootstrap worker must run in the child session");
   using(var creator=Process.GetProcessById(Number(value,"creatorPid"))) {
    Guard(!creator.HasExited&&creator.SessionId==parent&&creator.StartTime.ToUniversalTime().Ticks.ToString()==Text(value,"creatorCreated"),"Bootstrap parent process identity changed");
    Guard(String.Equals(creator.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase)&&Hash(creator.MainModule.FileName)==Text(value,"helperSha256"),"Bootstrap parent helper identity changed");
    IntPtr token; Guard(Native.OpenProcessToken(creator.Handle,8,out token),"Bootstrap parent token unavailable");
    try { using(var identity=new WindowsIdentity(token))Guard(identity.User.Value==Sid,"Bootstrap parent token SID mismatch"); } finally { Native.CloseHandle(token); }
   }
   return Worker(Text(value,"pipeName"),Text(value,"challenge"),parent,Text(value,"helperSha256"));
  }
  readonly string file; readonly Mutex mutex; bool locked;
  string recordText; Dictionary<string,object> record;
  public BootstrapJournal(string path) {
   Guard(!String.IsNullOrWhiteSpace(path)&&Path.IsPathRooted(path),"Trusted bootstrap journal path required");
   file=Path.GetFullPath(path);
   var directory=new DirectoryInfo(Path.GetDirectoryName(file));
   Guard(directory.Exists,"Bootstrap journal parent directory must exist");
   for(var current=directory;current!=null;current=current.Parent)Guard((current.Attributes&FileAttributes.ReparsePoint)==0,"Journal parent cannot be a reparse point");
   mutex=new Mutex(false,"Local\\Azrael.ChildJournal."+HashText(Sid+"|"+file.ToUpperInvariant()));
   try { locked=mutex.WaitOne(0); } catch(AbandonedMutexException) { locked=true; }
   Guard(locked,"Bootstrap journal is in active use");
  }
  public static object Reconcile(string path) {
   try { using(var journal=new BootstrapJournal(path)) return journal.ReconcileOwned(); }
   catch(Exception e) { return new { ok=false,state="bootstrap_reconciliation_deferred",reason=e.Message,hresult=e.HResult }; }
  }
  bool JournalExists() {
   try { Guard((File.GetAttributes(file)&FileAttributes.Directory)==0,"Journal path is a directory"); return true; }
   catch(FileNotFoundException) { return false; } catch(DirectoryNotFoundException) { return false; }
  }
  bool Load() {
   if(!JournalExists())return false;
   recordText=ReadPrivate(file); record=Json.Deserialize<Dictionary<string,object>>(recordText);
   ValidateRecord(record,Sid,Profile,Session,Exe,Hash(Exe));
   return true;
  }
  static void ValidateRecord(Dictionary<string,object> valueRecord,string sid,string profile,int session,string exe,string hash) {
   string schema=Text(valueRecord,"schema");
   Guard((schema==Schema||schema==LegacySchema)&&Text(valueRecord,"sid")==sid&&Text(valueRecord,"profile")==profile&&Number(valueRecord,"parentSessionId")==session,"Bootstrap journal owner identity mismatch");
   Guard(!String.IsNullOrWhiteSpace(Text(valueRecord,"ownerId"))&&Text(valueRecord,"ownerId").Length<=256&&Number(valueRecord,"creatorPid")>0,"Bootstrap journal task or creator identity malformed");
   long created; Guard(Int64.TryParse(Text(valueRecord,"creatorCreated"),out created)&&created>0,"Bootstrap creator creation identity malformed");
   Guard(String.Equals(Text(valueRecord,"helperPath"),exe,StringComparison.OrdinalIgnoreCase)&&Text(valueRecord,"helperSha256")==hash,"Bootstrap journal helper identity mismatch");
   string name=Text(valueRecord,"runName"), value=Text(valueRecord,"runValue");
   Guard(name.StartsWith("Azrael.Child.",StringComparison.Ordinal)&&name.Length==77&&name.Substring(13).All(c=>"0123456789abcdef".IndexOf(c)>=0),"Journal RunOnce name is not an owned bootstrap identity");
   Guard(HashText(value)==Text(valueRecord,"runValueSha256"),"Journal RunOnce value hash mismatch");
   string pipe=Text(valueRecord,"pipeName"),secret=Text(valueRecord,"challenge");
   Guard(pipe.StartsWith("azrael-child-",StringComparison.Ordinal)&&pipe.Length==77&&pipe.Substring(13).All(c=>"0123456789abcdef".IndexOf(c)>=0)&&secret.Length==64&&secret.All(c=>"0123456789abcdef".IndexOf(c)>=0),"Journal bootstrap channel identity malformed");
   string expected=schema==Schema?Command(exe,Text(valueRecord,"launchId")):"\""+exe+"\" --worker "+pipe+" "+secret+" "+session+" "+hash;
   Guard(value==expected,"Journal executable command identity mismatch");
  }
  public static void SelfTest() {
   string secret=new string('a',64),exe="C:\\fixture\\helper.exe",hash=new string('b',64),pipe="azrael-child-"+secret;
   string launchId=new string('c',32),value=Command(exe,new string('c',32));
   var valid=new Dictionary<string,object> { {"schema",Schema},{"launchId",launchId},{"sid","fixtureSid"},{"profile","fixtureProfile"},{"parentSessionId",1},
    {"ownerId","fixtureTask"},{"creatorPid",123},{"creatorCreated","456"},{"helperPath",exe},{"helperSha256",hash},
    {"runName","Azrael.Child."+secret},{"runValue",value},{"runValueSha256",HashText(value)},{"pipeName",pipe},{"challenge",secret} };
   ValidateRecord(valid,"fixtureSid","fixtureProfile",1,exe,hash);
   foreach(string key in new[]{"sid","profile","helperPath","helperSha256","runName","runValue","creatorCreated"}) {
    var changed=new Dictionary<string,object>(valid); changed[key]="unrelated"; bool rejected=false;
    try { ValidateRecord(changed,"fixtureSid","fixtureProfile",1,exe,hash); } catch { rejected=true; }
    Guard(rejected,"Journal fixture mutation was not rejected: "+key);
   }
   Guard(ExactRunOnceValue(RegistryValueKind.String,value,value),"Exact RunOnce fixture rejected");
   Guard(!ExactRunOnceValue(RegistryValueKind.String,value+" changed",value),"Changed RunOnce fixture accepted");
   Guard(!ExactRunOnceValue(RegistryValueKind.ExpandString,value,value),"Expanded RunOnce fixture accepted");
   Guard(!ExactRunOnceValue(RegistryValueKind.DWord,123,value),"Non-string RunOnce fixture accepted");
   Guard(!ExactRunOnceValue(RegistryValueKind.String,null,value),"Unknown RunOnce fixture accepted");
   var forged=new Dictionary<string,object>(valid); forged["runValue"]=value+" extra"; forged["runValueSha256"]=HashText((string)forged["runValue"]);
   bool forgedRejected=false; try { ValidateRecord(forged,"fixtureSid","fixtureProfile",1,exe,hash); } catch { forgedRejected=true; }
   Guard(forgedRejected,"Rehashed foreign bootstrap command accepted");
   // Exercise actual command construction and request validation without a logon or registry write.
   string suffix="\" --bootstrap "+launchId;
   string boundaryExe="C:\\"+new string('x',RunOnceLimit-1-suffix.Length-3);
   Guard(Command(boundaryExe,launchId).Length==260,"260-character RunOnce boundary rejected");
   foreach(string badExe in new[]{boundaryExe+"x","C:\\bad\"path.exe","C:\\bad\npath.exe"}) {
    bool rejected=false; try { Command(badExe,launchId); } catch { rejected=true; } Guard(rejected,"Invalid RunOnce path accepted");
   }
   foreach(string badId in new[]{"..\\foreign",new string('a',31),new string('A',32)}) {
    bool rejected=false; try { Command(exe,badId); } catch { rejected=true; } Guard(rejected,"Invalid bootstrap launch ID accepted");
   }
   var wrongLaunch=new Dictionary<string,object>(valid); wrongLaunch["launchId"]=new string('d',32);
   bool wrongRejected=false; try { ValidateRecord(wrongLaunch,"fixtureSid","fixtureProfile",1,exe,hash); } catch { wrongRejected=true; }
   Guard(wrongRejected,"Mismatched bootstrap launch ID accepted");
   var legacy=new Dictionary<string,object>(valid); legacy["schema"]=LegacySchema; legacy.Remove("launchId");
   legacy["runValue"]="\""+exe+"\" --worker "+pipe+" "+secret+" 1 "+hash; legacy["runValueSha256"]=HashText(Text(legacy,"runValue"));
   ValidateRecord(legacy,"fixtureSid","fixtureProfile",1,exe,hash); // Only reconciliation accepts v1 records.
   Guard(!value.Contains(secret)&&!value.Contains(pipe)&&!value.Contains(hash),"RunOnce command leaked bootstrap payload");
  }
  object ReconcileOwned() {
   if(!Load())return new { ok=true,state="no_pending_bootstrap",registryValuesRemoved=0 };
   int creator=Number(record,"creatorPid");
   try { using(var process=Process.GetProcessById(creator)) {
    Guard(process.StartTime.ToUniversalTime().Ticks.ToString()!=Text(record,"creatorCreated"),"Bootstrap creator is still active");
   } } catch(ArgumentException) { }
   // PID absence alone is insufficient: exclude a live child and every possible same-helper worker.
   uint child; bool found=Native.WTSGetChildSessionId(out child); int error=Marshal.GetLastWin32Error();
   Guard(ChildAbsent(found,child,error),"Existing or unknown child session protects bootstrap state");
   foreach(var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(Exe)))using(process) {
    if(process.Id==Process.GetCurrentProcess().Id)continue;
    Guard(!String.Equals(process.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase),"A matching helper or worker is still active");
   }
   int removed=RemoveExactValue(); RemoveExactJournal();
   return new { ok=true,state="bootstrap_reconciled",registryValuesRemoved=removed,creatorPid=creator,parentSessionId=Session };
  }
  public void Prepare() { ReconcileOwned(); }
  public void Create(string runName,string runValue,string pipeName,string challenge,string ownerId,string launchId) {
   Guard(!String.IsNullOrWhiteSpace(ownerId)&&ownerId.Length<=256,"Bounded trusted task owner identity required");
   Guard(!JournalExists(),"Pending bootstrap journal must be reconciled before start");
   record=new Dictionary<string,object> {
    {"schema",Schema},{"launchId",launchId},{"sid",Sid},{"profile",Profile},{"parentSessionId",Session},{"ownerId",ownerId},
    {"creatorPid",Process.GetCurrentProcess().Id},{"creatorCreated",Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()},
    {"helperPath",Exe},{"helperSha256",Hash(Exe)},{"runName",runName},{"runValue",runValue},{"runValueSha256",HashText(runValue)},
    {"pipeName",pipeName},{"challenge",challenge}
   };
   ValidateRecord(record,Sid,Profile,Session,Exe,Hash(Exe));
   string launchFile=LaunchFile(launchId);
   MachineSetup.InspectExistingAncestors(LaunchRoot); Directory.CreateDirectory(LaunchRoot); MachineSetup.InspectExistingAncestors(LaunchRoot);
   Guard(!File.Exists(launchFile)&&!Directory.Exists(launchFile),"Bootstrap launch request collision");
   recordText=Json.Serialize(record);
   WritePrivate(file,recordText); // Persist cleanup ownership before creating the secondary request.
   WritePrivate(launchFile,recordText);
  }
  int RemoveExactValue() {
   using(var key=Registry.CurrentUser.OpenSubKey(RegistryPath,true)) {
    string name=Text(record,"runName");
    if(key==null||!key.GetValueNames().Any(entry=>String.Equals(entry,name,StringComparison.OrdinalIgnoreCase)))return 0;
    object value=key.GetValue(name,null,RegistryValueOptions.DoNotExpandEnvironmentNames);
    Guard(ExactRunOnceValue(key.GetValueKind(name),value,Text(record,"runValue")),"RunOnce value changed; preserve registry and journal state");
    Guard(File.ReadAllText(file,Encoding.UTF8)==recordText,"Bootstrap journal changed during reconciliation");
    key.DeleteValue(name,false); Guard(!key.GetValueNames().Any(entry=>String.Equals(entry,name,StringComparison.OrdinalIgnoreCase)),"RunOnce removal was not verified"); return 1;
   }
  }
  static bool ExactRunOnceValue(RegistryValueKind kind,object value,string expected) {
   return kind==RegistryValueKind.String&&value is string&&String.Equals((string)value,expected,StringComparison.Ordinal);
  }
  void RemoveExactJournal() {
   Guard(File.ReadAllText(file,Encoding.UTF8)==recordText&&File.GetAccessControl(file).GetOwner(typeof(SecurityIdentifier)).Value==Sid,"Bootstrap journal identity changed");
   Guard((File.GetAttributes(file)&FileAttributes.ReparsePoint)==0,"Bootstrap journal became a reparse point");
   if(Text(record,"schema")==Schema) {
    string launchFile=LaunchFile(Text(record,"launchId"));
    if(File.Exists(launchFile)||Directory.Exists(launchFile)) {
     Guard(ReadPrivate(launchFile)==recordText,"Bootstrap launch request changed; preserve journal state");
     File.Delete(launchFile); Guard(!File.Exists(launchFile)&&!Directory.Exists(launchFile),"Bootstrap launch request removal was not verified");
    }
   }
   File.Delete(file); Guard(!JournalExists(),"Bootstrap journal removal was not verified");
  }
  public void RestoreCurrent() {
   if(recordText==null)return;
   Guard(File.ReadAllText(file,Encoding.UTF8)==recordText,"Current bootstrap journal changed; preserve it");
   Guard(Load()&&Number(record,"creatorPid")==Process.GetCurrentProcess().Id&&Text(record,"creatorCreated")==Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString(),"Current bootstrap journal creator identity mismatch");
   RemoveExactValue(); RemoveExactJournal(); recordText=null; record=null;
  }
  public void Dispose() { if(locked) { mutex.ReleaseMutex(); locked=false; } mutex.Dispose(); }
 }

 class Rdp : AxHost {
  public Rdp():base("A0C63C30-F08D-4AB4-907C-34905D770C7D") {}
  public object Client { get { return GetOcx(); } }
 }
 [ComImport,Guid("302D8188-0052-4807-806A-362B628F9AC5"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface ExtendedSettings {
  void set_Property([MarshalAs(UnmanagedType.BStr)] string name,[In,MarshalAs(UnmanagedType.Struct)] ref object value);
  void get_Property([MarshalAs(UnmanagedType.BStr)] string name,[Out,MarshalAs(UnmanagedType.Struct)] out object value);
 }

 class Host : Form {
  const string RunOncePath="Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
  Rdp rdp; NamedPipeServerStream pipe; StreamReader reader; StreamWriter writer;
  string nonce, pipeName, runName, runValue; int child=-1,workerPid=-1,sessionAnchorPid=-1; string workerCreated,sessionAnchorCreated;
  bool started=false, disposed=false,workerTransportUncertain=false,ownershipVerified=false,recovered=false;
  Mutex ownership; bool ownershipLocked;
  readonly object leaseGate=new object(); bool leaseHeld=true,nativeBusy=true,handoffPending=false;
  readonly ManualResetEvent handoff=new ManualResetEvent(false),detached=new ManualResetEvent(false);
  string detachError; NamedPipeServerStream rendezvous;
  static string RendezvousName { get { return "azrael-child-owner-"+HashText(Sid+"|"+Session); } }
  internal static bool HandoffEligible(bool started,bool busy,bool held,bool pending,bool uncertain,int requested,int child) { return started&&!busy&&!held&&!pending&&!uncertain&&requested==child; }
  static bool ReleaseProof(Dictionary<string,object> proof) { return proof.ContainsKey("ok")&&proof["ok"] is bool&&(bool)proof["ok"]&&proof.ContainsKey("inputReleased")&&proof["inputReleased"] is bool&&(bool)proof["inputReleased"]&&proof.ContainsKey("heldInput")&&proof["heldInput"] is bool&&!(bool)proof["heldInput"]; }
  internal static void ReconnectSelfTest() {
   Guard(HandoffEligible(true,false,false,false,false,3,3),"Idle handoff denied");
   foreach(int bad in Enumerable.Range(0,6))Guard(!HandoffEligible(bad!=0,bad==1,bad==2,bad==3,bad==4,bad==5?4:3,3),"Unsafe handoff accepted");
   var proof=new Dictionary<string,object> { {"ok",true},{"inputReleased",true},{"heldInput",false} }; Guard(ReleaseProof(proof),"Release proof denied");
   foreach(string key in new[]{"ok","inputReleased","heldInput"}) { var invalid=new Dictionary<string,object>(proof); invalid.Remove(key); Guard(!ReleaseProof(invalid),"Incomplete release proof accepted"); invalid[key]="True"; Guard(!ReleaseProof(invalid),"Untyped release proof accepted"); }
   using(var self=Process.GetCurrentProcess()) {
    using(var trusted=TrustedPeer((uint)self.Id,self.StartTime.ToUniversalTime().Ticks.ToString()))Guard(trusted.Id==self.Id,"Trusted peer rejected");
    bool rejected=false; try { using(var invalid=TrustedPeer((uint)self.Id,"1")) {} } catch { rejected=true; } Guard(rejected,"Reused peer identity accepted");
    rejected=false; try { ValidateTrustedProcess(self,self.StartTime.ToUniversalTime().Ticks.ToString(),Session+1); } catch { rejected=true; } Guard(rejected,"Wrong peer Windows session accepted");
    rejected=false; try { WaitExactTerminal(self,0); } catch(RecoveryError e) { rejected=e.Code=="child_recovery_blocked"; } Guard(rejected&&!self.HasExited,"Live process timeout was not preserved");
   }
   // Unsupported arguments exit before creating Host/RDP or changing configuration.
   using(var ended=Process.Start(new ProcessStartInfo(Exe,"--reconnect-terminal-fixture") { UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,RedirectStandardOutput=true,RedirectStandardError=true })) {
    Guard(ended!=null&&ended.WaitForExit(10000),"Terminal fixture did not exit"); WaitExactTerminal(ended,0);
   }
   var identity=new Dictionary<string,object> { {"sid",Sid},{"profile",Profile},{"parentSessionId",Session},{"childSessionId",Session+1},{"workerPid",123},{"workerCreated","1234"},{"sessionAnchorPid",124},{"sessionAnchorCreated","1235"} };
   Recovery.ValidateExpected(identity,Session+1,false);
   foreach(string key in new[]{"sid","profile","parentSessionId","sessionAnchorCreated"}) {
    var invalid=new Dictionary<string,object>(identity); invalid.Remove(key); bool rejected=false;
    try { Recovery.ValidateExpected(invalid,Session+1,false); } catch(RecoveryError e) { rejected=e.Code=="child_identity_mismatch"; } Guard(rejected,"Partial expected identity accepted");
   }
   bool wrong=false; try { Recovery.ValidateExpected(identity,Session+2,false); } catch(RecoveryError e) { wrong=e.Code=="child_identity_mismatch"; } Guard(wrong,"Different expected child accepted");
  }
  static Process TrustedPeer(uint pid,string created) {
   var process=Process.GetProcessById((int)pid);
   try {
    ValidateTrustedProcess(process,created,Session); return process;
   } catch { process.Dispose(); throw; }
  }
  static void ValidateTrustedProcess(Process process,string created,int session) {
    // Acquire and retain the kernel process handle before reading mutable PID metadata.
    IntPtr handle=process.Handle;
    Guard(process.SessionId==session&&!process.HasExited&&process.StartTime.ToUniversalTime().Ticks.ToString()==created,"Handoff peer process identity changed");
    Guard(Hash(process.MainModule.FileName)==Hash(Exe),"Handoff requires the same trusted helper build");
    IntPtr token; Guard(Native.OpenProcessToken(handle,8,out token),"Handoff peer token unavailable");
    try { using(var identity=new WindowsIdentity(token))Guard(identity.User.Value==Sid,"Handoff peer SID mismatch"); } finally { Native.CloseHandle(token); }
  }
  static void WaitExactTerminal(Process process,int timeout) { RecoveryGuard(process.WaitForExit(timeout),"child_recovery_blocked","Previous child worker termination is unconfirmed; session preserved"); }
  static void WaitExpectedWorker(Dictionary<string,object> identity) {
   Process worker;
   try { worker=Process.GetProcessById(Number(identity,"workerPid")); }
   catch(ArgumentException) { return; } // Existing broker inventory must still establish that no helper is live.
   using(worker)try {
    ValidateTrustedProcess(worker,Text(identity,"workerCreated"),Number(identity,"childSessionId"));
    WaitExactTerminal(worker,10000);
   } catch(RecoveryError) { throw; }
   catch { throw new RecoveryError("child_recovery_blocked","Original worker identity could not be verified; session preserved"); }
  }
  void ServeHandoff() {
   while(!disposed&&!handoffPending) {
    try {
     var security=new PipeSecurity(); security.SetAccessRuleProtection(true,false); security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid),PipeAccessRights.FullControl,AccessControlType.Allow));
     using(var server=new NamedPipeServerStream(RendezvousName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,security)) {
      rendezvous=server; server.WaitForConnection();
      uint pid; Guard(Native.GetNamedPipeClientProcessId(server.SafePipeHandle.DangerousGetHandle(),out pid),"Handoff client unavailable");
      string peerSid=null; server.RunAsClient(delegate { peerSid=WindowsIdentity.GetCurrent().User.Value; }); Guard(peerSid==Sid,"Handoff client SID mismatch");
      using(var r=new StreamReader(server,Encoding.UTF8,false,4096,true))using(var w=new StreamWriter(server,new UTF8Encoding(false),4096,true)) {
       var request=ReadHandoff(r); using(var peer=TrustedPeer(pid,Text(request,"created"))) {
        Guard(Text(request,"operation")=="detachIdle"&&Text(request,"sid")==Sid&&Text(request,"profile")==Profile&&Number(request,"parentSessionId")==Session,"Invalid handoff request");
        bool accepted; lock(leaseGate) { accepted=HandoffEligible(started,nativeBusy,leaseHeld,handoffPending,workerTransportUncertain,Number(request,"childSessionId"),child); if(accepted) { handoffPending=true; handoff.Set(); } }
        if(!accepted) { Write(w,new { ok=false,code="child_session_occupied" }); continue; }
        if(!detached.WaitOne(15000))Write(w,new { ok=false,code="child_recovery_blocked" });
        else Write(w,new { ok=detachError==null,code=detachError==null?"child_owner_detached":"child_recovery_blocked" });
       }
      }
     }
    } catch { if(!handoffPending&&rendezvous==null)return; if(!handoffPending)continue; }
    finally { rendezvous=null; }
   }
   if(handoffPending)BeginInvoke((Action)delegate { started=false; Close(); });
  }
  static Dictionary<string,object> ReadHandoff(StreamReader reader,int timeout=5000) {
   var read=Task.Run(()=> { var value=new StringBuilder(); int c; while((c=reader.Read())!=-1&&c!='\n') { Guard(value.Length<4096,"Handoff request oversized"); value.Append((char)c); } Guard(c=='\n',"Handoff transport closed"); return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(value.ToString()); });
   Guard(read.Wait(timeout),"Handoff response timed out"); return read.Result;
  }
  void RequestIdleHandoff(Dictionary<string,object> request) {
   try {
    using(var client=new NamedPipeClientStream(".",RendezvousName,PipeDirection.InOut,PipeOptions.Asynchronous,TokenImpersonationLevel.Impersonation)) {
     client.Connect(3000); uint pid; Guard(Native.GetNamedPipeServerProcessId(client.SafePipeHandle.DangerousGetHandle(),out pid),"Handoff server unavailable");
     using(var candidate=Process.GetProcessById((int)pid))using(var peer=TrustedPeer(pid,candidate.StartTime.ToUniversalTime().Ticks.ToString()))
     using(var r=new StreamReader(client,Encoding.UTF8,false,4096,true))using(var w=new StreamWriter(client,new UTF8Encoding(false),4096,true)) {
      Write(w,new { operation="detachIdle",sid=Sid,profile=Profile,parentSessionId=Session,childSessionId=Number(request,"childSessionId"),created=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString() });
      var result=ReadHandoff(r,20000); RecoveryGuard(Text(result,"ok")=="True",Text(result,"code")=="child_session_occupied"?"child_session_occupied":"child_recovery_blocked","Existing child owner cannot safely detach");
      RecoveryGuard(peer.WaitForExit(10000),"child_recovery_blocked","Previous native owner termination is unconfirmed");
     }
    }
   } catch(RecoveryError) { throw; } catch { throw new RecoveryError("child_recovery_blocked","Existing owner has no available authenticated handoff; preserve session"); }
  }
  void DetachIdle() {
   try {
    ValidateIdentity();
    using(var worker=Process.GetProcessById(workerPid)) {
     Guard(worker.StartTime.ToUniversalTime().Ticks.ToString()==workerCreated,"Owned worker changed");
     pipe.Dispose(); Guard(worker.WaitForExit(10000),"Owned worker termination is unconfirmed");
    }
    started=false; ownership.ReleaseMutex(); ownershipLocked=false;
   } catch { detachError="child_recovery_blocked"; workerTransportUncertain=true; }
   finally { detached.Set(); }
  }
  object admission;
  readonly StreamReader input=new StreamReader(Console.OpenStandardInput(),Encoding.UTF8);
  readonly StreamWriter output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false));
  protected override bool ShowWithoutActivation { get { return true; } }
  public Host() {
   Text="Azrael isolated session (model control)"; Width=1024; Height=768;
   // The RDP viewer is observation-only; its window never forwards physical input.
   rdp=new Rdp { Dock=DockStyle.Fill, Enabled=false }; Controls.Add(rdp);
   Shown += delegate { Task.Run((Action)Requests); };
   FormClosing += delegate(object sender,FormClosingEventArgs e) { if(started) { e.Cancel=true; WindowState=FormWindowState.Minimized; } };
  }
  void Requests() {
   try {
    while(true) {
     var pending=Task.Run(()=>Read(input,0));
     if(WaitHandle.WaitAny(new[]{handoff,(WaitHandle)((IAsyncResult)pending).AsyncWaitHandle})==0) { DetachIdle(); return; }
     var request=pending.Result; string operation=Text(request,"operation");
     lock(leaseGate) { if(handoffPending) { DetachIdle(); return; } nativeBusy=true; }
     try {
      if(operation=="start"||operation=="recover") { Guard(!started&&!ownershipLocked,"Already started or launch unresolved"); Start(request); bool ready=AdmissionPassed(admission); Write(output,new { ok=ready, state=ready?"admitted":"admission_failed", identity=Identity(),ownershipVerified=ownershipVerified,admission=admission,admissionReady=ready,available=ready,cleanupUnconfirmed=workerTransportUncertain,inputReleased=ready,connectionRecovered=recovered }); }
      else if(operation=="stop") { var result=Stop(); Write(output,result); if(!started) { BeginInvoke((Action)Close); return; } }
      else if(workerTransportUncertain) { Write(output,new { ok=false,state="unknown",ownershipVerified=false,unknownState=true,pendingWork=false,reason="Owned child worker transport is uncertain" }); }
      else {
       if(operation=="acquireLease"||operation=="releaseLease") {
        ValidateIdentity(); Write(writer,new { operation="releaseInput" }); var proof=Read(reader);
        Guard(ReleaseProof(proof),"Lease input release unconfirmed");
        lock(leaseGate)leaseHeld=operation=="acquireLease";
        Write(output,new { ok=true,inputReleased=true,heldInput=false,leaseHeld=leaseHeld,ownershipVerified=true,identity=Identity() }); continue;
       }
       Guard(leaseHeld||operation=="status"||operation=="releaseInput","Child input lease is idle");
       var blocked=ViewerPreflight(operation,recovered,()=> (bool)Invoke((Func<bool>)(()=>WindowState==FormWindowState.Minimized||Native.IsIconic(Handle))));
       if(blocked!=null) { Write(output,blocked); continue; }
       ValidateIdentity(); Write(writer,request); Write(output,Read(reader));
      }
     } catch(Exception e) { if((operation=="start"||operation=="recover")&&started)Write(output,new { ok=false,code=e is RecoveryError?((RecoveryError)e).Code:"native_child_start_failed",message=e.Message,hresult=e.HResult,identity=Identity(),ownershipVerified=ownershipVerified,admission=admission,admissionReady=false,available=false,cleanupUnconfirmed=workerTransportUncertain }); else Write(output,Failure(e)); }
     finally { lock(leaseGate)nativeBusy=false; }
    }
   } catch(Exception) {
    // A lost host does not authorize logging off or closing unknown/unsaved work.
    try { if(pipe!=null)pipe.Dispose(); } catch {}
    BeginInvoke((Action)delegate { started=false; Close(); });
   } finally { if(ownershipLocked) { ownership.ReleaseMutex(); ownershipLocked=false; } if(ownership!=null)ownership.Dispose(); }
  }
  object Identity() { return new { parentSessionId=Session, childSessionId=child, sid=Sid, profile=Profile, workerPid=workerPid, workerCreated=workerCreated,sessionAnchorPid=sessionAnchorPid,sessionAnchorCreated=sessionAnchorCreated }; }
  void Start(Dictionary<string,object> request) {
   recovered=Text(request,"operation")=="recover";
   Guard(Text(request,"helperSha256")==Hash(Exe),"Trusted helper content hash mismatch");
   if(recovered)Recovery.ValidateRequest(request);
   if(recovered&&request.ContainsKey("expectedIdentity"))Recovery.ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,Number(request,"childSessionId"),true);
   ownership=new Mutex(false,"Global\\Azrael.ChildOwner."+HashText(Sid+"|"+Session));
   try { ownershipLocked=ownership.WaitOne(0); } catch(AbandonedMutexException) { ownershipLocked=true; }
   if(!ownershipLocked&&recovered&&Text(request,"automaticRecovery")=="True") {
    RequestIdleHandoff(request);
    try { ownershipLocked=ownership.WaitOne(3000); } catch(AbandonedMutexException) { ownershipLocked=true; }
   }
   RecoveryGuard(ownershipLocked,"child_session_occupied","Another native host owns this parent's child session");
   leaseHeld=true;
   bool enabled; Guard(Native.WTSIsChildSessionsEnabled(out enabled)&&enabled,"Child sessions not enabled; machine setup required");
   uint existing; bool found=Native.WTSGetChildSessionId(out existing); int queryError=Marshal.GetLastWin32Error();
   if(recovered)Recovery.ValidateTarget(Number(request,"childSessionId"),false);
   else Guard(ChildAbsent(found,existing,queryError),"Existing or unknown child session cannot be adopted: "+queryError);
   if(recovered&&request.ContainsKey("expectedIdentity"))Recovery.ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,Number(request,"childSessionId"),true);
   if(recovered&&request.ContainsKey("expectedIdentity"))WaitExpectedWorker(request["expectedIdentity"] as Dictionary<string,object>);
   using(var bootstrap=recovered?null:new BootstrapJournal(Text(request,"bootstrapJournalPath"))) {
   if(bootstrap!=null)bootstrap.Prepare();
   nonce=RandomSecret(); pipeName="azrael-child-"+RandomSecret(); runName="Azrael.Child."+RandomSecret();
   string launchId=Guid.NewGuid().ToString("N");
   runValue=recovered?null:BootstrapJournal.Command(Exe,launchId);
   var security=new PipeSecurity(); security.SetAccessRuleProtection(true,false);
   security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid),PipeAccessRights.FullControl,AccessControlType.Allow));
   pipe=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security);
   try {
   if(bootstrap!=null)bootstrap.Create(runName,runValue,pipeName,nonce,Text(request,"ownerId"),launchId);
   if(recovered) {
    // Never call ConnectToChildSession here: it can create a replacement child.
    Recovery.Launch(request,pipeName,nonce);
   } else {
   using(var key=Registry.CurrentUser.CreateSubKey(RunOncePath)) {
    Guard(key.GetValue(runName)==null,"RunOnce ownership collision"); key.SetValue(runName,runValue,RegistryValueKind.String);
   }
    Invoke((Action)delegate {
     dynamic client=rdp.Client;
     client.Server="localhost"; client.DesktopWidth=1024; client.DesktopHeight=768;
     client.AdvancedSettings7.RedirectClipboard=false;
     client.AdvancedSettings7.EnableCredSspSupport=true;
     var settings=(ExtendedSettings)rdp.Client; object yes=true; settings.set_Property("ConnectToChildSession",ref yes);
     // Keep the Guard call statically bound to ChildSession, not dynamic Host.Guard.
     bool clipboardRedirected=client.AdvancedSettings7.RedirectClipboard;
     Guard(!clipboardRedirected,"Clipboard isolation was not applied");
     client.Connect();
    });
   }
    var waiting=pipe.BeginWaitForConnection(null,null);
    Guard(waiting.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(40)),"Child bootstrap timed out; connection and launch are unverified");
    pipe.EndWaitForConnection(waiting);
    reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true); writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true);
    var hello=Read(reader);
    Guard(SameSecret(Text(hello,"challenge"),nonce),"Worker challenge mismatch");
    Guard(Text(hello,"sid")==Sid && Text(hello,"profile")==Profile,"Worker account/profile mismatch");
    workerPid=Number(hello,"pid"); workerCreated=Text(hello,"created"); child=Number(hello,"sessionId");
    if(recovered)Guard(child==Number(request,"childSessionId"),"Recovery worker reached a different child session");
    uint peerPid; Guard(Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out peerPid)&&peerPid==workerPid,"Worker pipe peer PID mismatch");
    ValidateIdentity();
    started=true; workerTransportUncertain=true;
    foreach(var candidate in Process.GetProcessesByName("winlogon"))using(candidate) {
     if(candidate.SessionId!=child)continue;
     Guard(sessionAnchorPid==-1,"Ambiguous child session anchor"); sessionAnchorPid=candidate.Id; sessionAnchorCreated=AnchorCreated(candidate);
    }
    Guard(sessionAnchorPid>0&&!String.IsNullOrEmpty(sessionAnchorCreated),"Child session anchor unavailable");
    if(recovered&&request.ContainsKey("expectedIdentity"))Recovery.ValidateExpected(request["expectedIdentity"] as Dictionary<string,object>,child,true);
    Write(writer,new { ok=true, challenge=nonce, childSessionId=child, parentSessionId=Session });
    started=true; workerTransportUncertain=false;
    Dictionary<string,object> fixture;
    try { fixture=Read(reader,12000); }
    catch(Exception e) { workerTransportUncertain=true; pipe.Dispose(); fixture=new Dictionary<string,object> { {"render",Gate(false,e.Message)},{"keyboard",Gate(false,e.Message)},{"mouse",Gate(false,e.Message)},{"fixtureClosed",Gate(false,"Fixture closure unconfirmed")} }; }
    if(!workerTransportUncertain)ValidateIdentity();
    admission=new { scope="child_platform_fixture",helperSha256=Hash(Exe),identity=Identity(),
     gates=new { connection=Gate(true,"Authenticated child transport"),parentIdentity=Gate(true,"Parent and child are distinct verified Windows sessions"),
      dataProfile=Gate(true,"Same SID and profile path only; application authentication is unverified"),
      render=fixture.ContainsKey("render")?fixture["render"]:Gate(false,"No render evidence"),
      keyboard=fixture.ContainsKey("keyboard")?fixture["keyboard"]:Gate(false,"No keyboard evidence"),
      mouse=fixture.ContainsKey("mouse")?fixture["mouse"]:Gate(false,"No mouse evidence") },
     fixtureClosed=fixture.ContainsKey("fixtureClosed")?fixture["fixtureClosed"]:Gate(false,"Fixture closure unconfirmed"),
     applicationCompatibility="unverified",parentInputConcurrency="unverified",gpuCompatibility="unverified" };
    Task.Run((Action)ServeHandoff);
   } finally { if(bootstrap!=null)bootstrap.RestoreCurrent(); }
   }
  }
  void ValidateIdentity() {
   ownershipVerified=false;
   uint current; Guard(child>=0 && child!=Session && Native.WTSGetChildSessionId(out current) && current==child,"Owned child session identity changed");
   using(var process=Process.GetProcessById(workerPid)) {
    Guard(process.SessionId==child && process.StartTime.ToUniversalTime().Ticks.ToString()==workerCreated,"Worker process identity changed");
    Guard(String.Equals(process.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase)&&Hash(process.MainModule.FileName)==Hash(Exe),"Worker executable identity changed");
   }
   string peerSid=null; pipe.RunAsClient(delegate { peerSid=WindowsIdentity.GetCurrent().User.Value; });
   Guard(peerSid==Sid,"Worker token SID mismatch");
   ownershipVerified=true;
  }
  object Stop() {
   if(recovered) {
    Guard(!workerTransportUncertain,"Recovered worker transport is uncertain; session preserved");
    ValidateIdentity(); Write(writer,new { operation="releaseInput" }); var released=Read(reader);
    Guard(Text(released,"ok")=="True","Recovered child input release unconfirmed");
    return new { ok=false,state="preserved",logoffConfirmed=false,processesStopped=false,ownershipVerified=true,identity=Identity(),heldInput=false,reason="Recovered session and applications must be preserved; logoff is forbidden" };
   }
   Guard(!workerTransportUncertain,"Owned child worker transport is uncertain; cleanup deferred");
   ValidateIdentity(); Write(writer,new { operation="prepareStop" }); var closure=Read(reader);
   if(!closure.ContainsKey("safe") || !Convert.ToBoolean(closure["safe"]))return closure;
   ValidateIdentity();
   ValidateLiveClosureIdentity(Json.Deserialize<Dictionary<string,object>>(Json.Serialize(Identity())));
   Guard(Native.WTSLogoffSession(IntPtr.Zero,(uint)child,true),"Owned child logoff failed: "+Marshal.GetLastWin32Error());
   uint current; bool found=Native.WTSGetChildSessionId(out current); int logoffQueryError=Marshal.GetLastWin32Error();
   Guard(ChildAbsent(found,current,logoffQueryError),"Child logoff not verified: "+logoffQueryError);
   var result=InspectClosure(Json.Deserialize<Dictionary<string,object>>(Json.Serialize(Identity())));
   started=false; return result;
  }
  protected override void Dispose(bool disposing) {
   if(!disposed) { disposed=true; if(pipe!=null)pipe.Dispose(); if(rendezvous!=null)rendezvous.Dispose(); }
   base.Dispose(disposing);
  }
 }

 static object ViewerPreflight(string operation,bool recovered,Func<bool> minimized) {
  if(recovered || (operation!="launch"&&operation!="capture"&&operation!="input") || !minimized())return null;
  return new { ok=false,code="isolated_viewer_minimized",actionExecuted=false,mutationOutcome="not_executed",viewerState="minimized",requiredUserAction="restore_isolated_viewer" };
 }

 class AppIdentity { public int pid; public string created; public string executable; public IntPtr hwnd; }
 static readonly Dictionary<int,AppIdentity> Apps=new Dictionary<int,AppIdentity>();
 static bool platformAdmitted;
 static volatile bool admissionFixtureActive;
 static object Gate(bool passed,string detail) { return new { passed=passed,detail=detail }; }
 static bool Passed(object gate) {
  if(gate==null)return false;
  var value=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(gate));
  return value.ContainsKey("passed")&&value["passed"] is bool&&(bool)value["passed"];
 }
 static bool AdmissionPassed(object proof) {
  if(proof==null)return false;
  var value=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(proof));
  var gates=value["gates"] as Dictionary<string,object>;
  return gates!=null&&new[]{"connection","render","keyboard","mouse","parentIdentity","dataProfile"}.All(name=>gates.ContainsKey(name)&&Passed(gates[name]))&&Passed(value["fixtureClosed"]);
 }
 sealed class AdmissionForm : Form {
  public readonly TextBox InputBox=new TextBox { Left=20,Top=20,Width=280 };
  public readonly Button ClickTarget=new Button { Left=20,Top=60,Width=120,Height=30,Text="Input check" };
  public int Clicks;
  public readonly Point Sentinel=new Point(35,125);
  public static readonly Color SentinelColor=Color.FromArgb(17,147,131);
  public AdmissionForm() {
   Text="Azrael isolated input check"; ClientSize=new Size(340,180); StartPosition=FormStartPosition.Manual;
   Location=new Point(32,32); AutoScaleMode=AutoScaleMode.None; FormBorderStyle=FormBorderStyle.FixedToolWindow;
   Font=new Font("Segoe UI",9); BackColor=Color.FromArgb(249,249,249); TopMost=true; ShowInTaskbar=false;
   Controls.Add(InputBox); Controls.Add(ClickTarget);
   ClickTarget.Click+=delegate { Clicks++; };
  }
  protected override void OnPaint(PaintEventArgs e) { base.OnPaint(e); using(var brush=new SolidBrush(SentinelColor))e.Graphics.FillRectangle(brush,20,110,100,40); }
 }
 static object FixtureCall(AdmissionForm form,Func<object> action) {
  var pending=form.BeginInvoke(action); Guard(pending.AsyncWaitHandle.WaitOne(1000),"Owned fixture UI did not respond"); return form.EndInvoke(pending);
 }
 static Dictionary<string,object> RunAdmissionFixture(int parent) {
  Guard(Session!=parent,"Admission fixture cannot execute in the parent session");
  var result=new Dictionary<string,object> { {"render",Gate(false,"Not observed")},{"keyboard",Gate(false,"Not observed")},{"mouse",Gate(false,"Not observed")},{"fixtureClosed",Gate(false,"Not closed")} };
  AdmissionForm form=null; Exception uiError=null; var shown=new ManualResetEvent(false); bool mouseHeld=false;
  var ui=new Thread(delegate() {
   try { using(var window=new AdmissionForm()) { form=window; window.Shown+=delegate { admissionFixtureActive=true; shown.Set(); }; Application.Run(window); } }
   catch(Exception e) { uiError=e; shown.Set(); }
   finally { admissionFixtureActive=false; }
  });
  ui.IsBackground=true; ui.SetApartmentState(ApartmentState.STA); admissionFixtureActive=true; ui.Start();
  try {
   Guard(shown.WaitOne(2000)&&uiError==null&&form!=null,"Owned fixture did not open");
   IntPtr hwnd=(IntPtr)FixtureCall(form,()=>form.Handle); uint owner; Native.GetWindowThreadProcessId(hwnd,out owner);
   Guard(owner==Process.GetCurrentProcess().Id&&Session!=parent,"Fixture window identity mismatch");
   FixtureCall(form,delegate { form.Activate(); form.InputBox.Focus(); return null; });
   Guard(Native.GetForegroundWindow()==hwnd,"Owned child fixture did not receive foreground");
   string nonce="AZR"+RandomSecret().Substring(0,20); var keys=new List<Native.Input>();
   foreach(char character in nonce) { var down=new Native.Input(); down.type=1; down.data.keyboard.scan=character; down.data.keyboard.flags=4; keys.Add(down); var up=down; up.data.keyboard.flags=6; keys.Add(up); }
   uint delivered=Native.SendInput((uint)keys.Count,keys.ToArray(),Marshal.SizeOf(typeof(Native.Input)));
   if(delivered!=keys.Count) { var ups=keys.Where((packet,index)=>index%2==1).ToArray(); Native.SendInput((uint)ups.Length,ups,Marshal.SizeOf(typeof(Native.Input))); }
   string text=""; for(int i=0;i<20;i++) { text=(string)FixtureCall(form,()=>form.InputBox.Text); if(text==nonce)break; Thread.Sleep(25); }
   result["keyboard"]=Gate(delivered==keys.Count&&text==nonce,"Child Unicode nonce readback; fixture only");
   Guard(Native.GetForegroundWindow()==hwnd,"Fixture lost foreground before mouse check");
   Point click=(Point)FixtureCall(form,()=>form.ClickTarget.PointToScreen(new Point(form.ClickTarget.Width/2,form.ClickTarget.Height/2)));
   Native.Rect bounds; Guard(Native.GetWindowRect(hwnd,out bounds)&&click.X>=bounds.left&&click.X<bounds.right&&click.Y>=bounds.top&&click.Y<bounds.bottom,"Fixture click bounds mismatch");
   var mouse=new Native.Input(); mouse.data.mouse.dx=(click.X-SystemInformation.VirtualScreen.Left)*65535/Math.Max(1,SystemInformation.VirtualScreen.Width-1);
   mouse.data.mouse.dy=(click.Y-SystemInformation.VirtualScreen.Top)*65535/Math.Max(1,SystemInformation.VirtualScreen.Height-1); mouse.data.mouse.flags=0xC003;
   bool pressed=Native.SendInput(1,new[]{mouse},Marshal.SizeOf(typeof(Native.Input)))==1; mouseHeld=pressed;
   mouse.data.mouse.flags=0xC005; bool released=Native.SendInput(1,new[]{mouse},Marshal.SizeOf(typeof(Native.Input)))==1; if(released)mouseHeld=false;
   int clicks=0; for(int i=0;i<20;i++) { clicks=(int)FixtureCall(form,()=>form.Clicks); if(clicks>0)break; Thread.Sleep(25); }
   result["mouse"]=Gate(pressed&&released&&clicks==1,"Actual child fixture button click event");
   Point sentinel=(Point)FixtureCall(form,()=>form.PointToScreen(form.Sentinel));
   using(var bitmap=new Bitmap(bounds.right-bounds.left,bounds.bottom-bounds.top))using(var graphics=Graphics.FromImage(bitmap)) {
    IntPtr dc=graphics.GetHdc(); bool captured; try { captured=Native.PrintWindow(hwnd,dc,2); } finally { graphics.ReleaseHdc(dc); }
    int x=sentinel.X-bounds.left,y=sentinel.Y-bounds.top;
    bool matched=captured&&x>=0&&y>=0&&x<bitmap.Width&&y<bitmap.Height&&bitmap.GetPixel(x,y).ToArgb()==AdmissionForm.SentinelColor.ToArgb();
    result["render"]=Gate(matched,"Exact owned fixture PrintWindow sentinel pixel; general app/GPU rendering unverified");
   }
  } catch(Exception e) { result["failure"]=e.Message; }
  finally {
   if(mouseHeld) { var up=new Native.Input(); up.data.mouse.flags=4; Native.SendInput(1,new[]{up},Marshal.SizeOf(typeof(Native.Input))); }
   ReleaseHeld();
   if(form!=null)try { FixtureCall(form,delegate { form.Close(); return null; }); } catch { }
   bool closed=ui.Join(1500); result["fixtureClosed"]=Gate(closed&&!admissionFixtureActive,"Only the owned disposable fixture was closed");
   if(closed)shown.Dispose();
  }
  return result;
 }
 static int Worker(string pipeName,string challenge,int parent,string expectedHash) {
  Guard(Session!=parent && Hash(Exe)==expectedHash,"Worker must run in a different session with trusted bytes");
  using(var pipe=new NamedPipeClientStream(".",pipeName,PipeDirection.InOut,PipeOptions.None,TokenImpersonationLevel.Impersonation)) {
   pipe.Connect(20000);
   using(var reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true)) using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true)) {
    Write(writer,new { challenge=challenge, sid=Sid,profile=Profile,pid=Process.GetCurrentProcess().Id,sessionId=Session,created=Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString() });
    var welcome=Read(reader); Guard(Convert.ToBoolean(welcome["ok"])&&SameSecret(Text(welcome,"challenge"),challenge)&&Number(welcome,"childSessionId")==Session&&Number(welcome,"parentSessionId")==parent,"Parent admission rejected");
    var fixture=RunAdmissionFixture(parent);
    platformAdmitted=Passed(fixture["render"])&&Passed(fixture["keyboard"])&&Passed(fixture["mouse"])&&Passed(fixture["fixtureClosed"]);
    Write(writer,fixture);
    try {
     while(true) {
      var request=Read(reader,0);
      try { Write(writer,Handle(request)); } catch(Exception e) { ReleaseHeld(); Write(writer,Failure(e)); }
     }
    } finally { ReleaseHeld(); }
   }
  }
 }
 static AppIdentity Target(Dictionary<string,object> request) {
  int pid=Number(request,"pid"); AppIdentity app; Guard(Apps.TryGetValue(pid,out app),"Application is not owned");
  using(var p=Process.GetProcessById(pid)) Guard(p.SessionId==Session&&p.StartTime.ToUniversalTime().Ticks.ToString()==app.created,"Application process identity changed");
  Guard(Text(request,"created")==app.created&&Text(request,"hwnd")==app.hwnd.ToInt64().ToString(),"Window observation identity changed");
  uint owner; Native.GetWindowThreadProcessId(app.hwnd,out owner); Guard(owner==pid&&Native.IsWindow(app.hwnd),"Window ownership changed");
  return app;
 }
 static object Handle(Dictionary<string,object> request) {
  if(Text(request,"operation")!="input")return HandleCore(request);
  var attempt=new InputAttempt();
  try { return HandleCore(request,attempt); }
  catch(Exception e) {
   bool released=ReleaseHeld();
   return InputFailure(e,attempt,released);
  }
 }
 class InputAttempt { internal bool deliveryAttempted; internal string outcome="not_executed"; }
 static object InputFailure(Exception e,InputAttempt attempt,bool released) {
  var result=new Dictionary<string,object> { {"ok",false},{"code",attempt.deliveryAttempted?"native_child_input_delivery_failed":"native_child_input_precondition"},
   {"message",e.Message},{"hresult",e.HResult},{"mutationOutcome",attempt.outcome},{"inputReleaseConfirmed",released} };
  if(attempt.outcome=="not_executed")result["actionExecuted"]=false;
  return result;
 }
 static object HandleCore(Dictionary<string,object> request,InputAttempt attempt=null) {
  string operation=Text(request,"operation");
  if(operation=="launch"||operation=="capture"||operation=="input")Guard(platformAdmitted,"Child platform admission did not pass");
  if(operation=="releaseInput") { bool released=ReleaseHeld(); return new { ok=released,inputReleased=released,heldInput=HasHeldInput(),sessionId=Session }; }
  if(operation=="status") {
   bool live=HasLiveApps(); var windows=UnownedWindows(); windows.AddRange(UnownedProcesses()); if(admissionFixtureActive)windows.Add("Owned admission fixture closure remains unconfirmed");
   return new { ok=true,state="running",sessionId=Session,ownershipVerified=true,pendingWork=false,
    directUser=false,unsavedWork=live,unknownState=live||windows.Count>0,unrelatedApps=windows.Count>0,
    pendingUserDecision=live||windows.Count>0,heldInput=HasHeldInput(),
    processesStopped=false,logoffConfirmed=false,reasons=windows };
  }
  if(operation=="launch") {
   string executable=Text(request,"executable"); Guard(Path.IsPathRooted(executable)&&File.Exists(executable),"Absolute existing executable required");
   Guard(Hash(executable)==Text(request,"sha256"),"Approved executable hash mismatch");
   // Host approval owns app selection. Shell execution and arbitrary worker/shell replacement are excluded.
   var process=Process.Start(new ProcessStartInfo(executable) { UseShellExecute=false, WorkingDirectory=Path.GetDirectoryName(executable) });
   Guard(process!=null&&process.SessionId==Session,"App launch escaped child session");
   var app=new AppIdentity { pid=process.Id,created=process.StartTime.ToUniversalTime().Ticks.ToString(),executable=executable };
   Apps[app.pid]=app;
   for(int i=0;i<50&&!process.HasExited;i++) { process.Refresh(); app.hwnd=process.MainWindowHandle; if(app.hwnd!=IntPtr.Zero)break; Thread.Sleep(100); }
   Guard(app.hwnd!=IntPtr.Zero&&!process.HasExited,"App did not establish an owned child window; possible single-instance/profile conflict");
   return new { ok=true,pid=app.pid,created=app.created,hwnd=app.hwnd.ToInt64().ToString(),sessionId=Session,executable=app.executable };
  }
  if(operation=="prepareStop") {
   bool released=ReleaseHeld();
   // A generic worker cannot establish that an application has no unsaved data.
   // Applications must already have been saved and closed through the approved app workflow.
   Thread.Sleep(300);
   var reasons=new List<string>();
   if(!released)reasons.Add("Tracked child input release remains unconfirmed");
   foreach(var app in Apps.Values) { try { using(var p=Process.GetProcessById(app.pid)) if(p.StartTime.ToUniversalTime().Ticks.ToString()==app.created) reasons.Add("Owned application still running; save/close decision required: "+app.pid); } catch(ArgumentException) {} }
   reasons.AddRange(UnownedWindows());
   reasons.AddRange(UnownedProcesses());
   if(admissionFixtureActive)reasons.Add("Owned admission fixture closure remains unconfirmed");
   return new { ok=reasons.Count==0,safe=reasons.Count==0,state=reasons.Count==0?"safe_to_logoff":"cleanup_deferred",reasons=reasons };
  }
  var target=Target(request);
  if(operation=="capture") {
   Native.Rect rect; Guard(Native.GetWindowRect(target.hwnd,out rect),"Window bounds unavailable");
   int width=rect.right-rect.left,height=rect.bottom-rect.top; Guard(width>0&&height>0&&width<=8192&&height<=8192&&(long)width*height<=16777216,"Invalid capture bounds");
   Guard(!Native.IsIconic(target.hwnd),"Minimized child window cannot be captured");
   using(var bitmap=new Bitmap(width,height)) using(var graphics=Graphics.FromImage(bitmap)) using(var stream=new MemoryStream()) {
    IntPtr dc=graphics.GetHdc();
    try { Guard(Native.PrintWindow(target.hwnd,dc,2),"Application content capture failed; no screen-copy fallback"); }
    finally { graphics.ReleaseHdc(dc); }
    bitmap.Save(stream,ImageFormat.Png);
    Guard(stream.Length<=8*1024*1024,"Capture exceeds bounded transport payload");
    return new { ok=true,png=Convert.ToBase64String(stream.ToArray()),width=width,height=height,sessionId=Session,contentVerified=false };
   }
  }
  Guard(operation=="input","Unknown worker operation");
  Guard(HeldUnicode.Count==0,"Previous Unicode input release remains unconfirmed");
  Native.SetForegroundWindow(target.hwnd); Guard(Native.GetForegroundWindow()==target.hwnd,"Child target could not receive focus");
  Native.Input item=new Native.Input(); string kind=Text(request,"kind");
  if(kind=="text") {
   string text=Text(request,"text"); Guard(text.Length>0&&text.Length<=8192,"Text input must contain 1..8192 UTF-16 units");
   var inputs=new List<Native.Input>();
   foreach(char unit in text) { var down=new Native.Input(); down.type=1; down.data.keyboard.scan=unit; down.data.keyboard.flags=4; inputs.Add(down); var up=down; up.data.keyboard.flags=6; inputs.Add(up); }
   foreach(char unit in text)HeldUnicode.Add(unit);
   attempt.deliveryAttempted=true; attempt.outcome="unknown";
   uint sent=Native.SendInput((uint)inputs.Count,inputs.ToArray(),Marshal.SizeOf(typeof(Native.Input)));
   RecordTextDelivery(inputs,sent,attempt);
   if(sent!=inputs.Count) {
    throw new InvalidOperationException("Child text delivery incomplete: "+sent+"/"+inputs.Count);
   }
   return new { ok=true,delivered=true,readbackVerified=false,sessionId=Session };
  }
  if(kind=="key") {
   int scan=Number(request,"scanCode"); string action=Text(request,"action");
   Guard(scan>0&&scan<=255&&(action=="up"||action=="down"),"Invalid scan code/action");
   item.type=1; item.data.keyboard.scan=(ushort)scan; item.data.keyboard.flags=8u|(action=="up"?2u:0u)|(Text(request,"extended").ToLowerInvariant()=="true"?1u:0u);
  }
  else if(kind=="mouse") {
   Native.Rect rect; Guard(Native.GetWindowRect(target.hwnd,out rect),"Window bounds unavailable");
   int x=Number(request,"x"),y=Number(request,"y"); Guard(x>=0&&y>=0&&x<rect.right-rect.left&&y<rect.bottom-rect.top,"Mouse outside approved target");
   item.type=0; item.data.mouse.dx=(rect.left+x-SystemInformation.VirtualScreen.Left)*65535/Math.Max(1,SystemInformation.VirtualScreen.Width-1); item.data.mouse.dy=(rect.top+y-SystemInformation.VirtualScreen.Top)*65535/Math.Max(1,SystemInformation.VirtualScreen.Height-1);
   string action=Text(request,"action"),name=Text(request,"button");
   uint down=name=="right"?8u:name=="middle"?32u:name=="left"||name==""?2u:UInt32.MaxValue;
   Guard(down!=UInt32.MaxValue,"Unsupported mouse button");
   uint button=action=="down"?down:action=="up"?down*2:action=="move"?0u:action=="wheel"?0x800u:UInt32.MaxValue; Guard(button!=UInt32.MaxValue,"Unsupported mouse action");
   if(action=="wheel") { int delta=Number(request,"delta"); Guard(delta>=-12000&&delta<=12000,"Wheel delta too large"); item.data.mouse.data=unchecked((uint)delta); }
   item.data.mouse.flags=0xC001u|button;
  } else throw new InvalidOperationException("Unsupported input kind");
  // Track possible presses before crossing the native boundary, including exceptional outcomes.
  if(kind=="key"&&Text(request,"action")=="down")HeldKeys.Add((uint)item.data.keyboard.scan|((item.data.keyboard.flags&1u)<<16));
  if(kind=="mouse"&&Text(request,"action")=="down")HeldMouse|=(item.data.mouse.flags&0x3Eu)*2;
  attempt.deliveryAttempted=true; attempt.outcome="unknown";
  uint delivered=Native.SendInput(1,new[]{item},Marshal.SizeOf(typeof(Native.Input)));
  if(delivered==0)attempt.outcome="not_executed";
  Guard(delivered==1,"Child SendInput failed: "+Marshal.GetLastWin32Error());
  if(kind=="key") { uint key=(uint)item.data.keyboard.scan|((item.data.keyboard.flags&1u)<<16); if(Text(request,"action")=="down")HeldKeys.Add(key); else HeldKeys.Remove(key); }
  else if(Text(request,"action")=="down")HeldMouse|=(item.data.mouse.flags&0x3Eu)*2; else if(Text(request,"action")=="up")HeldMouse&=~(item.data.mouse.flags&0x7Cu);
  return new { ok=true,delivered=true,readbackVerified=false,sessionId=Session };
 }
 static readonly HashSet<uint> HeldKeys=new HashSet<uint>(); static readonly HashSet<uint> HeldUnicode=new HashSet<uint>(); static uint HeldMouse;
 static bool HasHeldInput() { return HeldKeys.Count>0||HeldUnicode.Count>0||HeldMouse!=0; }
 static void RecordTextDelivery(List<Native.Input> inputs,uint sent,InputAttempt attempt) {
  Guard(sent<=inputs.Count,"Invalid child text delivery count");
  HeldUnicode.Clear();
  attempt.outcome=sent==0?"not_executed":sent==inputs.Count?"executed":"partial";
  if(sent%2==1)HeldUnicode.Add(inputs[(int)sent-1].data.keyboard.scan);
 }
 static bool HasLiveApps() {
  foreach(var app in Apps.Values) { try { using(var p=Process.GetProcessById(app.pid)) if(p.StartTime.ToUniversalTime().Ticks.ToString()==app.created)return true; } catch(ArgumentException) {} }
  return false;
 }
 static bool OwnsProcess(Process process) {
  AppIdentity app; return Apps.TryGetValue(process.Id,out app)&&process.SessionId==Session&&process.StartTime.ToUniversalTime().Ticks.ToString()==app.created;
 }
 static List<string> UnownedWindows() {
  var reasons=new List<string>();
  Native.EnumWindows(delegate(IntPtr hwnd,IntPtr data) {
   var name=new StringBuilder(256); Native.GetClassName(hwnd,name,name.Capacity);
   string cls=name.ToString(); bool shell=cls=="Progman"||cls=="WorkerW"||cls=="Shell_TrayWnd"||cls=="Shell_SecondaryTrayWnd";
   if(!shell&&Native.IsWindowVisible(hwnd)) {
    uint pid; Native.GetWindowThreadProcessId(hwnd,out pid);
    try { using(var p=Process.GetProcessById((int)pid)) if(p.SessionId==Session&&!OwnsProcess(p)&&p.Id!=Process.GetCurrentProcess().Id)reasons.Add("Unowned visible window blocks logoff: "+pid); }
    catch { reasons.Add("Unknown window owner blocks logoff"); }
   }
   return true;
  },IntPtr.Zero);
  return reasons;
 }
 static List<string> UnownedProcesses() {
  var reasons=new List<string>(); IntPtr buffer=IntPtr.Zero; int count;
  if(!Native.WTSEnumerateProcesses(IntPtr.Zero,0,1,out buffer,out count)) {
   reasons.Add("Session process inventory unavailable: "+Marshal.GetLastWin32Error()); return reasons;
  }
  try {
   int size=Marshal.SizeOf(typeof(Native.WtsProcess));
   for(int i=0;i<count;i++) {
    var item=(Native.WtsProcess)Marshal.PtrToStructure(IntPtr.Add(buffer,i*size),typeof(Native.WtsProcess));
    if(item.session!=Session||item.pid==Process.GetCurrentProcess().Id)continue;
    // Other principals' Windows session infrastructure is outside this user's application ownership.
    if(item.sid==IntPtr.Zero) { reasons.Add("Session process token identity unknown: "+item.pid); continue; }
    if(new SecurityIdentifier(item.sid).Value!=Sid)continue;
    try { using(var process=Process.GetProcessById(item.pid)) {
     if(OwnsProcess(process))continue;
     string executable=process.MainModule.FileName;
     string system=Environment.GetFolderPath(Environment.SpecialFolder.System);
     string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows);
     string[] helpers={"sihost.exe","taskhostw.exe","ctfmon.exe","rdpclip.exe","RuntimeBroker.exe","ApplicationFrameHost.exe","svchost.exe","conhost.exe","dllhost.exe"};
     bool infrastructure=helpers.Any(name=>String.Equals(executable,Path.Combine(system,name),StringComparison.OrdinalIgnoreCase))
      ||String.Equals(executable,Path.Combine(windows,"explorer.exe"),StringComparison.OrdinalIgnoreCase);
     if(!infrastructure)reasons.Add("Unowned same-user process blocks logoff: "+item.pid);
    } } catch(ArgumentException) { } catch { reasons.Add("Session process identity could not be verified: "+item.pid); }
   }
  } finally { Native.WTSFreeMemory(buffer); }
  return reasons;
 }
 static bool ReleaseHeld() { return ReleaseHeld(items=>Native.SendInput((uint)items.Length,items,Marshal.SizeOf(typeof(Native.Input)))); }
 static bool ReleaseHeld(Func<Native.Input[],uint> send) {
  // Each confirmed release retires only its own tracking. Failures remain retryable.
  foreach(uint scan in HeldKeys.ToArray()) {
   var item=new Native.Input(); item.type=1; item.data.keyboard.scan=(ushort)(scan&0xFFFF); item.data.keyboard.flags=10|((scan>>16)&1);
   try { if(send(new[]{item})==1)HeldKeys.Remove(scan); } catch { }
  }
  foreach(uint unit in HeldUnicode.ToArray()) {
   var item=new Native.Input(); item.type=1; item.data.keyboard.scan=(ushort)unit; item.data.keyboard.flags=6;
   try { if(send(new[]{item})==1)HeldUnicode.Remove(unit); } catch { }
  }
  foreach(uint button in new[]{4u,16u,64u})if((HeldMouse&button)!=0) {
   var item=new Native.Input(); item.data.mouse.flags=button;
   try { if(send(new[]{item})==1)HeldMouse&=~button; } catch { }
  }
  return !HasHeldInput();
 }
 static class Native {
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSEnableChildSessions(bool enabled);
  [StructLayout(LayoutKind.Sequential)] internal struct WtsSession { internal uint id; internal IntPtr station; internal int state; }
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr buffer,out int count);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSIsChildSessionsEnabled(out bool enabled);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSGetChildSessionId(out uint id);
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool WTSQuerySessionInformation(IntPtr server,int session,int kind,out IntPtr buffer,out int bytes);
  [DllImport("advapi32.dll",SetLastError=true)] internal static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSLogoffSession(IntPtr server,uint session,bool wait);
  [StructLayout(LayoutKind.Sequential)] internal struct WtsProcess { internal int session,pid; internal IntPtr name,sid; }
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool WTSEnumerateProcesses(IntPtr server,int reserved,int version,out IntPtr buffer,out int count);
  [DllImport("wtsapi32.dll")] internal static extern void WTSFreeMemory(IntPtr memory);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(IntPtr pipe,out uint pid);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetNamedPipeServerProcessId(IntPtr pipe,out uint pid);
  [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] internal static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] internal static extern int GetWindowTextLength(IntPtr hwnd);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] internal static extern int GetClassName(IntPtr hwnd,StringBuilder name,int maximum);
  [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  internal delegate bool EnumProc(IntPtr hwnd,IntPtr data);
  [DllImport("user32.dll")] internal static extern bool EnumWindows(EnumProc proc,IntPtr data);
  [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int left,top,right,bottom; }
  [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll",SetLastError=true)] internal static extern bool PrintWindow(IntPtr hwnd,IntPtr dc,uint flags);
  [StructLayout(LayoutKind.Sequential)] internal struct Mouse { internal int dx,dy; internal uint data,flags,time; internal UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] internal struct Keyboard { internal ushort key,scan; internal uint flags,time; internal UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] internal struct InputUnion { [FieldOffset(0)] internal Mouse mouse; [FieldOffset(0)] internal Keyboard keyboard; }
  [StructLayout(LayoutKind.Sequential)] internal struct Input { internal uint type; internal InputUnion data; }
  [DllImport("user32.dll",SetLastError=true)] internal static extern uint SendInput(uint count,Input[] inputs,int size);
 }
}
