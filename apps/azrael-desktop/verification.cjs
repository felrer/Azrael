"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { nativeImage } = require("electron");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.verify = async function({ window, primaryPanel, terminal, dialogs, openFile, sendAction, uri, root, workspace, expectedDark, errors }) {
  const result = { checks: [], errors: [], screenshots: [] };
  const chat = primaryPanel.view.webContents;
  const shell = window.webContents;
  for (const contents of [chat, shell]) if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  async function evaluate(contents, expression) {
    const response = await contents.debugger.sendCommand("Runtime.evaluate", { expression, returnByValue: true, timeout: 5000 });
    if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }
  async function until(description, predicate, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await predicate()) return; await delay(100); }
    throw Error(`Timed out: ${description}`);
  }
  async function check(name, callback) {
    try { await callback(); result.checks.push(name); }
    catch (cause) { result.errors.push(`${name}: ${cause.message}`); }
  }
  async function capture(contents, name) {
    await delay(200);
    const screenshot = await contents.debugger.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    const bytes = Buffer.from(screenshot.data, "base64");
    await fs.writeFile(path.join(root, name), bytes);
    result.screenshots.push(name);
    return nativeImage.createFromBuffer(bytes);
  }
  await check("existing-composer", async () => {
    await until("visible existing composer", () => evaluate(chat, `(() => {
      const input = document.querySelector('[contenteditable=true],textarea');
      if (!input) return false;
      const box = input.getBoundingClientRect(), style = getComputedStyle(input);
      if (box.width < 20 || box.height < 10 || style.visibility !== 'visible') return false;
      return document.elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2).some(node => node === input || input.contains(node));
    })()`), 30000);
    await delay(1500);
    await until("settled authenticated composer", () => evaluate(chat, `(() => {
      const e = document.querySelector('[contenteditable=true],textarea');
      if (!e) return false;
      const b=e.getBoundingClientRect(), top=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
      return b.width>20 && b.height>10 && (top===e || e.contains(top)) && !/ChatGPT로 로그인|Sign in with ChatGPT|Log in with ChatGPT/i.test(document.body.innerText);
    })()`), 15000);
    await evaluate(chat, 'document.querySelector("[contenteditable=true],textarea").focus()');
    await chat.debugger.sendCommand("Input.insertText", { text: "Azrael draft fixture" });
    await until("native composer draft input", () => evaluate(chat, 'document.querySelector("[contenteditable=true],textarea")?.textContent.includes("Azrael draft fixture")'));
    for (const type of ["keyDown", "keyUp"]) await chat.debugger.sendCommand("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    for (const type of ["keyDown", "keyUp"]) await chat.debugger.sendCommand("Input.dispatchKeyEvent", { type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    await until("draft cleared without sending", () => evaluate(chat, '!document.querySelector("[contenteditable=true],textarea")?.textContent.includes("Azrael draft fixture")'));
    result.theme = await evaluate(chat, '({background:getComputedStyle(document.documentElement).backgroundColor,color:getComputedStyle(document.body).color,font:getComputedStyle(document.body).fontFamily,kind:document.body.dataset.vscodeThemeKind,rootTheme:document.documentElement.dataset.theme,windowType:document.documentElement.dataset.codexWindowType})');
    assert.equal(result.theme.kind, expectedDark ? "vscode-dark" : "vscode-light");
    assert.equal(result.theme.rootTheme, expectedDark ? "dark" : "light");
    const foreground = result.theme.color.match(/[\d.]+/g).slice(0, 3).map(Number);
    assert.equal(foreground.reduce((a, b) => a + b, 0) / 3 > 128, expectedDark, "Foreground must follow the selected theme");
    assert.match(result.theme.font, /Segoe|system|sans-serif/i);
    const screenshot = await capture(chat, "chat.png");
    const bitmap = screenshot.getBitmap(), width = screenshot.getSize().width;
    const pixel = [...bitmap.subarray((4 * width + 4) * 4, (4 * width + 4) * 4 + 4)];
    result.theme.canvasPixel = pixel;
    assert.equal(pixel[3], 255, "Rendered host canvas must be opaque");
    assert.equal(pixel.slice(0, 3).reduce((a, b) => a + b, 0) / 3 < 128, expectedDark);
  });
  await check("host-input-dialog", async () => {
    const pending = dialogs.requestInput({ title: "검증 입력", prompt: "독립 앱 입력 확인", value: "Azrael", validateInput: value => value === "Azrael" ? undefined : "Azrael을 입력하세요." });
    await until("input dialog visible", () => evaluate(shell, '!!document.querySelector("dialog[open] input")'));
    await capture(shell, "input-dialog.png");
    await evaluate(shell, 'document.querySelector("dialog[open] form").requestSubmit()');
    assert.equal(await pending, "Azrael");
    await until("chat restored after dialog", () => primaryPanel.visible);
    const options = [{ label: "선택 A", description: "첫 항목" }, { label: "선택 B", description: "둘째 항목" }];
    const choice = dialogs.requestPick(options, { title: "검증 선택", canPickMany: true });
    await until("quick pick visible", () => evaluate(shell, 'document.querySelectorAll("dialog[open] [role=option]").length===2'));
    await evaluate(shell, 'document.querySelector("dialog[open] [role=option]").click()');
    await capture(shell, "pick-dialog.png");
    await evaluate(shell, 'document.querySelector("dialog[open] form").requestSubmit()');
    assert.deepEqual(await choice, [options[0]]);
  });
  await check("existing-chat-history", async () => {
    await evaluate(chat, 'window.dispatchEvent(new CustomEvent("open-recent-tasks-menu"))');
    await until("existing history search", () => evaluate(chat, '!!document.getElementById("recent-tasks-search")'));
    await until("empty history loaded", () => evaluate(chat, '/No chats yet|아직 채팅이 없습니다/.test(document.body.innerText)'));
    assert.equal(await evaluate(chat, '/Failed to load chats|채팅을 불러오지 못/.test(document.body.innerText)'), false);
    await capture(chat, "chat-history.png");
    await evaluate(chat, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await until("history popup closed", () => evaluate(chat, '!document.getElementById("recent-tasks-search")'));
  });
  await check("literal-text-viewer", async () => {
    sendAction({ type: "file", path: path.join(workspace, "sample.md"), line: 3, column: 1 });
    await until("literal source text", () => evaluate(shell, 'document.querySelector(".azrael-detail-panel__text")?.textContent.includes("<script>")'));
    assert.equal(await evaluate(shell, 'typeof globalThis.__azraelInjected'), "undefined");
    await capture(shell, "text-panel.png");
  });
  await check("native-terminal", async () => {
    let id;
    const originalResize = terminal.resize;
    const sizes = [];
    terminal.resize = function(value) { sizes.push(value); return originalResize.call(this, value); };
    const rows = () => evaluate(shell, '[...document.querySelectorAll(".xterm-rows > div")].map(row=>row.textContent.replace(/\\u00a0/g," ").trimEnd())');
    const prompt = async () => (await rows()).some(row => /workspace>\s*$/i.test(row));
    const output = async marker => (await rows()).some(row => row.trim() === marker);
    result.terminalSteps = [];
    try {
    await evaluate(shell, 'document.getElementById("terminal").click()');
    await until("native terminal creation", async () => {
      const error = await evaluate(shell, 'document.querySelector("[data-error=true]")?.textContent || document.getElementById("app-error")?.textContent');
      if (error) throw Error(error);
      return terminal.sessions.size === 1;
    });
    id = [...terminal.sessions.keys()][0];
    await until("PowerShell ready prompt", prompt, 30000);
    result.terminalSteps.push("ready-prompt");
    await evaluate(shell, 'document.querySelector(".xterm-helper-textarea").focus()');
    for (const text of "Write-Output 'AZRAEL_PTY_OK'") await shell.debugger.sendCommand("Input.dispatchKeyEvent", { type: "char", text });
    for (const type of ["keyDown", "keyUp"]) await shell.debugger.sendCommand("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" && { text: "\r" }) });
    await until("native PTY output rendered", () => output("AZRAEL_PTY_OK"));
    await until("prompt after native command", prompt);
    result.terminalSteps.push("command-output");
    const previousSizes = sizes.length;
    window.setSize(1100, 840);
    await until("frontend terminal resize reaches native PTY", () => sizes.length > previousSizes && sizes.at(-1).id === id);
    result.terminalSizes = sizes.slice();
    result.terminalSteps.push("frontend-resize");
    await capture(shell, "terminal-panel.png");
    await evaluate(shell, 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
    assert.equal(await evaluate(shell, 'document.getElementById("detail").hidden'), true);
    assert(terminal.sessions.has(id));
    await terminal.write({ id, data: "Write-Output 'AZRAEL_HIDDEN_OK'\r" });
    await evaluate(shell, 'document.getElementById("terminal").click()');
    await until("hidden session output", () => output("AZRAEL_HIDDEN_OK"));
    result.terminalSteps.push("hidden-output");
    assert.equal([...terminal.sessions.keys()][0], id);
    await terminal.close({ id });
    assert.equal(terminal.sessions.size, 0);
    result.terminalSteps.push("closed");
    } catch (cause) {
      result.terminalFailure = { rows: await rows(), status: await evaluate(shell, 'document.querySelector("[data-error=true]")?.textContent || document.getElementById("app-error")?.textContent || ""') };
      await capture(shell, "terminal-failure.png");
      throw cause;
    } finally {
      terminal.resize = originalResize;
      if (id && terminal.sessions.has(id)) await terminal.close({ id });
    }
  });
  await check("native-image-viewer", async () => {
    await evaluate(shell, 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
    await openFile(uri.file(path.join(workspace, "sample.png")));
    await until("native image loaded", () => evaluate(chat, '[...document.images].some(img=>img.src.includes("sample.png")&&img.naturalWidth===1)'));
    await capture(chat, "image-viewer.png");
    await evaluate(chat, 'document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await until("native image closed", () => evaluate(chat, '![...document.images].some(img=>img.src.includes("sample.png"))'));
  });
  await check("narrow-detail-layout", async () => {
    window.setSize(800, 700);
    sendAction({ type: "file", path: path.join(workspace, "sample.md") });
    await until("narrow detail fills content", () => evaluate(shell, 'Math.abs(document.getElementById("detail").getBoundingClientRect().width-innerWidth)<2'));
    await capture(shell, "narrow-panel.png");
    await evaluate(shell, 'window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
  });
  result.errors.push(...errors);
  await fs.writeFile(path.join(root, "shell-state.json"), JSON.stringify(await evaluate(shell, '({text:document.body.innerText})'), null, 2));
  await fs.writeFile(path.join(root, "chat-state.json"), JSON.stringify(await evaluate(chat, '({text:document.body.innerText,inputs:[...document.querySelectorAll("[contenteditable=true],textarea")].map(e=>({rect:e.getBoundingClientRect().toJSON(),visibility:getComputedStyle(e).visibility})),buttons:[...document.querySelectorAll("button")].map(e=>({text:e.innerText,label:e.getAttribute("aria-label"),title:e.title}))})'), null, 2));
  await fs.writeFile(path.join(root, "result.json"), JSON.stringify(result, null, 2));
  return result;
};
