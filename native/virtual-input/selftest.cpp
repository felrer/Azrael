#include "broker.hpp"
#include <iostream>

namespace {
using namespace vi;
void Check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
LRESULT Message(HWND window,UINT msg,WPARAM wp=0,LPARAM lp=0){DWORD_PTR result=0;if(!SendMessageTimeoutW(window,msg,wp,lp,SMTO_ABORTIFHUNG|SMTO_BLOCK,kTimeout,&result))throw std::runtime_error("Fixture message timeout");return static_cast<LRESULT>(result);}
struct CursorObservation {
  POINT position{};
  ULONGLONG sampledAt=0;
  DWORD lastInput=0;
  bool lastInputKnown=false;
};
CursorObservation ObserveCursor(){
  CursorObservation observation;observation.sampledAt=GetTickCount64();
  Check(GetCursorPos(&observation.position)!=FALSE,"Cannot query physical cursor");
  LASTINPUTINFO info{sizeof(info),0};observation.lastInputKnown=GetLastInputInfo(&info)!=FALSE;
  observation.lastInput=info.dwTime;return observation;
}
std::string DescribeCursor(const CursorObservation& observation){
  return "("+std::to_string(observation.position.x)+","+std::to_string(observation.position.y)+") sampledAt="+
    std::to_string(observation.sampledAt)+" lastInputTick="+(observation.lastInputKnown?std::to_string(observation.lastInput):"unavailable");
}
void CursorUnchanged(const CursorObservation& before,const CursorObservation& after,const char* stage){
  if(before.position.x!=after.position.x||before.position.y!=after.position.y)
    throw std::runtime_error(std::string("Physical cursor moved [")+stage+"]; before="+DescribeCursor(before)+" after="+DescribeCursor(after)+
      "; last-input ticks describe session input activity and do not alone attribute the movement");
}
struct Find {DWORD pid;HWND window=nullptr,sameThread=nullptr,otherThread=nullptr;};
BOOL CALLBACK FindWindow(HWND w,LPARAM data){
  auto& found=*reinterpret_cast<Find*>(data);DWORD pid=0;GetWindowThreadProcessId(w,&pid);
  wchar_t cls[80]{},title[100]{};GetClassNameW(w,cls,80);
  if(pid==found.pid&&!wcscmp(cls,L"AzraelVirtualInputOwnedFixture")){
    GetWindowTextW(w,title,100);
    if(!wcscmp(title,L"Azrael virtual input owned fixture A"))found.window=w;
    if(!wcscmp(title,L"Azrael virtual input owned fixture B"))found.sameThread=w;
    if(!wcscmp(title,L"Azrael virtual input owned fixture C"))found.otherThread=w;
  }
  return TRUE;
}
struct Fixture {
  Handle process;DWORD pid=0;HWND window=nullptr,sameThread=nullptr,otherThread=nullptr;
  Fixture(){std::wstring path=Sibling(L"azrael-virtual-input-fixture.exe"),command=L"\""+path+L"\"";STARTUPINFOW start{};start.cb=sizeof(start);PROCESS_INFORMATION info{};
    if(!CreateProcessW(path.c_str(),command.data(),nullptr,nullptr,FALSE,0,nullptr,nullptr,&start,&info))throw std::runtime_error("Cannot start owned fixture");process.reset(info.hProcess);CloseHandle(info.hThread);pid=info.dwProcessId;
    WaitForInputIdle(process.h,kTimeout);
    ULONGLONG time=GetTickCount64();do{Find found{pid};EnumWindows(FindWindow,reinterpret_cast<LPARAM>(&found));window=found.window;sameThread=found.sameThread;otherThread=found.otherThread;if(window&&sameThread&&otherThread)break;Sleep(10);}while(GetTickCount64()-time<kTimeout);
    if(!window||!sameThread||!otherThread){close();throw std::runtime_error("Owned fixture A/B/C windows absent");}
    Check(GetWindowThreadProcessId(window,nullptr)==GetWindowThreadProcessId(sameThread,nullptr),"Fixture A/B are not on same GUI thread");
    Check(GetWindowThreadProcessId(window,nullptr)!=GetWindowThreadProcessId(otherThread,nullptr),"Fixture C is not on separate GUI thread");}
  bool close(){if(!process)return true;if(WaitForSingleObject(process.h,0)==WAIT_OBJECT_0)return true;if(window)PostMessageW(window,kFixtureQuit,0,0);return WaitForSingleObject(process.h,5000)==WAIT_OBJECT_0;}
  ~Fixture(){if(!close())std::cerr<<"Owned fixture did not exit gracefully; PID "<<pid<<" remains for diagnosis\n";}
};
struct OwnedOrder {HWND target,sentinel;int first=0,count=0;};
BOOL CALLBACK ObserveOrder(HWND window,LPARAM data){
  auto& order=*reinterpret_cast<OwnedOrder*>(data);
  if(window==order.target||window==order.sentinel){
    if(!order.first)order.first=window==order.target?1:2;
    ++order.count;
  }
  return order.count<2;
}
int RelativeOrder(HWND target,HWND sentinel){
  OwnedOrder order{target,sentinel};EnumWindows(ObserveOrder,reinterpret_cast<LPARAM>(&order));
  Check(order.count==2,"Owned Z-order sentinel disappeared");return order.first;
}
struct DesktopObservation {
  HWND target,sentinel,foreground;
  CursorObservation cursor{};
  SHORT physicalKey=0;
  int order=0;
  DesktopObservation(HWND targetWindow,HWND sentinelWindow)
      :target(targetWindow),sentinel(sentinelWindow),foreground(GetForegroundWindow()){
    cursor=ObserveCursor();
    physicalKey=GetAsyncKeyState(VK_F8)&SHORT(0x8000);
    Check(!physicalKey,"F8 is physically held; release it before running selftest");
    order=RelativeOrder(target,sentinel);
  }
  void unchanged()const{
    Check(GetForegroundWindow()==foreground,"Virtual input changed actual OS foreground window (or external foreground changed)");
    Check(RelativeOrder(target,sentinel)==order,"Virtual input changed owned top-level window Z order");
    Check((GetAsyncKeyState(VK_F8)&SHORT(0x8000))==physicalKey,"Virtual held key changed physical GetAsyncKeyState (or F8 was physically pressed)");
    CursorUnchanged(cursor,ObserveCursor(),"desktop invariants against initial snapshot");
  }
};
Json Call(Broker& broker,const char* method,Json params=Json::object()){
  auto result=broker.invoke({{"id",1},{"method",method},{"params",params}});
  if(result.contains("error"))throw std::runtime_error(result.dump());return result.at("result");
}
std::wstring Content(HWND window){HWND child=GetDlgItem(window,1);wchar_t text[4096]{};Message(child,WM_GETTEXT,4096,reinterpret_cast<LPARAM>(text));return text;}
void Input(Broker& b,Json p){Call(b,"input",p);}
void Key(Broker& b,int key,const char* action){Input(b,{{"kind","key"},{"virtualKey",key},{"action",action}});}
Json Binding(const Fixture& f,HWND root){return {{"window",{{"hwnd",Hex(reinterpret_cast<uint64_t>(root))},{"pid",f.pid},{"processCreated",Hex(Creation(f.process.h))},{"executable",Utf8(Executable(f.process.h))}}}};}
void Click(Broker& broker){
  Input(broker,{{"kind","mouse"},{"action","move"},{"x",24},{"y",28}});
  Input(broker,{{"kind","mouse"},{"action","down"},{"button","left"}});
  Input(broker,{{"kind","mouse"},{"action","up"},{"button","left"}});
}
void SelectionDelete(Broker& broker,HWND root,size_t length){
  Key(broker,VK_HOME,"down");Key(broker,VK_HOME,"up");
  Key(broker,VK_SHIFT,"down");Key(broker,VK_END,"down");Key(broker,VK_END,"up");Key(broker,VK_SHIFT,"up");
  auto first=Message(root,kFixtureProbe,10),last=Message(root,kFixtureProbe,11);
  if(first!=0||last!=static_cast<LRESULT>(length))throw std::runtime_error("Home+Shift+End did not select exact EDIT contents; selected="+std::to_string(first)+":"+std::to_string(last)+" expected=0:"+std::to_string(length));
  Key(broker,VK_BACK,"down");Key(broker,VK_BACK,"up");
  Check(Content(root).empty(),"Home+Shift+End/backspace did not clear EDIT");
}
} // namespace

