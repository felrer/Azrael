// Windows-only source backend. Compilation is preparation, not admission evidence.
// Protocol: newline JSON on stdin/stdout. Only --prepare-machine may configure an elevated machine.
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

class ChildSession {
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
 static object Failure(Exception e) { return new { ok=false, code="native_child_error", message=e.Message, hresult=e.HResult }; }
 static void Guard(bool value,string reason) { if(!value) throw new InvalidOperationException(reason); }
 static string RandomSecret() { var b=new byte[32]; using(var r=RandomNumberGenerator.Create()) r.GetBytes(b); return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant(); }
 static bool SameSecret(string a,string b) { if(a.Length!=b.Length)return false; int difference=0; for(int i=0;i<a.Length;i++)difference|=a[i]^b[i]; return difference==0; }

 [STAThread] static int Main(string[] args) {
  Console.InputEncoding=Encoding.UTF8; Console.OutputEncoding=new UTF8Encoding(false);
  try {
   if(args.Length==1&&args[0]=="--self-test") {
    Guard(Marshal.SizeOf(typeof(Native.Input))==(IntPtr.Size==8?40:28),"INPUT ABI size mismatch");
    Guard(SameSecret("abc","abc")&&!SameSecret("abc","abd")&&!SameSecret("abc","abcd"),"Secret comparison failure");
    BootstrapJournal.SelfTest(); MachineSetup.SelfTest();
    var admissionGates=new Dictionary<string,object>(); foreach(string name in new[]{"connection","render","keyboard","mouse","parentIdentity","dataProfile"})admissionGates[name]=Gate(true,"fixture");
    Guard(AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Complete admission gates rejected");
    admissionGates["keyboard"]=Gate(false,"fixture"); Guard(!AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Failed keyboard gate accepted");
    admissionGates["keyboard"]=new { passed="true" }; Guard(!AdmissionPassed(new { gates=admissionGates,fixtureClosed=Gate(true,"fixture") }),"Unknown keyboard evidence accepted");
    Console.WriteLine(Json.Serialize(new { ok=true, inputBytes=Marshal.SizeOf(typeof(Native.Input)), bootstrapJournalFixtureChecks=14,machineSetupFixtureChecks=17,admissionGateFixtureChecks=3,connected=false, configurationWritten=false })); return 0;
   }
   if(args.Length>0&&args[0]=="--prepare-machine") return MachineSetup.Prepare(args);
   Native.SetProcessDpiAwarenessContext(new IntPtr(-4));
   Guard(!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator),"Ordinary user token required");
   if(args.Length==1&&args[0]=="--request-machine-setup") { var result=MachineSetup.Request(); Console.WriteLine(Json.Serialize(result)); return Convert.ToBoolean(result["ok"])?0:1; }
   if(args.Length==1&&args[0]=="--reconcile-bootstrap") {
    var request=Read(new StreamReader(Console.OpenStandardInput(),Encoding.UTF8),0);
    Guard(Text(request,"helperSha256")==Hash(Exe),"Trusted helper content hash mismatch");
    Console.WriteLine(Json.Serialize(BootstrapJournal.Reconcile(Text(request,"bootstrapJournalPath")))); return 0;
   }
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
  static void InspectDirectory(string file) {
   ValidatePath(file,Root);
   var directory=new DirectoryInfo(Path.GetDirectoryName(file)); Guard(directory.Exists,"Machine setup directory missing");
   for(var current=directory;current!=null;current=current.Parent)Guard((current.Attributes&FileAttributes.ReparsePoint)==0,"Machine setup path cannot contain reparse points");
   var security=directory.GetAccessControl();
   Guard(security.GetOwner(typeof(SecurityIdentifier)).Value==Sid&&security.AreAccessRulesProtected,"Machine setup directory must be private and user-owned");
   Guard(security.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().All(rule=>rule.IdentityReference.Value==Sid),"Machine setup directory includes another principal");
  }
  static void InspectExistingAncestors(string directory) {
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

 sealed class BootstrapJournal : IDisposable {
  const string RegistryPath="Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
  const string Schema="azrael.windows-child-bootstrap/v1";
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
   var info=new FileInfo(file);
   Guard((info.Attributes&FileAttributes.ReparsePoint)==0&&info.Length>0&&info.Length<=16384,"Journal identity or size is uncertain");
   var access=File.GetAccessControl(file);
   Guard(access.GetOwner(typeof(SecurityIdentifier)).Value==Sid&&access.AreAccessRulesProtected,"Journal file owner or private permissions mismatch");
   Guard(access.GetAccessRules(true,true,typeof(SecurityIdentifier)).Cast<FileSystemAccessRule>().All(rule=>rule.IdentityReference.Value==Sid),"Journal permissions include another principal");
   recordText=File.ReadAllText(file,Encoding.UTF8); record=Json.Deserialize<Dictionary<string,object>>(recordText);
   ValidateRecord(record,Sid,Profile,Session,Exe,Hash(Exe));
   return true;
  }
  static void ValidateRecord(Dictionary<string,object> valueRecord,string sid,string profile,int session,string exe,string hash) {
   Guard(Text(valueRecord,"schema")==Schema&&Text(valueRecord,"sid")==sid&&Text(valueRecord,"profile")==profile&&Number(valueRecord,"parentSessionId")==session,"Bootstrap journal owner identity mismatch");
   Guard(!String.IsNullOrWhiteSpace(Text(valueRecord,"ownerId"))&&Text(valueRecord,"ownerId").Length<=256&&Number(valueRecord,"creatorPid")>0,"Bootstrap journal task or creator identity malformed");
   long created; Guard(Int64.TryParse(Text(valueRecord,"creatorCreated"),out created)&&created>0,"Bootstrap creator creation identity malformed");
   Guard(String.Equals(Text(valueRecord,"helperPath"),exe,StringComparison.OrdinalIgnoreCase)&&Text(valueRecord,"helperSha256")==hash,"Bootstrap journal helper identity mismatch");
   string name=Text(valueRecord,"runName"), value=Text(valueRecord,"runValue");
   Guard(name.StartsWith("Azrael.Child.",StringComparison.Ordinal)&&name.Length==77&&name.Substring(13).All(c=>"0123456789abcdef".IndexOf(c)>=0),"Journal RunOnce name is not an owned bootstrap identity");
   Guard(HashText(value)==Text(valueRecord,"runValueSha256"),"Journal RunOnce value hash mismatch");
   string pipe=Text(valueRecord,"pipeName"),secret=Text(valueRecord,"challenge");
   Guard(pipe.StartsWith("azrael-child-",StringComparison.Ordinal)&&pipe.Length==77&&pipe.Substring(13).All(c=>"0123456789abcdef".IndexOf(c)>=0)&&secret.Length==64&&secret.All(c=>"0123456789abcdef".IndexOf(c)>=0),"Journal bootstrap channel identity malformed");
   Guard(value=="\""+exe+"\" --worker "+pipe+" "+secret+" "+session+" "+hash,"Journal executable command identity mismatch");
  }
  public static void SelfTest() {
   string secret=new string('a',64),exe="C:\\fixture\\helper.exe",hash=new string('b',64),pipe="azrael-child-"+secret;
   string value="\""+exe+"\" --worker "+pipe+" "+secret+" 1 "+hash;
   var valid=new Dictionary<string,object> { {"schema",Schema},{"sid","fixtureSid"},{"profile","fixtureProfile"},{"parentSessionId",1},
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
  public void Create(string runName,string runValue,string pipeName,string challenge,string ownerId) {
   Guard(!String.IsNullOrWhiteSpace(ownerId)&&ownerId.Length<=256,"Bounded trusted task owner identity required");
   Guard(!JournalExists(),"Pending bootstrap journal must be reconciled before start");
   record=new Dictionary<string,object> {
    {"schema",Schema},{"sid",Sid},{"profile",Profile},{"parentSessionId",Session},{"ownerId",ownerId},
    {"creatorPid",Process.GetCurrentProcess().Id},{"creatorCreated",Process.GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()},
    {"helperPath",Exe},{"helperSha256",Hash(Exe)},{"runName",runName},{"runValue",runValue},{"runValueSha256",HashText(runValue)},
    {"pipeName",pipeName},{"challenge",challenge}
   };
   recordText=Json.Serialize(record); var bytes=new UTF8Encoding(false).GetBytes(recordText); Guard(bytes.Length<=16384,"Bootstrap journal exceeds bounded storage");
   var security=new FileSecurity(); security.SetAccessRuleProtection(true,false);
   security.SetOwner(new SecurityIdentifier(Sid)); security.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(Sid),FileSystemRights.FullControl,AccessControlType.Allow));
   using(var stream=new FileStream(file,FileMode.CreateNew,FileSystemRights.Read|FileSystemRights.Write,FileShare.None,4096,FileOptions.WriteThrough,security)) {
    stream.Write(bytes,0,bytes.Length); stream.Flush(true);
   }
   Guard(File.ReadAllText(file,Encoding.UTF8)==recordText,"Bootstrap journal write was not verified");
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
  string nonce, pipeName, runName, runValue; int child=-1,workerPid=-1; string workerCreated;
  bool started=false, disposed=false,workerTransportUncertain=false,ownershipVerified=false;
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
     var request=Read(input,0); string operation=Text(request,"operation");
     try {
      if(operation=="start") { Guard(!started,"Already started"); Start(request); bool ready=AdmissionPassed(admission); Write(output,new { ok=ready, state=ready?"admitted":"admission_failed", identity=Identity(),ownershipVerified=ownershipVerified,admission=admission,admissionReady=ready,available=ready,cleanupUnconfirmed=workerTransportUncertain }); }
      else if(operation=="stop") { var result=Stop(); Write(output,result); if(!started) { BeginInvoke((Action)Close); return; } }
      else if(workerTransportUncertain) { Write(output,new { ok=false,state="unknown",ownershipVerified=false,unknownState=true,pendingWork=false,reason="Owned child worker transport is uncertain" }); }
      else { ValidateIdentity(); Write(writer,request); Write(output,Read(reader)); }
     } catch(Exception e) { if(operation=="start"&&started)Write(output,new { ok=false,code="native_child_start_failed",message=e.Message,hresult=e.HResult,identity=Identity(),ownershipVerified=ownershipVerified,admission=admission,admissionReady=false,available=false,cleanupUnconfirmed=workerTransportUncertain }); else Write(output,Failure(e)); }
    }
   } catch(Exception) {
    // A lost host does not authorize logging off or closing unknown/unsaved work.
    try { if(pipe!=null)pipe.Dispose(); } catch {}
    BeginInvoke((Action)delegate { started=false; Close(); });
   }
  }
  object Identity() { return new { parentSessionId=Session, childSessionId=child, sid=Sid, profile=Profile, workerPid=workerPid, workerCreated=workerCreated }; }
  void Start(Dictionary<string,object> request) {
   bool enabled; Guard(Native.WTSIsChildSessionsEnabled(out enabled)&&enabled,"Child sessions not enabled; machine setup required");
   uint existing; bool found=Native.WTSGetChildSessionId(out existing); int queryError=Marshal.GetLastWin32Error();
   Guard(ChildAbsent(found,existing,queryError),"Existing or unknown child session cannot be adopted: "+queryError);
   Guard(Text(request,"helperSha256")==Hash(Exe),"Trusted helper content hash mismatch");
   using(var bootstrap=new BootstrapJournal(Text(request,"bootstrapJournalPath"))) {
   bootstrap.Prepare();
   nonce=RandomSecret(); pipeName="azrael-child-"+RandomSecret(); runName="Azrael.Child."+RandomSecret();
   var security=new PipeSecurity(); security.SetAccessRuleProtection(true,false);
   security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(Sid),PipeAccessRights.FullControl,AccessControlType.Allow));
   pipe=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security);
   runValue="\""+Exe+"\" --worker "+pipeName+" "+nonce+" "+Session+" "+Hash(Exe);
   bootstrap.Create(runName,runValue,pipeName,nonce,Text(request,"ownerId"));
   try {
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
    var waiting=pipe.BeginWaitForConnection(null,null);
    Guard(waiting.AsyncWaitHandle.WaitOne(TimeSpan.FromSeconds(40)),"Child bootstrap timed out; connection and launch are unverified");
    pipe.EndWaitForConnection(waiting);
    reader=new StreamReader(pipe,Encoding.UTF8,false,4096,true); writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true);
    var hello=Read(reader);
    Guard(SameSecret(Text(hello,"challenge"),nonce),"Worker challenge mismatch");
    Guard(Text(hello,"sid")==Sid && Text(hello,"profile")==Profile,"Worker account/profile mismatch");
    workerPid=Number(hello,"pid"); workerCreated=Text(hello,"created"); child=Number(hello,"sessionId");
    uint peerPid; Guard(Native.GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(),out peerPid)&&peerPid==workerPid,"Worker pipe peer PID mismatch");
    ValidateIdentity();
    Write(writer,new { ok=true, challenge=nonce, childSessionId=child, parentSessionId=Session });
    started=true;
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
   } finally { bootstrap.RestoreCurrent(); }
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
   Guard(!workerTransportUncertain,"Owned child worker transport is uncertain; cleanup deferred");
   ValidateIdentity(); Write(writer,new { operation="prepareStop" }); var closure=Read(reader);
   if(!closure.ContainsKey("safe") || !Convert.ToBoolean(closure["safe"]))return closure;
   ValidateIdentity();
   Guard(Native.WTSLogoffSession(IntPtr.Zero,(uint)child,true),"Owned child logoff failed: "+Marshal.GetLastWin32Error());
   uint current; bool found=Native.WTSGetChildSessionId(out current); int logoffQueryError=Marshal.GetLastWin32Error();
   Guard(ChildAbsent(found,current,logoffQueryError),"Child logoff not verified: "+logoffQueryError);
   try { using(var p=Process.GetProcessById(workerPid)) Guard(p.StartTime.ToUniversalTime().Ticks.ToString()!=workerCreated,"Worker termination not verified"); } catch(ArgumentException) {}
   started=false; return new { ok=true, state="closed", identity=Identity(), ownershipVerified=true,
    processesStopped=true,logoffConfirmed=true,pendingWork=false,directUser=false,unsavedWork=false,
    unknownState=false,unrelatedApps=false,pendingUserDecision=false,heldInput=false };
  }
  protected override void Dispose(bool disposing) {
   if(!disposed) { disposed=true; if(pipe!=null)pipe.Dispose(); }
   base.Dispose(disposing);
  }
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
  string operation=Text(request,"operation");
  if(operation=="launch"||operation=="capture"||operation=="input")Guard(platformAdmitted,"Child platform admission did not pass");
  if(operation=="releaseInput") { ReleaseHeld(); return new { ok=true,sessionId=Session }; }
  if(operation=="status") {
   bool live=HasLiveApps(); var windows=UnownedWindows(); windows.AddRange(UnownedProcesses()); if(admissionFixtureActive)windows.Add("Owned admission fixture closure remains unconfirmed");
   return new { ok=true,state="running",sessionId=Session,ownershipVerified=true,pendingWork=false,
    directUser=false,unsavedWork=live,unknownState=live||windows.Count>0,unrelatedApps=windows.Count>0,
    pendingUserDecision=live||windows.Count>0,heldInput=HeldKeys.Count>0||HeldMouse!=0,
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
   ReleaseHeld();
   // A generic worker cannot establish that an application has no unsaved data.
   // Applications must already have been saved and closed through the approved app workflow.
   Thread.Sleep(300);
   var reasons=new List<string>();
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
  Native.SetForegroundWindow(target.hwnd); Guard(Native.GetForegroundWindow()==target.hwnd,"Child target could not receive focus");
  Native.Input item=new Native.Input(); string kind=Text(request,"kind");
  if(kind=="text") {
   string text=Text(request,"text"); Guard(text.Length>0&&text.Length<=8192,"Text input must contain 1..8192 UTF-16 units");
   var inputs=new List<Native.Input>();
   foreach(char unit in text) { var down=new Native.Input(); down.type=1; down.data.keyboard.scan=unit; down.data.keyboard.flags=4; inputs.Add(down); var up=down; up.data.keyboard.flags=6; inputs.Add(up); }
   uint sent=Native.SendInput((uint)inputs.Count,inputs.ToArray(),Marshal.SizeOf(typeof(Native.Input)));
   if(sent!=inputs.Count) {
    // A partial batch may end between a Unicode press and release. Release only, in this child.
    var releases=inputs.Where((packet,index)=>index%2==1).ToArray();
    Native.SendInput((uint)releases.Length,releases,Marshal.SizeOf(typeof(Native.Input)));
    throw new InvalidOperationException("Child text delivery incomplete; release attempted");
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
  Guard(Native.SendInput(1,new[]{item},Marshal.SizeOf(typeof(Native.Input)))==1,"Child SendInput failed: "+Marshal.GetLastWin32Error());
  if(kind=="key") { uint key=(uint)item.data.keyboard.scan|((item.data.keyboard.flags&1u)<<16); if(Text(request,"action")=="down")HeldKeys.Add(key); else HeldKeys.Remove(key); }
  else if(Text(request,"action")=="down")HeldMouse|=(item.data.mouse.flags&0x3Eu)*2; else if(Text(request,"action")=="up")HeldMouse&=~(item.data.mouse.flags&0x7Cu);
  return new { ok=true,delivered=true,readbackVerified=false,sessionId=Session };
 }
 static readonly HashSet<uint> HeldKeys=new HashSet<uint>(); static uint HeldMouse;
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
 static void ReleaseHeld() {
  var release=new List<Native.Input>();
  foreach(uint scan in HeldKeys) { var item=new Native.Input(); item.type=1; item.data.keyboard.scan=(ushort)(scan&0xFFFF); item.data.keyboard.flags=10|((scan>>16)&1); release.Add(item); }
  if(HeldMouse!=0) { var item=new Native.Input(); item.data.mouse.flags=HeldMouse; release.Add(item); }
  if(release.Count>0)Native.SendInput((uint)release.Count,release.ToArray(),Marshal.SizeOf(typeof(Native.Input)));
  HeldKeys.Clear(); HeldMouse=0;
 }
 static class Native {
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSEnableChildSessions(bool enabled);
  [StructLayout(LayoutKind.Sequential)] internal struct WtsSession { internal uint id; internal IntPtr station; internal int state; }
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool WTSEnumerateSessions(IntPtr server,int reserved,int version,out IntPtr buffer,out int count);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSIsChildSessionsEnabled(out bool enabled);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSGetChildSessionId(out uint id);
  [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSLogoffSession(IntPtr server,uint session,bool wait);
  [StructLayout(LayoutKind.Sequential)] internal struct WtsProcess { internal int session,pid; internal IntPtr name,sid; }
  [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] internal static extern bool WTSEnumerateProcesses(IntPtr server,int reserved,int version,out IntPtr buffer,out int count);
  [DllImport("wtsapi32.dll")] internal static extern void WTSFreeMemory(IntPtr memory);
  [DllImport("kernel32.dll",SetLastError=true)] internal static extern bool GetNamedPipeClientProcessId(IntPtr pipe,out uint pid);
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
