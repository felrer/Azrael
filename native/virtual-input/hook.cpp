#include "common.hpp"
#include <MinHook.h>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <cwchar>
#include <tlhelp32.h>
#include <vector>

namespace {
using namespace vi;
HMODULE self=nullptr;
Config config{};
Packet* packet=nullptr;
SRWLOCK stateLock=SRWLOCK_INIT;
std::atomic<long> callbacks{0};
std::atomic<bool> running{false};
std::atomic<bool> initializationStarted{false};
POINT position{};
BYTE keys[256]{};
HWND focus=nullptr, capture=nullptr, overlay=nullptr;
bool poisoned=false;
bool minhookInitialized=false;
ULONGLONG deadline=0;
struct Callback { Callback(){++callbacks;} ~Callback(){--callbacks;} };
struct Lock { Lock(){AcquireSRWLockExclusive(&stateLock);} ~Lock(){ReleaseSRWLockExclusive(&stateLock);} };
HWND Target(){return reinterpret_cast<HWND>(config.window);}
bool Scoped(){return running.load() && GetCurrentThreadId()==config.thread;}
bool Bound(HWND w){DWORD pid=0;return w && (w==Target()||IsChild(Target(),w)) && GetWindowThreadProcessId(w,&pid)==config.thread && pid==config.pid;}

decltype(&GetCursorPos) originalGetCursorPos=nullptr;
decltype(&SetCursorPos) originalSetCursorPos=nullptr;
decltype(&GetKeyState) originalGetKeyState=nullptr;
decltype(&GetAsyncKeyState) originalGetAsyncKeyState=nullptr;
decltype(&GetKeyboardState) originalGetKeyboardState=nullptr;
decltype(&GetForegroundWindow) originalGetForegroundWindow=nullptr;
decltype(&GetActiveWindow) originalGetActiveWindow=nullptr;
decltype(&GetFocus) originalGetFocus=nullptr;
decltype(&SetFocus) originalSetFocus=nullptr;
decltype(&GetCapture) originalGetCapture=nullptr;
decltype(&SetCapture) originalSetCapture=nullptr;
decltype(&ReleaseCapture) originalReleaseCapture=nullptr;

BOOL WINAPI Cursor(POINT* p){Callback c;if(!Scoped())return originalGetCursorPos(p);if(!p)return FALSE;Lock l;*p=position;return TRUE;}
BOOL WINAPI CursorSet(int x,int y){Callback c;if(!Scoped())return originalSetCursorPos(x,y);RECT r{};GetClientRect(Target(),&r);POINT p{x,y};ScreenToClient(Target(),&p);if(!PtInRect(&r,p))return FALSE;Lock l;position={x,y};return TRUE;}
SHORT WINAPI Key(int v){Callback c;if(!Scoped())return originalGetKeyState(v);if(v<0||v>255)return 0;Lock l;return SHORT((keys[v]&0x80?0x8000:0)|(keys[v]&1));}
SHORT WINAPI AsyncKey(int v){Callback c;if(!Scoped())return originalGetAsyncKeyState(v);if(v<0||v>255)return 0;Lock l;return SHORT(keys[v]&0x80?0x8000:0);}
BOOL WINAPI Keyboard(BYTE* p){Callback c;if(!Scoped())return originalGetKeyboardState(p);if(!p)return FALSE;Lock l;memcpy(p,keys,256);return TRUE;}
HWND WINAPI Foreground(){Callback c;return Scoped()?Target():originalGetForegroundWindow();}
HWND WINAPI Active(){Callback c;return Scoped()?Target():originalGetActiveWindow();}
HWND WINAPI Focus(){Callback c;if(!Scoped())return originalGetFocus();Lock l;return focus;}
HWND WINAPI FocusSet(HWND w){Callback c;if(!Scoped())return originalSetFocus(w);if(w&&!Bound(w)){SetLastError(ERROR_ACCESS_DENIED);return nullptr;}Lock l;HWND old=focus;focus=w;return old;}
HWND WINAPI Capture(){Callback c;if(!Scoped())return originalGetCapture();Lock l;return capture;}
HWND WINAPI CaptureSet(HWND w){Callback c;if(!Scoped())return originalSetCapture(w);if(!Bound(w))return nullptr;Lock l;HWND old=capture;capture=w;return old;}
BOOL WINAPI CaptureRelease(){Callback c;if(!Scoped())return originalReleaseCapture();Lock l;capture=nullptr;return TRUE;}

struct Hook {const char* name;void* callback;void** original;void* target;bool created=false;};
#define HOOK(name,callback) {#name,reinterpret_cast<void*>(&callback),reinterpret_cast<void**>(&original##name),nullptr}
Hook hooks[]={HOOK(GetCursorPos,Cursor),HOOK(SetCursorPos,CursorSet),HOOK(GetKeyState,Key),HOOK(GetAsyncKeyState,AsyncKey),HOOK(GetKeyboardState,Keyboard),HOOK(GetForegroundWindow,Foreground),HOOK(GetActiveWindow,Active),HOOK(GetFocus,Focus),HOOK(SetFocus,FocusSet),HOOK(GetCapture,Capture),HOOK(SetCapture,CaptureSet),HOOK(ReleaseCapture,CaptureRelease)};
#undef HOOK
bool Install(){
  if(MH_Initialize()!=MH_OK)return false;
  minhookInitialized=true;
  for(auto& h:hooks){h.target=reinterpret_cast<void*>(GetProcAddress(GetModuleHandleW(L"user32.dll"),h.name));
    if(!h.target||MH_CreateHook(h.target,h.callback,h.original)!=MH_OK)return false;h.created=true;}
  // Publish complete state before suspended threads resume into enabled callbacks.
  running=true;
  return MH_EnableHook(MH_ALL_HOOKS)==MH_OK;
}
bool Quiescent(){
  // A zero callback counter alone is insufficient: the last detour may still be
  // executing its epilogue. Suspend the other threads and inspect their RIPs.
  HANDLE snapshot=CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD,0);
  if(snapshot==INVALID_HANDLE_VALUE)return false;
  THREADENTRY32 entry{};entry.dwSize=sizeof(entry);std::vector<DWORD> ids;
  if(!Thread32First(snapshot,&entry)){CloseHandle(snapshot);return false;}
  do{if(entry.th32OwnerProcessID==GetCurrentProcessId()&&entry.th32ThreadID!=GetCurrentThreadId())ids.push_back(entry.th32ThreadID);}while(Thread32Next(snapshot,&entry));
  CloseHandle(snapshot);
  std::vector<HANDLE> suspended;suspended.reserve(ids.size());bool safe=true;
  auto base=reinterpret_cast<uintptr_t>(self);
  auto dos=reinterpret_cast<IMAGE_DOS_HEADER*>(self);
  auto nt=reinterpret_cast<IMAGE_NT_HEADERS*>(base+dos->e_lfanew);
  uintptr_t end=base+nt->OptionalHeader.SizeOfImage;
  for(DWORD id:ids){
    HANDLE thread=OpenThread(THREAD_SUSPEND_RESUME|THREAD_GET_CONTEXT|THREAD_QUERY_INFORMATION,FALSE,id);
    if(!thread){safe=false;break;}
    if(SuspendThread(thread)==DWORD(-1)){CloseHandle(thread);safe=false;break;}
    suspended.push_back(thread);CONTEXT context{};context.ContextFlags=CONTEXT_CONTROL;
    if(!GetThreadContext(thread,&context)||(context.Rip>=base&&context.Rip<end)){safe=false;break;}
  }
  if(callbacks.load()!=0)safe=false;
  for(HANDLE thread:suspended){if(ResumeThread(thread)==DWORD(-1))safe=false;CloseHandle(thread);}
  return safe;
}
bool Remove(){
  if(!minhookInitialized)return true;
  if(MH_DisableHook(MH_ALL_HOOKS)!=MH_OK)return false;
  running=false;
  // Never free code while a detour or its trampoline is still active.
  ULONGLONG start=GetTickCount64();
  while(!Quiescent()){if(GetTickCount64()-start>5000)return false;Sleep(1);}
  for(auto& h:hooks)if(h.created && MH_RemoveHook(h.target)!=MH_OK)return false;
  return MH_Uninitialize()==MH_OK;
}
void Error(Outcome outcome,const wchar_t* message){packet->outcome=outcome;wcsncpy_s(packet->error,message,_TRUNCATE);}
bool Send(HWND w,UINT msg,WPARAM wp=0,LPARAM lp=0){
  if(WaitForSingleObject(reinterpret_cast<HANDLE>(config.controller),0)!=WAIT_TIMEOUT){poisoned=true;Error(Outcome::Rejected,L"Controller exited; input stopped");return false;}
  if(!Bound(w)){Error(Outcome::Rejected,L"Window left approved target/thread");return false;}
  ULONGLONG now=GetTickCount64();
  if(now>=deadline){poisoned=true;Error(Outcome::Unknown,L"Operation deadline exceeded; partial delivery possible");return false;}
  DWORD_PTR ignored=0;
  if(!SendMessageTimeoutW(w,msg,wp,lp,SMTO_ABORTIFHUNG|SMTO_BLOCK,static_cast<UINT>(std::min<ULONGLONG>(kTimeout,deadline-now)),&ignored)){
    poisoned=true;Error(Outcome::Unknown,L"Message timeout: delivery outcome unknown; detach required");return false;}
  return true;
}
bool Valid(){
  DWORD pid=0;FILETIME c,e,k,u;
  return IsWindow(Target()) && GetAncestor(Target(),GA_ROOT)==Target() &&
    IsWindowVisible(Target()) && !IsIconic(Target()) &&
    GetWindowThreadProcessId(Target(),&pid)==config.thread && pid==config.pid &&
    GetProcessTimes(GetCurrentProcess(),&c,&e,&k,&u) && FileTimeValue(c)==config.created;
}
HWND Hit(POINT p){
  HWND w=Target();
  for(int depth=0;depth<32;++depth){POINT local=p;ScreenToClient(w,&local);HWND next=ChildWindowFromPointEx(w,local,CWP_SKIPINVISIBLE|CWP_SKIPDISABLED|CWP_SKIPTRANSPARENT);if(!next||next==w)break;if(!Bound(next))return nullptr;w=next;}
  return Bound(w)?w:nullptr;
}
WPARAM MouseFlags(){Lock l;return (keys[VK_LBUTTON]&0x80?MK_LBUTTON:0)|(keys[VK_RBUTTON]&0x80?MK_RBUTTON:0)|(keys[VK_MBUTTON]&0x80?MK_MBUTTON:0)|(keys[VK_SHIFT]&0x80?MK_SHIFT:0)|(keys[VK_CONTROL]&0x80?MK_CONTROL:0);}
bool SetLogicalFocus(HWND w){
  HWND old;{Lock l;old=focus;focus=w;}
  if(old!=w){if(old&&Bound(old)&&!Send(old,WM_KILLFOCUS,reinterpret_cast<WPARAM>(w)))return false;
    if(!Send(w,WM_SETFOCUS,reinterpret_cast<WPARAM>(old)))return false;}
  return true;
}
bool Extended(int key){switch(key){case VK_RCONTROL:case VK_RMENU:case VK_INSERT:case VK_DELETE:case VK_HOME:case VK_END:case VK_PRIOR:case VK_NEXT:case VK_LEFT:case VK_RIGHT:case VK_UP:case VK_DOWN:case VK_DIVIDE:case VK_NUMLOCK:case VK_SNAPSHOT:return true;default:return false;}}
bool DispatchKey(int key,bool down,bool translate=true){
  HWND w;BYTE state[256];bool previous,alt;
  {Lock l;w=focus;}
  if(!Bound(w)){Error(Outcome::Rejected,L"Click a target child before key input");return false;}
  {Lock l;w=focus;previous=(keys[key]&0x80)!=0;alt=(keys[VK_MENU]&0x80)!=0;
    keys[key]=BYTE((keys[key]&1)|(down?0x80:0));
    // Generic modifier requests represent their left variant, as ordinary
    // Win32 input does. Consumers may query either generic or sided states.
    if(key==VK_CONTROL){keys[VK_LCONTROL]=keys[key];keys[VK_CONTROL]=BYTE((keys[VK_LCONTROL]|keys[VK_RCONTROL])&0x80);}
    if(key==VK_SHIFT){keys[VK_LSHIFT]=keys[key];keys[VK_SHIFT]=BYTE((keys[VK_LSHIFT]|keys[VK_RSHIFT])&0x80);}
    if(key==VK_MENU){keys[VK_LMENU]=keys[key];keys[VK_MENU]=BYTE((keys[VK_LMENU]|keys[VK_RMENU])&0x80);}
    if(down&&!previous&&(key==VK_CAPITAL||key==VK_NUMLOCK||key==VK_SCROLL))keys[key]^=1;
    // Aggregate modifier states for classic message handlers.
    if(key==VK_LCONTROL||key==VK_RCONTROL)keys[VK_CONTROL]=BYTE((keys[VK_LCONTROL]|keys[VK_RCONTROL])&0x80);
    if(key==VK_LSHIFT||key==VK_RSHIFT)keys[VK_SHIFT]=BYTE((keys[VK_LSHIFT]|keys[VK_RSHIFT])&0x80);
    if(key==VK_LMENU||key==VK_RMENU)keys[VK_MENU]=BYTE((keys[VK_LMENU]|keys[VK_RMENU])&0x80);
    memcpy(state,keys,256);}
  UINT scan=MapVirtualKeyExW(key,MAPVK_VK_TO_VSC,GetKeyboardLayout(config.thread));
  LPARAM bits=1|(LPARAM(scan&0xff)<<16)|(Extended(key)?LPARAM(1)<<24:0)|(alt?LPARAM(1)<<29:0)|((previous||!down)?LPARAM(1)<<30:0)|(!down?LPARAM(1)<<31:0);
  bool sys=alt||key==VK_MENU||key==VK_LMENU||key==VK_RMENU;
  if(!Send(w,down?(sys?WM_SYSKEYDOWN:WM_KEYDOWN):(sys?WM_SYSKEYUP:WM_KEYUP),key,bits))return false;
  if(down&&translate){
    // Flag 4 avoids altering the thread keyboard dead-key buffer (Windows 10+).
    wchar_t chars[8]{};int n=ToUnicodeEx(key,scan,state,chars,8,4,GetKeyboardLayout(config.thread));
    for(int i=0;i<n&&i<8;++i)if(!Send(w,sys?WM_SYSCHAR:WM_CHAR,chars[i],bits))return false;
  }
  return true;
}
LRESULT CALLBACK OverlayProc(HWND w,UINT m,WPARAM wp,LPARAM lp){
  if(m==WM_NCHITTEST)return HTTRANSPARENT;
  if(m==WM_MOUSEACTIVATE)return MA_NOACTIVATE;
  if(m==WM_PAINT){PAINTSTRUCT p{};HDC dc=BeginPaint(w,&p);POINT arrow[]={{0,0},{0,17},{4,13},{7,20},{10,19},{7,12},{13,12}};SelectObject(dc,GetStockObject(WHITE_BRUSH));SelectObject(dc,GetStockObject(BLACK_PEN));Polygon(dc,arrow,7);EndPaint(w,&p);return 0;}
  return DefWindowProcW(w,m,wp,lp);
}
void DrawOverlay(){
  if(!overlay){WNDCLASSW c{};c.lpfnWndProc=OverlayProc;c.hInstance=self;c.lpszClassName=L"AzraelVirtualInputCursorV1";RegisterClassW(&c);
    overlay=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|WS_EX_TRANSPARENT|WS_EX_LAYERED,c.lpszClassName,L"",WS_POPUP,0,0,14,21,Target(),nullptr,self,nullptr);
    if(overlay)SetLayeredWindowAttributes(overlay,RGB(255,0,255),235,LWA_ALPHA|LWA_COLORKEY);}
  if(!overlay)return;
  POINT p;{Lock l;p=position;}
  RECT r{};GetClientRect(Target(),&r);POINT origin{0,0};ClientToScreen(Target(),&origin);
  int width=static_cast<int>(std::min<LONG>(14,origin.x+r.right-p.x));
  int height=static_cast<int>(std::min<LONG>(21,origin.y+r.bottom-p.y));
  if(width<=0||height<=0||!IsWindowVisible(Target())||IsIconic(Target())){ShowWindow(overlay,SW_HIDE);return;}
  POINT arrow[]={{0,0},{0,17},{4,13},{7,20},{10,19},{7,12},{13,12}};
  HRGN shape=CreatePolygonRgn(arrow,7,WINDING),clip=CreateRectRgn(0,0,width,height);CombineRgn(shape,shape,clip,RGN_AND);DeleteObject(clip);
  if(!SetWindowRgn(overlay,shape,FALSE))DeleteObject(shape);
  // Keep the indicator immediately above its owner without raising that owner
  // across other applications. NOACTIVATE alone does not preserve owner Z order.
  HWND preceding=GetWindow(Target(),GW_HWNDPREV);
  if(preceding==overlay)preceding=GetWindow(overlay,GW_HWNDPREV);
  SetWindowPos(overlay,preceding?preceding:HWND_TOP,p.x,p.y,width,height,
    SWP_NOACTIVATE|SWP_NOOWNERZORDER|SWP_SHOWWINDOW);
  InvalidateRect(overlay,nullptr,TRUE);UpdateWindow(overlay);
}
void Snapshot(){Lock l;packet->position=position;memcpy(packet->keys,keys,256);GetClientRect(Target(),&packet->client);}
void Apply(){
  deadline=GetTickCount64()+2500;
  packet->outcome=Outcome::Ok;packet->error[0]=0;
  if(packet->magic!=kMagic||packet->version!=kVersion){Error(Outcome::Rejected,L"ABI mismatch");return;}
  if(!Valid()){poisoned=true;Error(Outcome::Rejected,L"Target identity or UI-thread window scope changed");return;}
  if(poisoned){Error(Outcome::Unknown,L"Session disabled after ambiguous delivery");return;}
  Op op=packet->op;
  if(op==Op::Status){Snapshot();DrawOverlay();return;}
  if(op==Op::Text){
    if(packet->textLength>=kTextCapacity){Error(Outcome::Rejected,L"Text exceeds capacity");return;}
    HWND w;{Lock l;w=focus;}
    if(!Bound(w)){Error(Outcome::Rejected,L"Click a child before text input");return;}
    for(uint32_t i=0;i<packet->textLength;++i)if(!Send(w,WM_CHAR,packet->text[i],1))return;
  }else if(op==Op::KeyDown||op==Op::KeyUp){
    if(packet->value<1||packet->value>255){Error(Outcome::Rejected,L"Invalid virtual key");return;}
    DispatchKey(packet->value,op==Op::KeyDown);
  }else{
    RECT rect{};GetClientRect(Target(),&rect);POINT local{packet->x,packet->y};
    if(!PtInRect(&rect,local)||local.x>32767||local.y>32767){Error(Outcome::Rejected,L"Coordinates outside target client");return;}
    POINT screen=local;ClientToScreen(Target(),&screen);
    HWND w;{Lock l;w=capture;}
    if(!w)w=Hit(screen);
    if(!Bound(w)){Error(Outcome::Rejected,L"Foreign input recipient");return;}
    POINT child=screen;ScreenToClient(w,&child);
    RECT childClient{};GetClientRect(w,&childClient);
    if(!PtInRect(&childClient,child)){Error(Outcome::Rejected,L"Nonclient/outside child coordinate");return;}
    if(child.x<-32768||child.x>32767||child.y<-32768||child.y>32767){Error(Outcome::Rejected,L"Child coordinate overflow");return;}
    {Lock l;position=screen;}
    LPARAM xy=MAKELPARAM(short(child.x),short(child.y));
    if(op==Op::Move)Send(w,WM_MOUSEMOVE,MouseFlags(),xy);
    else if(op==Op::Wheel){if(screen.x<-32768||screen.x>32767||screen.y<-32768||screen.y>32767){Error(Outcome::Rejected,L"Screen coordinate overflow");return;}Send(w,WM_MOUSEWHEEL,MAKEWPARAM(MouseFlags(),short(packet->value)),MAKELPARAM(short(screen.x),short(screen.y)));}
    else if(op==Op::Down||op==Op::Up){
      int button=packet->value;
      if(button!=VK_LBUTTON&&button!=VK_RBUTTON&&button!=VK_MBUTTON){Error(Outcome::Rejected,L"Invalid mouse button");return;}
      bool down=op==Op::Down;{Lock l;keys[button]=down?0x80:0;}
      if(down&&!SetLogicalFocus(w))return;
      UINT msg=button==VK_LBUTTON?(down?WM_LBUTTONDOWN:WM_LBUTTONUP):button==VK_RBUTTON?(down?WM_RBUTTONDOWN:WM_RBUTTONUP):(down?WM_MBUTTONDOWN:WM_MBUTTONUP);
      Send(w,msg,MouseFlags(),xy);
    }else Error(Outcome::Rejected,L"Invalid command");
  }
  Snapshot();DrawOverlay();
}
void ReleaseHeld(){
  deadline=GetTickCount64()+10000;
  // Releasing is bounded, best effort; no further input is accepted after this point.
  if(Valid()&&!poisoned){
    for(int i=1;i<256;++i){bool held;{Lock l;held=(keys[i]&0x80)!=0;}
      if(!held)continue;
      if(i==VK_LBUTTON||i==VK_RBUTTON||i==VK_MBUTTON){HWND w;POINT p;{Lock l;w=capture?capture:focus;p=position;keys[i]=0;}
        if(Bound(w)){ScreenToClient(w,&p);Send(w,i==VK_LBUTTON?WM_LBUTTONUP:i==VK_RBUTTON?WM_RBUTTONUP:WM_MBUTTONUP,MouseFlags(),MAKELPARAM(short(p.x),short(p.y)));}}
      else DispatchKey(i,false,false);
      if(poisoned)break;
    }
    HWND old;{Lock l;old=focus;}
    if(Bound(old))Send(old,WM_KILLFOCUS);
  }
  Lock l;memset(keys,0,256);capture=nullptr;focus=nullptr;
}
DWORD WINAPI Worker(void*){
  HANDLE request=reinterpret_cast<HANDLE>(config.request),ack=reinterpret_cast<HANDLE>(config.ack),controller=reinterpret_cast<HANDLE>(config.controller),mapping=reinterpret_cast<HANDLE>(config.mapping);
  packet=static_cast<Packet*>(MapViewOfFile(mapping,FILE_MAP_ALL_ACCESS,0,0,sizeof(Packet)));
  bool installed=false;
  if(packet){
    POINT origin{0,0};ClientToScreen(Target(),&origin);position=origin;
    installed=Valid()&&Install();
    packet->ready=installed?1:0;packet->outcome=installed?Outcome::Ok:Outcome::Rejected;
    if(!installed)Error(Outcome::Rejected,L"Target scope or hook installation failed");
    SetEvent(ack);
    if(installed){HANDLE waits[]={controller,request};
      for(;;){DWORD result=WaitForMultipleObjects(2,waits,FALSE,250);
        if(result==WAIT_OBJECT_0||result==WAIT_FAILED||!IsWindow(Target()))break;
        if(result==WAIT_TIMEOUT){if(overlay){MSG m;while(PeekMessageW(&m,nullptr,0,0,PM_REMOVE)){TranslateMessage(&m);DispatchMessageW(&m);}}continue;}
        if(result!=WAIT_OBJECT_0+1)break;
        if(packet->op==Op::Detach)break;
        Apply();MemoryBarrier();packet->completed=packet->sequence;SetEvent(ack);
      }
    }
    ReleaseHeld();
    if(overlay){DestroyWindow(overlay);overlay=nullptr;UnregisterClassW(L"AzraelVirtualInputCursorV1",self);}
    bool removed=Remove();
    if(!removed){packet->cleanup=2;Error(Outcome::CleanupIncomplete,L"Hook cleanup incomplete; module retained for safety");packet->completed=packet->sequence;SetEvent(ack);
      // Do not unload code whose hooks/callbacks may remain referenced.
      UnmapViewOfFile(packet);CloseHandle(mapping);CloseHandle(request);CloseHandle(ack);CloseHandle(controller);return 1;}
    packet->cleanup=1;packet->outcome=Outcome::Ok;packet->completed=packet->sequence;SetEvent(ack);UnmapViewOfFile(packet);
  }
  CloseHandle(mapping);CloseHandle(request);CloseHandle(ack);CloseHandle(controller);
  FreeLibraryAndExitThread(self,0);
}
} // namespace
extern "C" __declspec(dllexport) DWORD WINAPI Initialize(void* data){
  if(!data||running.load())return ERROR_INVALID_PARAMETER;
  Config incoming=*static_cast<Config*>(data);
  if(incoming.magic!=kMagic||incoming.version!=kVersion||incoming.pid!=GetCurrentProcessId())return ERROR_INVALID_PARAMETER;
  bool expected=false;if(!initializationStarted.compare_exchange_strong(expected,true))return ERROR_ALREADY_INITIALIZED;
  config=incoming;HANDLE thread=CreateThread(nullptr,0,Worker,nullptr,0,nullptr);
  if(!thread){initializationStarted=false;return GetLastError();}CloseHandle(thread);return ERROR_SUCCESS;
}
BOOL WINAPI DllMain(HINSTANCE module,DWORD reason,LPVOID){if(reason==DLL_PROCESS_ATTACH){self=module;DisableThreadLibraryCalls(module);}return TRUE;}
