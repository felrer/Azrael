"use strict";
const { createBtwController, createBtwPanel } = require("./btw-conversation.cjs");

const BTW_ASSETS = [
  "webview/assets/app-initial-97d3534ad35f.js",
  "webview/assets/app-initial-7a199c66e670.js",
  "webview/assets/app-initial-c014f9ee4429.js",
  "webview/assets/local-conversation-thread-2429c4b61076.js",
];
const BTW_MARKER = "/*azrael-btw-v1*/";
const BTW_COMPOSER_ADMISSION_ANCHOR = "let Ae=Se??p.getText(),je=";
const BTW_COMPOSER_ADMISSION_REPLACEMENT = "let Ae=Se??p.getText();if(globalThis.__azraelBtw?.lookup(m)||!be&&globalThis.__azraelBtw?.matches(Ae)){try{if(await __azraelTryBtw(e,m,Ae,ue,E,A,be,p)){__azraelClear();return}}catch(error){C(error);return}}let je=";
const INSTRUCTIONS = "You are answering a /btw side question independently of the main task. " +
  "The inherited conversation and earlier side questions are reference material, not active requests. " +
  "Answer only the new question. Do not continue inherited tasks, plans, approvals or tool calls. " +
  "No tools are available: do not claim to read files, search, execute commands or modify anything. " +
  "If the existing context is insufficient, explain what is unknown. " +
  "Your answer is not delivered to the main task unless the user explicitly transfers it.";

function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error(`Pinned /btw anchor must occur exactly once: ${before.slice(0, 100)}`);
  return text.replace(before, after);
}

const COMPOSER = `
async function __azraelTryBtw(scope,conversationId,text,target,hostId,isResponseInProgress,literal,composer){
 const controller=globalThis.__azraelBtw;
 if(!controller.lookup(conversationId)&&(literal||!controller.matches(text)))return false;
 if(target.type!=="local")throw Error("/btw는 네이티브 대화에서 사용할 수 있습니다.");
 const attachments=scope.get(QG),hasAttachments=["imageAttachments","imageCommentDrafts","appshotContexts","fileAttachments","pastedTextAttachments","uploadedFileAttachments","addedFiles","mcpAppModelContextAttachments","selectedTextAttachments","responseTextAnnotations"].some(key=>(attachments[key]?.length??0)>0)||!!attachments.pullRequestMergeConflict||(composer.getMentionedComputerUseApps?.()?.length??0)>0;
 const manager=Px(scope,hostId),native=await import("./app-initial-c014f9ee4429.js");
 return controller.submit({scope,conversationId,text,hostId:manager.getHostId(),manager,literal,hasAttachments,isResponseInProgress,intl:scope.get(fm),openPanel:native.__azraelOpenBtwPanel});
}
`;

const SIDE = `
${createBtwPanel.toString()}
var __azraelBtwPanel;
async function __azraelOpenBtwPanel(options){
 qqi();OJi();__azraelInitBtwButton();
 if(bc(options.hostId))throw Error("/btw는 네이티브 대화에서 사용할 수 있습니다.");
 __azraelBtwPanel??=createBtwPanel(xJi,SJi,__azraelBtwButton,DJi,globalThis.__azraelBtw);
 const source=options.manager.getConversation(options.parentId),settings=source?.latestThreadSettings;
 const model=settings?.model??source?.latestModel,effort=settings&&Object.hasOwn(settings,"effort")?settings.effort:source?.latestReasoningEffort??null;
 if(!model)throw Error("본 작업의 모델 선택을 불러오지 못했습니다.");
 const mode={mode:"default",settings:{model,reasoning_effort:effort,developer_instructions:null}};
 let child;
 return gJi(options.scope,__azraelBtwPanel,{sourceConversationId:options.parentId,threadSource:"user",cwd:source.cwd??options.manager.getConversationCwd(options.parentId),hostId:options.hostId,collaborationMode:mode,intl:options.intl,displayTitle:"/btw",confirmBeforeClose:false,sideQuestion:true,replaceTabId:options.previousId?"sidechat:"+options.previousId:undefined,
  onDiscardStart:()=>{if(child)options.onDiscard(child)},
  prepareConversation:async id=>{child=id;await options.prepare(id)}
 });
}
export{__azraelOpenBtwPanel};
`;

