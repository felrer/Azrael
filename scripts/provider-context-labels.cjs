"use strict";
const MARKER = "/*azrael-provider-context-v2*/";

// Marker coordination and generic descriptor translations are shared dependencies.
// Optional controls run before labels, preserving the public injector's bytes/counts.
function runProviderContext(text, asset, injectControls) {
  if (text.includes(MARKER)) return { text, count: 0 };
  const controls = injectControls ? injectControls(text, asset) : { text, count: 0 };
  text = controls.text;
  let count = controls.count;
  const labels = new Set(["settings.agent.configuration.chatConfirmation.header","settings.agent.configuration.chatConfirmation.title","settings.configuration.codexDefaults","settings.nav.agent","settings.section.agent","settings.title","settings.codex.title"]);
  text=text.replace(/(id:`([^`]+)`,defaultMessage:`)([^`]*(?:Codex|azrael)[^`]*)(`)|("([^"]+)":`)([^`]*(?:Codex|azrael)[^`]*)(`)/g,(all,start,id,value,end,localStart,localId,localValue,localEnd)=>{
    if (!labels.has(id ?? localId)) return all;
    count++;return (start ?? localStart)+(value ?? localValue).replace(/Codex|azrael/g,"Azrael")+(end ?? localEnd);
  });
  return count ? {text:text+"\n"+MARKER,count} : {text,count:0};
}
module.exports = { MARKER, runProviderContext };
