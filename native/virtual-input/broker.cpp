#include "broker.hpp"
#include <filesystem>
#include <set>
#include <algorithm>
#include <cctype>

namespace vi {
namespace {
[[noreturn]] void Reject(const char* message){throw Failure("invalid_request",message);}
void Fields(const Json& j,std::initializer_list<const char*> allowed,std::initializer_list<const char*> required={}){
  if(!j.is_object())Reject("Expected object");
  for(auto it=j.begin();it!=j.end();++it){bool found=false;for(auto key:allowed)if(it.key()==key)found=true;if(!found)Reject("Unknown field");}
  for(auto key:required)if(!j.contains(key))Reject("Missing field");
}
int Integer(const Json& j,int low,int high){if(!j.is_number_integer())Reject("Expected integer");if(j<low||j>high)Reject("Integer outside permitted range");return j.get<int>();}
uint64_t ParseHex(const Json& j){
  if(!j.is_string())Reject("Expected nonzero hexadecimal string");
  const auto& s=j.get_ref<const std::string&>();size_t start=(s.size()>2&&s[0]=='0'&&(s[1]=='x'||s[1]=='X'))?2:0;
  if(s.size()==start||s.size()-start>16)Reject("Invalid hexadecimal string");
  uint64_t value=0;for(size_t i=start;i<s.size();++i){char c=s[i];int n=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;if(n<0)Reject("Invalid hexadecimal string");value=(value<<4)|n;}
  if(!value)Reject("Zero identity is not permitted");return value;
}
std::string String(const Json& j){if(!j.is_string())Reject("Expected string");auto s=j.get<std::string>();Wide(s);if(s.find('\0')!=std::string::npos)Reject("Embedded NUL is not permitted");return s;}
std::vector<BYTE> TokenData(HANDLE token,TOKEN_INFORMATION_CLASS kind){DWORD size=0;GetTokenInformation(token,kind,nullptr,0,&size);if(!size)throw Failure("access_denied","Cannot query token");std::vector<BYTE> b(size);if(!GetTokenInformation(token,kind,b.data(),size,&size))throw Failure("access_denied","Cannot read token");return b;}
void Security(HANDLE process,DWORD pid){
  if(pid==GetCurrentProcessId())throw Failure("access_denied","Cannot attach broker itself");
  Handle local,target;HANDLE token=nullptr;
  if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))throw Failure("access_denied","Cannot inspect controller token");local.reset(token);
  if(!OpenProcessToken(process,TOKEN_QUERY,&token))throw Failure("access_denied","Cannot inspect target token");target.reset(token);
  auto user=TokenData(local.h,TokenUser),other=TokenData(target.h,TokenUser);
  if(!EqualSid(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid,reinterpret_cast<TOKEN_USER*>(other.data())->User.Sid))throw Failure("access_denied","Target user differs");
  DWORD ownSession=0,session=0;
  if(!ProcessIdToSessionId(GetCurrentProcessId(),&ownSession)||!ProcessIdToSessionId(pid,&session)||session!=ownSession||session==0)throw Failure("access_denied","Target is not in controller interactive session");
  for(HANDLE t:{local.h,target.h}){
    auto integrity=TokenData(t,TokenIntegrityLevel);PSID sid=reinterpret_cast<TOKEN_MANDATORY_LABEL*>(integrity.data())->Label.Sid;
    DWORD level=*GetSidSubAuthority(sid,*GetSidSubAuthorityCount(sid)-1);
    auto elevated=TokenData(t,TokenElevation),ui=TokenData(t,TokenUIAccess);
    if(level!=SECURITY_MANDATORY_MEDIUM_RID||reinterpret_cast<TOKEN_ELEVATION*>(elevated.data())->TokenIsElevated||*reinterpret_cast<DWORD*>(ui.data()))throw Failure("access_denied","Only ordinary medium-integrity non-UIAccess processes are allowed");
  }
  USHORT machine=0,native=0;
  if(!IsWow64Process2(process,&machine,&native)||machine!=IMAGE_FILE_MACHINE_UNKNOWN||native!=IMAGE_FILE_MACHINE_AMD64)throw Failure("unsupported_target","Target must be native Windows x64");
  PROCESS_PROTECTION_LEVEL_INFORMATION protection{};
  if(!GetProcessInformation(process,ProcessProtectionLevelInfo,&protection,sizeof(protection))||protection.ProtectionLevel!=PROTECTION_LEVEL_NONE)throw Failure("access_denied","Protected or unqueryable target");
}
void Deny(const std::wstring& executable){
  auto name=std::filesystem::path(executable).filename().wstring();std::transform(name.begin(),name.end(),name.begin(),[](wchar_t c){return wchar_t(towlower(c));});
  const std::set<std::wstring> names={L"system",L"registry",L"smss.exe",L"csrss.exe",L"wininit.exe",L"services.exe",L"lsass.exe",L"winlogon.exe",L"svchost.exe",L"dwm.exe",L"sihost.exe",L"fontdrvhost.exe",L"explorer.exe",L"cmd.exe",L"powershell.exe",L"pwsh.exe",L"conhost.exe",L"openconsole.exe",L"windowsterminal.exe",L"wt.exe",L"bash.exe",L"wsl.exe",L"mintty.exe",L"ssh.exe",L"consent.exe",L"credentialuibroker.exe",L"logonui.exe",L"runtimebroker.exe",L"securityhealthservice.exe",L"securityhealthsystray.exe",L"msmpeng.exe",L"mssense.exe",L"taskmgr.exe",L"code.exe",L"code - insiders.exe",L"1password.exe",L"bitwarden.exe",L"keepass.exe",L"keepassxc.exe"};
  bool fixture=name==L"azrael-virtual-input-fixture.exe";
  if(names.count(name)||(!fixture&&(name.find(L"azrael")!=std::wstring::npos||name.find(L"codex")!=std::wstring::npos))||name.find(L"security")!=std::wstring::npos||name.find(L"credential")!=std::wstring::npos||name.find(L"antivirus")!=std::wstring::npos)throw Failure("access_denied","Executable is excluded from virtual input");
}
uintptr_t RemoteFunction(DWORD pid,const char* name){
  FARPROC function=GetProcAddress(GetModuleHandleW(L"kernel32.dll"),name);HMODULE module=nullptr;
  if(!function||!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,reinterpret_cast<LPCWSTR>(function),&module))throw Failure("injection_failed","Cannot resolve system function");
  wchar_t path[32768];DWORD n=GetModuleFileNameW(module,path,32768);if(!n||n>=32768)throw Failure("injection_failed","Cannot resolve system module");
  auto remote=Module(pid,std::filesystem::path(path).filename().wstring(),false);if(!remote)throw Failure("injection_failed","System module is absent from target");
  return remote+(reinterpret_cast<uintptr_t>(function)-reinterpret_cast<uintptr_t>(module));
}
DWORD RemoteCall(HANDLE process,uintptr_t address,void* parameter){
  Handle thread(CreateRemoteThread(process,nullptr,0,reinterpret_cast<LPTHREAD_START_ROUTINE>(address),parameter,0,nullptr));
  if(!thread)throw Failure("injection_failed","Cannot create target initialization thread");
  DWORD wait=WaitForSingleObject(thread.h,kTimeout);
  if(wait!=WAIT_OBJECT_0)throw Failure("timeout","Remote thread outcome unknown; no retry","unknown");
  DWORD result=0;if(!GetExitCodeThread(thread.h,&result))throw Failure("injection_failed","Cannot inspect remote initialization","unknown");return result;
}
class RemoteMemory {
  HANDLE process;bool retain=false;
public:
  void* address;
  RemoteMemory(HANDLE p,size_t size):process(p),address(VirtualAllocEx(p,nullptr,size,MEM_COMMIT|MEM_RESERVE,PAGE_READWRITE)){if(!address)throw Failure("injection_failed","Cannot allocate configuration");}
  ~RemoteMemory(){if(!retain)VirtualFreeEx(process,address,0,MEM_RELEASE);}
  void ambiguous(){retain=true;}
  void write(const void* data,size_t size){SIZE_T n=0;if(!WriteProcessMemory(process,address,data,size,&n)||n!=size)throw Failure("injection_failed","Cannot write configuration");}
};
} // namespace