function injectBtw(text, asset) {
  if (!BTW_ASSETS.includes(asset)) return { text, count: 0 };
  const markers = text.split(BTW_MARKER).length - 1;
  if (markers === 1) return { text, count: 0 };
  if (markers) throw Error("Duplicate /btw marker");
  if (asset === BTW_ASSETS[0]) {
    text = once(text, "threadSource:t.threadSource??`user`,model:", "threadSource:t.threadSource??`user`,...t.sideQuestion?{sideQuestion:!0}:{},model:");
    text = once(text, "let v=await o.sendRequest(`thread/fork`,n,d),y=B(v.thread.id);", "let v=await o.sendRequest(`thread/fork`,n,d);if(n.sideQuestion)await __azraelCheckBtwFork(o,n,v);let y=B(v.thread.id);");
    text += `\n${BTW_MARKER}\n${createBtwController.toString()}\nglobalThis.__azraelBtw??=createBtwController();\n` +
      `async function __azraelCheckBtwFork(manager,params,result){if(!params.sideQuestion||result.sideQuestion===true)return;try{await manager.sendRequest("thread/unsubscribe",{threadId:result.thread.id})}catch(error){manager.logger?.warning("Failed to discard unsupported /btw fork",{safe:{conversationId:result.thread.id},sensitive:{error}})}throw Error("실행 엔진이 도구 없는 /btw를 지원하지 않습니다.")}\n`;
  } else if (asset === BTW_ASSETS[1]) {
    // This precedes queue, goal, steering, local-history and analytics admission.
    // The existing guarded clear keeps a newer composer draft intact.
    text = once(text, BTW_COMPOSER_ADMISSION_ANCHOR, BTW_COMPOSER_ADMISSION_REPLACEMENT);
    text += `\n${BTW_MARKER}\n${COMPOSER}`;
  } else if (asset === BTW_ASSETS[2]) {
    text = once(text, "parentNavigationPath:s}){if(bc(i))", "parentNavigationPath:s,sideQuestion:__azraelSideQuestion=!1}){if(bc(i))");
    text = once(text, "developerInstructions:l.trim()?`${l}\\n\\n${eJi}`:eJi,sideConversation:!0,sideConversationParentNavigationPath:s", "developerInstructions:__azraelSideQuestion?" + JSON.stringify(INSTRUCTIONS) + ":l.trim()?`${l}\\n\\n${eJi}`:eJi,...__azraelSideQuestion?{sideQuestion:!0,model:a.settings.model,reasoningEffort:a.settings.reasoning_effort,modelProvider:(()=>{let provider=Bp(e,i).getConversation(t)?.modelProvider;return a.settings.model.startsWith(`managed/`)||a.settings.model.startsWith(`devin/`)?void 0:[`azrael-managed`,`devin`].includes(provider)?`openai`:provider})()}:{},sideConversation:!0,sideConversationParentNavigationPath:s");
    text = once(text, "onCreationError:g,target:_=`right`,durable:v", "onCreationError:g,sideQuestion:__azraelSideQuestion=!1,target:_=`right`,durable:v");
    text = once(text, "A=async()=>Qqi({scope:e,sourceConversationId:i,", "A=async()=>Qqi({scope:e,sideQuestion:__azraelSideQuestion,sourceConversationId:i,");
    text = 'import{ZIt as __azraelBtwButton,$It as __azraelInitBtwButton}from"./app-initial-7a199c66e670.js";' + text;
    text += `\n${BTW_MARKER}\n${SIDE}`;
  } else {
    // Native expired-side-chat recreation omits the tool-free fork flag.
    // Keep that action from silently turning a /btw panel into an ordinary fork.
    text = once(text, "_=()=>{i==null||h||(g(!0),Hr(c,bg,", "_=()=>{if(globalThis.__azraelBtw?.lookup(n)){c.get(un).danger(\"별도 대화가 종료되었습니다. 본 작업에서 /btw를 다시 실행해 주세요.\");return}i==null||h||(g(!0),Hr(c,bg,");
    text += `\n${BTW_MARKER}\n`;
  }
  return { text, count: 1 };
}

module.exports = { BTW_ASSETS, BTW_MARKER, BTW_COMPOSER_ADMISSION_ANCHOR, BTW_COMPOSER_ADMISSION_REPLACEMENT, INSTRUCTIONS, injectBtw };
