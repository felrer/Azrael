"use strict";

// Serialized into the composer asset. Only terminal events clear drag state;
// attachment parsing and ordinary dragover handling retain their native owners.
function installWebviewDragCancellation(view, reset) {
  const document = view.document;
  const hidden = () => { if (document.hidden) reset(); };
  for (const name of ["drop", "dragend", "blur"]) view.addEventListener(name, reset, true);
  document.addEventListener("visibilitychange", hidden);
  return () => {
    for (const name of ["drop", "dragend", "blur"]) view.removeEventListener(name, reset, true);
    document.removeEventListener("visibilitychange", hidden);
  };
}

module.exports = { installWebviewDragCancellation };