void Broker::validate(){
  if(!process_||WaitForSingleObject(process_.h,0)!=WAIT_TIMEOUT)throw Failure("stale_target","Target process exited");
  DWORD pid=0;
  if(!IsWindow(window_)||GetAncestor(window_,GA_ROOT)!=window_||GetWindowThreadProcessId(window_,&pid)!=thread_||pid!=pid_||Creation(process_.h)!=created_||_wcsicmp(Executable(process_.h).c_str(),executable_.c_str()))throw Failure("stale_target","Target identity changed");
  if(!IsWindowVisible(window_)||IsIconic(window_))throw Failure("unsupported_target","Requires a visible unminimized bound top-level window");
  Security(process_.h,pid_);Deny(executable_);
}
void Broker::attach(const Json& params){
  Fields(params,{"window"},{"window"});const auto& w=params.at("window");Fields(w,{"hwnd","pid","processCreated","executable"},{"hwnd","pid","processCreated","executable"});
  if(process_)throw Failure("already_attached","Detach previous session first");
  uint64_t raw=ParseHex(w.at("hwnd")),created=ParseHex(w.at("processCreated"));
  if(!w.at("pid").is_number_integer()||w.at("pid")<1||w.at("pid")>UINT32_MAX)Reject("Invalid process ID");
  std::wstring path=Wide(String(w.at("executable")));if(!std::filesystem::path(path).is_absolute())Reject("Executable must be an absolute path");
  DWORD pid=w.at("pid").get<DWORD>();
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|PROCESS_CREATE_THREAD|PROCESS_VM_OPERATION|PROCESS_VM_WRITE|PROCESS_VM_READ|PROCESS_DUP_HANDLE|SYNCHRONIZE,FALSE,pid));
  if(!process)throw Failure("access_denied","Cannot open approved target without elevation");
  window_=reinterpret_cast<HWND>(raw);pid_=pid;thread_=GetWindowThreadProcessId(window_,nullptr);created_=created;executable_=path;process_=std::move(process);
  try{validate();}catch(...){release();throw;}
  dll_=Sibling(L"azrael-virtual-input-hook.dll");
  // Read only to obtain the export RVA; DllMain is not run in the broker.
  HMODULE local=LoadLibraryExW(dll_.c_str(),nullptr,DONT_RESOLVE_DLL_REFERENCES);
  if(!local){release();throw Failure("missing_component","Fixed sibling hook DLL cannot be loaded");}
  auto init=GetProcAddress(local,"Initialize");uintptr_t rva=init?reinterpret_cast<uintptr_t>(init)-reinterpret_cast<uintptr_t>(local):0;FreeLibrary(local);
  if(!rva){release();throw Failure("missing_component","Hook initialization export missing");}
  if(Module(pid_,dll_)){release();throw Failure("already_attached","A hook module already exists in this target");}
  try{
    mapping_.reset(CreateFileMappingW(INVALID_HANDLE_VALUE,nullptr,PAGE_READWRITE,0,sizeof(Packet),nullptr));request_.reset(CreateEventW(nullptr,FALSE,FALSE,nullptr));ack_.reset(CreateEventW(nullptr,FALSE,FALSE,nullptr));
    if(!mapping_||!request_||!ack_)throw Failure("resource_error","Cannot create private transport");
    packet_=static_cast<Packet*>(MapViewOfFile(mapping_.h,FILE_MAP_ALL_ACCESS,0,0,sizeof(Packet)));if(!packet_)throw Failure("resource_error","Cannot map transport");new(packet_)Packet{};
    // The target is rechecked immediately before the first mutating operation.
    validate();
    RemoteMemory remotePath(process_.h,(dll_.size()+1)*sizeof(wchar_t));remotePath.write(dll_.c_str(),(dll_.size()+1)*sizeof(wchar_t));
    try{RemoteCall(process_.h,RemoteFunction(pid_,"LoadLibraryW"),remotePath.address);}catch(const Failure& f){if(f.outcome=="unknown")remotePath.ambiguous();throw;}
    module_=Module(pid_,dll_);if(!module_)throw Failure("injection_failed","Hook DLL was not loaded");
    Config cfg;cfg.window=reinterpret_cast<uint64_t>(window_);cfg.pid=pid_;cfg.thread=thread_;cfg.created=created_;
    Handle controller(OpenProcess(SYNCHRONIZE,FALSE,GetCurrentProcessId()));
    if(!controller)throw Failure("resource_error","Cannot create controller death monitor");
    HANDLE duplicates[4]{};HANDLE sources[]={mapping_.h,request_.h,ack_.h,controller.h};
    RemoteMemory remoteConfig(process_.h,sizeof(cfg));
    auto closeDuplicates=[&](){for(HANDLE& h:duplicates)if(h){HANDLE copy=nullptr;if(DuplicateHandle(process_.h,h,GetCurrentProcess(),&copy,0,FALSE,DUPLICATE_CLOSE_SOURCE|DUPLICATE_SAME_ACCESS))CloseHandle(copy);h=nullptr;}};
    for(int i=0;i<4;++i)if(!DuplicateHandle(GetCurrentProcess(),sources[i],process_.h,&duplicates[i],0,FALSE,DUPLICATE_SAME_ACCESS)){closeDuplicates();throw Failure("resource_error","Cannot duplicate private transport handles");}
    cfg.mapping=reinterpret_cast<uint64_t>(duplicates[0]);cfg.request=reinterpret_cast<uint64_t>(duplicates[1]);cfg.ack=reinterpret_cast<uint64_t>(duplicates[2]);cfg.controller=reinterpret_cast<uint64_t>(duplicates[3]);
    try{remoteConfig.write(&cfg,sizeof(cfg));DWORD result=RemoteCall(process_.h,module_+rva,remoteConfig.address);
      if(result!=ERROR_SUCCESS){closeDuplicates();throw Failure("injection_failed","Hook worker initialization rejected");}
      initialized_=true;
    }catch(const Failure& f){if(f.outcome=="unknown"){remoteConfig.ambiguous();initialized_=true;}else closeDuplicates();throw;}
    if(WaitForSingleObject(ack_.h,kTimeout)!=WAIT_OBJECT_0)throw Failure("timeout","Hook readiness outcome unknown","unknown");
    if(packet_->ready!=1)throw Failure("injection_failed",Utf8(packet_->error));
    validate();
  }catch(const Failure& f){
    // Once a remote thread's completion is unknown, all further mutations stop.
    if(f.outcome=="unknown"){poisoned_=ambiguous_=true;throw;}
    try{detach();}catch(...){poisoned_=true;throw Failure("cleanup_incomplete","Attach failed and cleanup could not be confirmed","unknown");}
    throw;
  }catch(...){poisoned_=ambiguous_=true;throw;}
}
void Broker::command(Op op,int x,int y,int value,const std::wstring& text){
  if(!process_||!initialized_||!packet_)throw Failure("not_attached","No initialized attachment");
  if(poisoned_)throw Failure("session_disabled","Ambiguous previous operation; detach required","unknown");
  try{validate();}catch(...){poisoned_=true;throw;}
  packet_->op=op;packet_->x=x;packet_->y=y;packet_->value=value;packet_->textLength=static_cast<uint32_t>(text.size());
  if(!text.empty())memcpy(packet_->text,text.data(),text.size()*sizeof(wchar_t));
  packet_->sequence=++sequence_;ResetEvent(ack_.h);MemoryBarrier();
  if(!SetEvent(request_.h)||WaitForSingleObject(ack_.h,kTimeout+1000)!=WAIT_OBJECT_0||packet_->completed!=sequence_){poisoned_=ambiguous_=true;throw Failure("timeout","Command outcome unknown; no retry","unknown");}
  if(packet_->outcome!=Outcome::Ok){if(packet_->outcome==Outcome::Unknown)poisoned_=true;throw Failure("input_failed",Utf8(packet_->error),packet_->outcome==Outcome::Unknown?"unknown":"none");}
}
Json Broker::status(){
  if(!process_)return {{"attached",false}};
  if(poisoned_)return {{"attached",false},{"cleanupPending",true},{"mutationOutcome","unknown"}};
  command(Op::Status);return snapshot();
}
Json Broker::snapshot(){
  Json held=Json::array();for(int i=1;i<256;++i)if(packet_->keys[i]&0x80)held.push_back(i);
  POINT local=packet_->position;ScreenToClient(window_,&local);
  POINT origin{0,0};ClientToScreen(window_,&origin);
  wchar_t recipientClass[256]{};
  HWND recipient=reinterpret_cast<HWND>(packet_->lastRecipient);
  if(recipient)GetClassNameW(recipient,recipientClass,256);
  Json delivery={{"model","synchronous-window-messages"},{"applicationEffectVerified",false},
    {"messageCount",packet_->deliveredMessages},{"lastMessage",packet_->lastMessage},
    {"lastResult",packet_->lastMessageResult},{"recipientHwnd",Hex(packet_->lastRecipient)},
    {"recipientClass",Utf8(recipientClass)}};
  return {{"attached",true},{"deliveryDiagnostics",delivery},{"position",{{"x",local.x},{"y",local.y},{"screenX",packet_->position.x},{"screenY",packet_->position.y}}},{"heldKeys",held},{"heldButtons",{{"left",bool(packet_->keys[VK_LBUTTON]&0x80)},{"right",bool(packet_->keys[VK_RBUTTON]&0x80)},{"middle",bool(packet_->keys[VK_MBUTTON]&0x80)}}},{"window",{{"hwnd",Hex(reinterpret_cast<uint64_t>(window_))},{"pid",pid_},{"processCreated",Hex(created_)},{"executable",Utf8(executable_)}}},{"client",{{"x",origin.x},{"y",origin.y},{"width",packet_->client.right},{"height",packet_->client.bottom},{"coordinateSpace","physical-client-pixels"}}}};
}
void Broker::detach(){
  if(!process_)return;
  if(WaitForSingleObject(process_.h,0)==WAIT_OBJECT_0){release();return;}
  if(ambiguous_&&!Module(pid_,dll_)){release();return;}
  if(initialized_){
    if(!packet_)throw Failure("cleanup_incomplete","No mapped cleanup channel","unknown");
    if(packet_->cleanup!=1){
      if(ambiguous_)throw Failure("cleanup_incomplete","An operation may still be in flight; controller exit required","unknown");
      packet_->op=Op::Detach;packet_->sequence=++sequence_;ResetEvent(ack_.h);MemoryBarrier();SetEvent(request_.h);
      if(WaitForSingleObject(ack_.h,15000)!=WAIT_OBJECT_0||packet_->cleanup!=1){poisoned_=true;throw Failure("cleanup_incomplete","Worker cleanup/unload not confirmed","unknown");}
    }
  }else if(module_){RemoteCall(process_.h,RemoteFunction(pid_,"FreeLibrary"),reinterpret_cast<void*>(module_));}
  ULONGLONG start=GetTickCount64();
  while(Module(pid_,dll_)){if(GetTickCount64()-start>kTimeout){poisoned_=true;throw Failure("cleanup_incomplete","Hook DLL remains loaded","unknown");}Sleep(10);}
  release();
}
void Broker::release(){if(packet_){UnmapViewOfFile(packet_);packet_=nullptr;}ack_.reset();request_.reset();mapping_.reset();process_.reset();window_=nullptr;pid_=thread_=0;created_=0;module_=0;initialized_=poisoned_=ambiguous_=false;sequence_=0;}
Broker::~Broker(){try{detach();}catch(...){}release();}
Json Broker::invoke(const Json& request){
  Json id=nullptr;
  try{
    Fields(request,{"id","method","params"},{"id","method","params"});id=request.at("id");
    if(!id.is_null()&&!id.is_string()&&!id.is_number_integer())Reject("ID must be string, integer or null");
    std::string method=String(request.at("method"));const auto& params=request.at("params");
    Json result;
    if(method=="attach"){attach(params);result=status();}
    else if(method=="status"){Fields(params,{});result=status();}
    else if(method=="detach"){Fields(params,{});detach();result={{"attached",false},{"unloaded",true}};}
    else if(method=="shutdown"){Fields(params,{});detach();shutdown=true;result={{"shutdown",true}};}
    else if(method=="input"){
      if(!params.is_object()||!params.contains("kind"))Reject("Input kind required");std::string kind=String(params.at("kind"));
      if(kind=="text"){Fields(params,{"kind","text"},{"kind","text"});std::wstring text=Wide(String(params.at("text")));if(text.size()>=kTextCapacity)Reject("Text exceeds 2047 UTF-16 units");command(Op::Text,0,0,0,text);}
      else if(kind=="key"){Fields(params,{"kind","virtualKey","action"},{"kind","virtualKey","action"});int key=Integer(params.at("virtualKey"),1,255);std::string action=String(params.at("action"));if(action!="down"&&action!="up")Reject("Invalid key action");command(action=="down"?Op::KeyDown:Op::KeyUp,0,0,key);}
      else if(kind=="mouse"){
        Fields(params,{"kind","action","x","y","button","delta"},{"kind","action"});std::string action=String(params.at("action"));
        bool move=action=="move",button=action=="down"||action=="up",wheel=action=="wheel";
        if(!move&&!button&&!wheel)Reject("Invalid mouse action");
        if((params.contains("button")&&!button)||(params.contains("delta")&&!wheel))Reject("Field does not apply to mouse action");
        if(move&&(!params.contains("x")||!params.contains("y")))Reject("Move requires x and y");
        if(params.contains("x")!=params.contains("y"))Reject("Coordinates must be supplied together");
        int x=0,y=0;
        if(params.contains("x")){x=Integer(params.at("x"),0,32767);y=Integer(params.at("y"),0,32767);}
        else {auto s=status();if(!s.value("attached",false))throw Failure("not_attached","No usable attachment");x=s.at("position").at("x").get<int>();y=s.at("position").at("y").get<int>();}
        int value=0;
        if(button){if(!params.contains("button"))Reject("Mouse button required");auto b=String(params.at("button"));if(b!="left"&&b!="right"&&b!="middle")Reject("Invalid mouse button");value=b=="left"?VK_LBUTTON:b=="right"?VK_RBUTTON:VK_MBUTTON;}
        if(wheel){if(!params.contains("delta"))Reject("Wheel delta required");value=Integer(params.at("delta"),-32768,32767);if(!value)Reject("Wheel delta cannot be zero");}
        command(move?Op::Move:wheel?Op::Wheel:action=="down"?Op::Down:Op::Up,x,y,value);
      }else Reject("Invalid input kind");
      result=snapshot();
    }else throw Failure("unknown_method","Unsupported method");
    return {{"id",id},{"result",result}};
  }catch(const Failure& f){return {{"id",id},{"error",{{"code",f.code},{"message",f.what()},{"mutationOutcome",f.outcome}}}};}
  catch(const std::exception& e){return {{"id",id},{"error",{{"code","invalid_request"},{"message",e.what()},{"mutationOutcome","none"}}}};}
}
} // namespace vi