int main(){
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  try{
    Fixture fixture;Fixture sentinel;Broker broker;
    Check(Message(fixture.window,kFixtureProbe,19)==0,"Fixture A must use standard single-line EDIT");
    Check(Message(fixture.sameThread,kFixtureProbe,19)==1&&Message(fixture.otherThread,kFixtureProbe,19)==1,"Fixture B/C must use standard multiline EDIT");
    Json binding=Binding(fixture,fixture.window);
    auto stale=binding;stale["window"]["processCreated"]=Hex(Creation(fixture.process.h)+1);
    Check(broker.invoke({{"id",1},{"method","attach"},{"params",stale}}).contains("error"),"Stale identity accepted");
    auto foreign=binding;foreign["window"]["hwnd"]=Hex(reinterpret_cast<uint64_t>(GetDesktopWindow()));
    Check(broker.invoke({{"id",2},{"method","attach"},{"params",foreign}}).contains("error"),"Foreign window accepted");
    Check(broker.invoke({{"id",2},{"method","attach"},{"params",Binding(fixture,GetDlgItem(fixture.window,1))}}).contains("error"),"Child HWND accepted as bound root");
    const CursorObservation physicalBefore=ObserveCursor();
    DesktopObservation desktop(fixture.window,sentinel.window);
    Check(Call(broker,"attach",binding).at("attached").get<bool>(),"Attach did not confirm hooks");
    desktop.unchanged();
    Input(broker,{{"kind","mouse"},{"action","move"},{"x",24},{"y",28}});
    POINT expected{24,28};ClientToScreen(fixture.window,&expected);
    Check(Message(fixture.window,kFixtureProbe,0)==expected.x&&Message(fixture.window,kFixtureProbe,1)==expected.y,"Target cursor getter not virtualized");
    Check(expected.x!=physicalBefore.position.x||expected.y!=physicalBefore.position.y,"Choose a physical cursor location outside fixture test point");
    CursorUnchanged(physicalBefore,ObserveCursor(),"after initial virtual move");
    desktop.unchanged();
    Input(broker,{{"kind","mouse"},{"action","down"},{"button","left"}});
    Check(Message(fixture.window,kFixtureProbe,3)==1,"Virtual click did not focus EDIT");
    Check(Message(fixture.window,kFixtureProbe,8)==1,"Foreground getter not virtualized");
    Check((Message(fixture.window,kFixtureProbe,2,VK_LBUTTON)&0x8000)!=0,"Mouse state missing");
    desktop.unchanged();
    Input(broker,{{"kind","mouse"},{"action","up"},{"button","left"}});
    Key(broker,VK_F8,"down");
    Check((Message(fixture.window,kFixtureProbe,2,VK_F8)&0x8000)!=0,"GetKeyState hook missing");
    Check((Message(fixture.window,kFixtureProbe,4,VK_F8)&0x8000)!=0,"GetAsyncKeyState hook missing");
    Check((Message(fixture.window,kFixtureProbe,5,VK_F8)&0x80)!=0,"GetKeyboardState hook missing");
    Check((Message(fixture.sameThread,kFixtureProbe,4,VK_F8)&0x8000)!=0,"Same-thread getter did not expose documented thread scope");
    Check((Message(fixture.otherThread,kFixtureProbe,4,VK_F8)&0x8000)==0,"Other GUI thread observed virtual F8 state");
    Check((Message(sentinel.window,kFixtureProbe,4,VK_F8)&0x8000)==0,"Uninjected owned fixture observed virtual held key as physical");
    desktop.unchanged();
    Key(broker,VK_F8,"up");
    const std::wstring text=L"mousemux test 123 한글 🙂";
    Input(broker,{{"kind","text"},{"text",Utf8(text)}});Check(Content(fixture.window)==text,"EDIT content mismatch after text/Unicode");
    desktop.unchanged();
    SelectionDelete(broker,fixture.window,text.size());
    Input(broker,{{"kind","text"},{"text",Utf8(text)}});Check(Content(fixture.window)==text,"EDIT content restore mismatch before Ctrl+A");
    Key(broker,VK_CONTROL,"down");Key(broker,'A',"down");Key(broker,'A',"up");Key(broker,VK_CONTROL,"up");
    auto selectionStart=Message(fixture.window,kFixtureProbe,10),selectionEnd=Message(fixture.window,kFixtureProbe,11);
    Key(broker,VK_BACK,"down");Key(broker,VK_BACK,"up");
    if(selectionStart!=0||selectionEnd!=static_cast<LRESULT>(text.size())||!Content(fixture.window).empty()){
      throw std::runtime_error("Ctrl+A/backspace did not clear EDIT; selected="+std::to_string(selectionStart)+":"+std::to_string(selectionEnd)+
        " expected=0:"+std::to_string(text.size())+" ctrlAKeys="+std::to_string(Message(fixture.window,kFixtureProbe,12))+
        " ctrlAChars="+std::to_string(Message(fixture.window,kFixtureProbe,13))+" ctrl="+std::to_string(Message(fixture.window,kFixtureProbe,15))+
        " leftCtrl="+std::to_string(Message(fixture.window,kFixtureProbe,18))+" backspaceChars="+std::to_string(Message(fixture.window,kFixtureProbe,14))+
        " editClassComctl32="+std::to_string(Message(fixture.window,kFixtureProbe,20))+
        " remaining="+Utf8(Content(fixture.window)));
    }
    Key(broker,'A',"down");Key(broker,'A',"up");Check(!Content(fixture.window).empty(),"Printable key did not translate to WM_CHAR");
    desktop.unchanged();
    auto invalid=broker.invoke({{"id",3},{"method","input"},{"params",{{"kind","mouse"},{"action","move"},{"x",32767},{"y",32767}}}});
    Check(invalid.contains("error"),"Outside client accepted");
    Check(broker.invoke({{"id",4},{"method","status"},{"params",{{"unexpected",true}}}}).contains("error"),"Unknown field accepted");
    Check(Message(fixture.window,kFixtureProbe,16,reinterpret_cast<LPARAM>(GetDlgItem(fixture.sameThread,1)))==1,"SetFocus escaped bound root to sibling");
    Check(Message(fixture.window,kFixtureProbe,17,reinterpret_cast<LPARAM>(GetDlgItem(fixture.otherThread,1)))==1,"SetCapture escaped bound root to sibling thread");
    Check(Content(fixture.sameThread).empty()&&Content(fixture.otherThread).empty(),"Unbound sibling contents changed while A bound");
    auto upBefore=Message(fixture.window,kFixtureProbe,6),mouseUpBefore=Message(fixture.window,kFixtureProbe,7);
    Key(broker,VK_F8,"down");Input(broker,{{"kind","mouse"},{"action","down"},{"button","left"}});
    desktop.unchanged();
    const CursorObservation beforeDetach=ObserveCursor();
    std::cout<<"CURSOR initial="<<DescribeCursor(physicalBefore)<<" before-first-detach="<<DescribeCursor(beforeDetach)<<'\n'<<std::flush;
    Call(broker,"detach");
    const CursorObservation afterDetach=ObserveCursor();
    std::cout<<"CURSOR after-first-detach="<<DescribeCursor(afterDetach)<<'\n'<<std::flush;
    CursorUnchanged(beforeDetach,afterDetach,"first detach only");
    Check(Module(fixture.pid,Sibling(L"azrael-virtual-input-hook.dll"))==0,"Hook module remained after detach");
    Check(Message(fixture.window,kFixtureProbe,6)>upBefore,"Held key was not released");
    Check(Message(fixture.window,kFixtureProbe,7)>mouseUpBefore,"Held mouse was not released");
    Check(!Call(broker,"status").at("attached").get<bool>(),"Status remained attached");
    CursorUnchanged(physicalBefore,ObserveCursor(),"initial snapshot through first input/detach");
    desktop.unchanged();
    const std::wstring originalA=Content(fixture.window);
    const HWND roots[]={fixture.sameThread,fixture.otherThread,fixture.window};
    const std::wstring additions[]={L"same-thread B",L"other-thread C",L" A again"};
    std::wstring expectedA=originalA,expectedB,expectedC;
    for(size_t index=0;index<3;++index){
      HWND root=roots[index];
      auto fresh=Call(broker,"attach",Binding(fixture,root));
      Check(fresh.at("heldKeys").empty(),"Held states leaked into next root attachment");
      Check(Message(root,kFixtureProbe,3)==0,"Logical focus leaked into next root attachment");
      Check(Module(fixture.pid,Sibling(L"azrael-virtual-input-hook.dll"))!=0,"Sequential attachment module absent");
      Check(broker.invoke({{"id",5},{"method","attach"},{"params",Binding(fixture,fixture.window)}}).contains("error"),"Second simultaneous root attachment accepted");
      Click(broker);Key(broker,VK_END,"down");Key(broker,VK_END,"up");
      Input(broker,{{"kind","text"},{"text",Utf8(additions[index])}});
      if(index==0)expectedB=additions[index];else if(index==1)expectedC=additions[index];else expectedA+=additions[index];
      Check(Content(fixture.window)==expectedA&&Content(fixture.sameThread)==expectedB&&Content(fixture.otherThread)==expectedC,"Sequential root delivery changed an unbound sibling or wrong target");
      if(index<2){SelectionDelete(broker,root,additions[index].size());Input(broker,{{"kind","text"},{"text",Utf8(additions[index])}});
        Check(Content(fixture.window)==expectedA&&Content(fixture.sameThread)==expectedB&&Content(fixture.otherThread)==expectedC,"Multiline selection/delete/restore affected another root");}
      Key(broker,VK_F8,"down");
      Input(broker,{{"kind","mouse"},{"action","down"},{"button","left"}});
      auto keyBefore=Message(root,kFixtureProbe,6),mouseBefore=Message(root,kFixtureProbe,7);
      desktop.unchanged();
      const CursorObservation beforeSwitchDetach=ObserveCursor();
      std::cout<<"CURSOR before-sequential-detach["<<index<<"]="<<DescribeCursor(beforeSwitchDetach)<<'\n'<<std::flush;
      Call(broker,"detach");
      const CursorObservation afterSwitchDetach=ObserveCursor();
      std::cout<<"CURSOR after-sequential-detach["<<index<<"]="<<DescribeCursor(afterSwitchDetach)<<'\n'<<std::flush;
      CursorUnchanged(beforeSwitchDetach,afterSwitchDetach,"sequential detach only");
      Check(Message(root,kFixtureProbe,6)>keyBefore&&Message(root,kFixtureProbe,7)>mouseBefore,"Sequential detach failed held-state release");
      Check(Module(fixture.pid,Sibling(L"azrael-virtual-input-hook.dll"))==0,"Sequential detach did not unload module");
      desktop.unchanged();
    }
    Check(fixture.close(),"Fixture graceful exit failed");
    Check(sentinel.close(),"Owned sentinel graceful exit failed");
    std::cout<<"PASS: owned classic EDIT injection, cursor/state hooks, physical cursor/key independence, OS foreground/Z-order retention, text/Unicode, key shortcut, held releases, unload, identity rejection, same-process same/other-thread sequential roots\n";return 0;
  }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}
}
