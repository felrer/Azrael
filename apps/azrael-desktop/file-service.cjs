"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

function decodeText(bytes) {
  let encoding = "utf-8";
  let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = "utf-16le"; offset = 2; }
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = "utf-16be"; offset = 2; }
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offset = 3;
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)); }
  catch (cause) { throw new Error("텍스트 인코딩을 읽을 수 없습니다. UTF-8 또는 BOM이 있는 UTF-16 문서를 사용해주세요.", { cause }); }
  if (text.includes("\0")) throw new Error("바이너리 파일은 텍스트 뷰어에서 열 수 없습니다.");
  return text;
}

async function readTextFile(request) {
  if (!request || typeof request.path !== "string" || !path.isAbsolute(request.path) || request.path.includes("\0")) {
    throw new Error("열 파일의 절대 경로가 필요합니다.");
  }
  const canonical = await fs.realpath(request.path);
  const handle = await fs.open(canonical, "r");
  try {
    if (!(await handle.stat()).isFile()) throw new Error("일반 텍스트 파일을 선택해주세요.");
    return { path: canonical, text: decodeText(await handle.readFile()) };
  } finally { await handle.close(); }
}

module.exports = { readTextFile, decodeText };
