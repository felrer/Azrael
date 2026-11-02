#include "common.hpp"
#include <climits>
#include <atomic>
#include <cwchar>
#include <commctrl.h>

// Explicit v6 controls; the legacy multiline EDIT does not establish a Ctrl+A
// contract. A is a standard single-line EDIT, B/C remain multiline controls.
#pragma comment(linker,"/manifestdependency:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='amd64' publicKeyToken='6595b64144ccf1df' language='*'\"")

namespace {
constexpr wchar_t kClass[]=L"AzraelVirtualInputOwnedFixture";
struct State {
  HWND edit=nullptr;
  WNDPROC original=nullptr;
  unsigned keyUps=0,mouseUps=0,ctrlAKeys=0,ctrlAChars=0,backspaces=0;
  SHORT ctrlAtA=0,leftCtrlAtA=0;
  int role=0;
};
std::atomic<HWND> mainWindow{nullptr},otherThreadWindow{nullptr};
std::atomic<bool> stopping{false};
State* Data(HWND window){return reinterpret_cast<State*>(GetWindowLongPtrW(window,GWLP_USERDATA));}
LRESULT CALLBACK EditProc(HWND w,UINT m,WPARAM wp,LPARAM lp){
  State* state=Data(GetParent(w));
  if(!state||!state->original)return DefWindowProcW(w,m,wp,lp);
  if(m==WM_KEYUP)++state->keyUps;
  if(m==WM_LBUTTONUP)++state->mouseUps;
  if(m==WM_KEYDOWN&&wp=='A'){
    ++state->ctrlAKeys;state->ctrlAtA=GetKeyState(VK_CONTROL);state->leftCtrlAtA=GetKeyState(VK_LCONTROL);
  }
  if(m==WM_CHAR&&wp==1)++state->ctrlAChars;
  if(m==WM_CHAR&&wp==VK_BACK)++state->backspaces;
  return CallWindowProcW(state->original,w,m,wp,lp);
}
LRESULT CALLBACK Proc(HWND w,UINT m,WPARAM wp,LPARAM lp){
  if(m==WM_NCCREATE){auto* create=reinterpret_cast<CREATESTRUCTW*>(lp);SetWindowLongPtrW(w,GWLP_USERDATA,reinterpret_cast<LONG_PTR>(create->lpCreateParams));}
  State* state=Data(w);
  if(m==WM_CREATE){
    DWORD editStyle=WS_VISIBLE|WS_CHILD|ES_LEFT|
      (state->role==0?ES_AUTOHSCROLL:(ES_MULTILINE|ES_AUTOVSCROLL));
    state->edit=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"",editStyle,10,10,420,state->role==0?32:180,w,reinterpret_cast<HMENU>(1),GetModuleHandleW(nullptr),nullptr);
    if(!state->edit)return -1;
    state->original=reinterpret_cast<WNDPROC>(SetWindowLongPtrW(state->edit,GWLP_WNDPROC,reinterpret_cast<LONG_PTR>(EditProc)));return 0;
  }
  if(m==vi::kFixtureProbe&&state){
    POINT p{};
    switch(wp){
      case 0:return GetCursorPos(&p)?p.x:LONG_MIN;
      case 1:return GetCursorPos(&p)?p.y:LONG_MIN;
      case 2:return GetKeyState(static_cast<int>(lp));
      case 3:return GetFocus()==state->edit;
      case 4:return GetAsyncKeyState(static_cast<int>(lp));
      case 5:{BYTE keyboard[256]{};return GetKeyboardState(keyboard)?keyboard[lp&255]:-1;}
      case 6:return state->keyUps;
      case 7:return state->mouseUps;
      case 8:return GetForegroundWindow()==w;
      case 9:return GetCapture()==state->edit;
      case 10:return LOWORD(SendMessageW(state->edit,EM_GETSEL,0,0));
      case 11:return HIWORD(SendMessageW(state->edit,EM_GETSEL,0,0));
      case 12:return state->ctrlAKeys;
      case 13:return state->ctrlAChars;
      case 14:return state->backspaces;
      case 15:return state->ctrlAtA;
      case 16:{HWND before=GetFocus();SetFocus(reinterpret_cast<HWND>(lp));return GetFocus()==before;}
      case 17:{HWND before=GetCapture();SetCapture(reinterpret_cast<HWND>(lp));return GetCapture()==before;}
      case 18:return state->leftCtrlAtA;
      case 19:return (GetWindowLongPtrW(state->edit,GWL_STYLE)&ES_MULTILINE)!=0;
      case 20:{wchar_t module[32768]{};auto owner=reinterpret_cast<HMODULE>(GetClassLongPtrW(state->edit,GCLP_HMODULE));
        if(!GetModuleFileNameW(owner,module,32768))return -1;
        const wchar_t* basename=wcsrchr(module,L'\\');return _wcsicmp(basename?basename+1:module,L"comctl32.dll")==0;}
      default:return -1;
    }
  }
  if(m==vi::kFixtureQuit){HWND main=mainWindow.load();if(main)PostMessageW(main,WM_CLOSE,0,0);return 0;}
  if(m==WM_CLOSE){DestroyWindow(w);return 0;}
  if(m==WM_DESTROY){if(state&&(state->role==0||state->role==2))PostQuitMessage(0);return 0;}
  return DefWindowProcW(w,m,wp,lp);
}
HWND Create(State& state,const wchar_t* title,int x,int y){
  HWND window=CreateWindowExW(WS_EX_NOACTIVATE,kClass,title,WS_OVERLAPPEDWINDOW,x,y,460,250,nullptr,nullptr,GetModuleHandleW(nullptr),&state);
  if(window){ShowWindow(window,SW_SHOWNOACTIVATE);UpdateWindow(window);}return window;
}
void Pump(){MSG message;while(GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}}
DWORD WINAPI OtherThread(void*){
  State state;state.role=2;HWND window=Create(state,L"Azrael virtual input owned fixture C",210,210);
  otherThreadWindow=window;if(!window)return 1;
  if(stopping.load())PostMessageW(window,WM_CLOSE,0,0);
  Pump();otherThreadWindow=nullptr;return 0;
}
}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int){
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  INITCOMMONCONTROLSEX controls{sizeof(controls),ICC_STANDARD_CLASSES};if(!InitCommonControlsEx(&controls))return 1;
  WNDCLASSW c{};c.hInstance=instance;c.lpfnWndProc=Proc;c.lpszClassName=kClass;c.hbrBackground=reinterpret_cast<HBRUSH>(COLOR_WINDOW+1);
  if(!RegisterClassW(&c))return 1;
  State a,b;b.role=1;
  HWND first=Create(a,L"Azrael virtual input owned fixture A",160,160);if(!first)return 2;mainWindow=first;
  HWND second=Create(b,L"Azrael virtual input owned fixture B",185,185);if(!second){DestroyWindow(first);return 2;}
  HANDLE thread=CreateThread(nullptr,0,OtherThread,nullptr,0,nullptr);if(!thread){DestroyWindow(second);DestroyWindow(first);return 2;}
  Pump();stopping=true;mainWindow=nullptr;if(IsWindow(second))DestroyWindow(second);
  HWND third=otherThreadWindow.load();if(third)PostMessageW(third,WM_CLOSE,0,0);
  DWORD result=WaitForSingleObject(thread,5000);DWORD code=1;if(result==WAIT_OBJECT_0)GetExitCodeThread(thread,&code);CloseHandle(thread);
  return result==WAIT_OBJECT_0&&code==0?0:3;
}
