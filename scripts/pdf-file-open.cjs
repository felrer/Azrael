"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

async function openPdfInChrome(filePath) {
  // A successful browser launch does not establish that the requested file exists.
  // Validate it first so the provider can continue its existing path resolution.
  if (!fs.statSync(filePath).isFile()) throw new Error("PDF target is not a file.");
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA];
  const executable = roots.filter(Boolean)
    .map(root => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    .find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error("Google Chrome was not found in its standard installation paths.");

  await new Promise((resolve, reject) => {
    const child = spawn(executable, [pathToFileURL(filePath).href], {
      shell: false, windowsHide: true, detached: true, stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { openPdfInChrome };
