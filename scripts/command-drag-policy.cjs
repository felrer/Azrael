"use strict";

// Serialized into the shared renderer bootstrap. Keep ordinary UI events native.
function installCommandDragBlock(view) {
  const document = view.document;
  const block = event => {
    const element = event.target?.closest ? event.target : event.target?.parentElement;
    if (!element?.closest(".azrael-command-execution")) return;
    event.preventDefault();
    event.stopPropagation();
  };
  for (const name of ["selectstart", "dragstart"]) document.addEventListener(name, block, true);
  return () => {
    for (const name of ["selectstart", "dragstart"]) document.removeEventListener(name, block, true);
  };
}

// Called only at the pinned dynamic-tool renderer boundary.
function wrapCommandDragBlock(item, content, jsx) {
  if (item.type !== "dynamic-tool-call" || (item.namespace != null && item.namespace !== "functions") ||
      !["exec", "exec_command", "write_stdin"].includes(item.tool)) return content;
  return jsx("div", { className: "azrael-command-execution", children: content });
}

const COMMAND_DRAG_CSS = "/*azrael-command-drag-css-v1*/.azrael-command-execution,.azrael-command-execution *{user-select:none!important;-webkit-user-select:none!important;-webkit-user-drag:none!important}";
module.exports = { installCommandDragBlock, wrapCommandDragBlock, COMMAND_DRAG_CSS };
