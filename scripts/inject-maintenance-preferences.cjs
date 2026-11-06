"use strict";
const SETTINGS_ASSET = "webview/assets/personalization-settings-8b2df7633ad3.js";
const MAINTENANCE_PREFERENCES_ASSETS = [SETTINGS_ASSET,"out/extension.js"];
const MARKER = "/*azrael-maintenance-preferences-v1*/";
function renderMaintenancePreferences(React,jsx,bridge,ko,{Card,Row,Switch,Button}) {
  const t = (en,kr) => ko ? kr : en;
  const [state,setState] = React.useState({snapshot:null,busy:true,error:null});
  const owner = React.useRef(null);
  React.useEffect(() => {
    const clientId = crypto.randomUUID(); let sequence=0,active=null,timer=null,disposed=false;
    const cancel = () => {clearTimeout(timer);timer=null;};
    const send = (action,payload) => {
      if (disposed || active) return;
      active=String(++sequence); setState(s=>({...s,busy:true,error:null}));
      timer=setTimeout(()=>{active=null;setState(s=>({...s,busy:false,error:t("Maintenance request timed out. Reload to check current state.","유지관리 요청 시간이 초과되었습니다. 현재 상태를 다시 불러오세요.")}));},35000);
      try { bridge.dispatchMessage("azrael-maintenance-preferences",{clientId,requestId:active,action,...(payload?{payload}:{})}); }
      catch(error){cancel();active=null;setState(s=>({...s,busy:false,error:String(error.message??error)}));}
    };
    const unsubscribe=bridge.subscribe("azrael-maintenance-preferences-state",message=>{
      if(disposed || message.clientId!==clientId || message.requestId!==active)return;
      cancel();active=null;
      if(message.error)setState(s=>({...s,busy:false,error:String(message.error)}));
      else setState({snapshot:message.snapshot,busy:false,error:null});
    });
    owner.current=send;send("read");
    const refresh=()=>send("read");globalThis.addEventListener?.("focus",refresh);
    return ()=>{disposed=true;cancel();unsubscribe();globalThis.removeEventListener?.("focus",refresh);owner.current=null;};
  },[bridge,ko]);
  React.useEffect(()=>{
    if(!state.snapshot?.pending || state.busy || state.error)return;
    const timer=setTimeout(()=>owner.current?.("read"),1500);return()=>clearTimeout(timer);
  },[state.snapshot,state.busy,state.error]);
  const snapshot=state.snapshot,busy=state.busy;
  const update=(key,value)=>{if(!snapshot||busy||snapshot.pending||typeof value!=="boolean")return;owner.current?.("write",{expected_revision:snapshot.revision,groups:snapshot.groups,locks:snapshot.locks,deletion:snapshot.deletion,[key]:value});};
  const descriptions={
    groups:t("Track generated artifact groups. Managed tests, builds and producers require groups and locks.","생성된 산출물 그룹을 추적합니다. 관리형 테스트·빌드·생성 작업에는 그룹과 잠금이 필요합니다."),
    locks:t("Coordinate maintenance operations safely. Turning this off also pauses groups and deletion; their switches retain your choices.","유지관리 작업을 안전하게 조정합니다. 끄면 그룹과 삭제도 중지되며 각 스위치의 선택은 유지됩니다."),
    deletion:t("Allow reviewed, owner-managed deletion. Requires both groups and locks.","검토된 소유자 관리 삭제를 허용합니다. 그룹과 잠금이 모두 필요합니다.")};
  const labels={groups:t("Artifact groups","산출물 그룹"),locks:t("Maintenance locks","유지관리 잠금"),deletion:t("Managed deletion","관리형 삭제")};
  return jsx("section",{"data-azrael-maintenance-preferences":true,className:"flex flex-col gap-4","aria-busy":busy,children:[
    jsx("h2",{className:"text-sm font-medium",children:t("Project maintenance","프로젝트 유지관리")}),
    jsx(Card,{children:["groups","locks","deletion"].map(key=>jsx(Row,{label:labels[key],description:descriptions[key]+(snapshot?" "+t("Effective: ","현재 적용: ")+(snapshot.effective[key]?t("On","켜짐"):t("Off","꺼짐")):""),control:aria=>jsx(Switch,{...aria,checked:snapshot?.[key]??true,disabled:busy||!snapshot||snapshot.pending,onChange:value=>update(key,value)})},key))}),
    jsx("p",{role:"status",className:"text-sm text-secondary",children:busy?t("Loading maintenance settings…","유지관리 설정을 불러오는 중…"):snapshot?.pending?t("Draining: new managed operations are blocked. Existing operations finish safely; locks may still be held.","종료 대기 중: 새 관리형 작업은 차단됩니다. 기존 작업은 안전하게 완료되며 잠금이 아직 유지될 수 있습니다."):snapshot?.status==="disabled"?t("Some maintenance features are disabled.","일부 유지관리 기능이 꺼져 있습니다."):snapshot?t("Maintenance is enabled.","유지관리가 켜져 있습니다."):""}),
    state.error?jsx("p",{role:"alert",className:"text-sm text-secondary",children:t("Maintenance settings could not be updated: ","유지관리 설정을 업데이트하지 못했습니다: ")+state.error}):null,
    jsx(Button,{className:"self-start",color:"secondary",size:"default",disabled:busy,onClick:()=>owner.current?.("read"),children:t("Reload","다시 불러오기")})
  ]});
}
function once(text,from,to){if(text.split(from).length!==2)throw Error("Pinned maintenance preference anchor changed: "+from);return text.replace(from,to);}
function injectMaintenancePreferences(text,asset){
  if(!MAINTENANCE_PREFERENCES_ASSETS.includes(asset)||text.includes(MARKER))return{text,count:0};
  if(asset==="out/extension.js")return{text:once(text,'case"open-vscode-command":{','case"azrael-maintenance-preferences":{await je.commands.executeCommand("azrael.maintenancePreferencesEmbedded",e,r);break}case"open-vscode-command":{')+"\n"+MARKER,count:1};
  text=once(text,"children:[a,o,null,s,c,(0,$.jsx)(__AzraelContextSettings,{hostId:r})]","children:[a,o,null,s,c,(0,$.jsx)(__AzraelContextSettings,{hostId:r}),(0,$.jsx)(__AzraelMaintenancePreferences,{})]");
  return{text:'import{X9t as azraelMaintenanceBridge}from"./app-initial-c014f9ee4429.js";import{l9 as AzraelMaintenanceSwitch,d9 as initAzraelMaintenanceSwitch}from"./app-initial-7a199c66e670.js";'+text+"\n"+MARKER+"\n"+renderMaintenancePreferences.toString()+"\nfunction __AzraelMaintenancePreferences(){let intl=i();j();$e();Kt();initAzraelMaintenanceSwitch();return renderMaintenancePreferences(jr,$.jsx,azraelMaintenanceBridge,intl.locale?.startsWith('ko'),{Button:G,Card:_t,Row:ut,Switch:AzraelMaintenanceSwitch})}\n",count:1};
}
module.exports={MAINTENANCE_PREFERENCES_ASSETS,MARKER,injectMaintenancePreferences,renderMaintenancePreferences};
