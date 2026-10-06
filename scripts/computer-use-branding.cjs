"use strict";
const crypto = require("node:crypto");
const SKY_EXECUTABLE = "node_modules/@oai/sky/bin/windows/codex-computer-use.exe";
const SOURCE_SHA256 = "8010e5ed48dfd9c06b73b564e020ed1cce5914071a46725c8702360e4c71dd9c";
const BRANDED_SHA256 = "f53739eb9cb70ee5707a6e71c8f6469afaba208e6e09f5ecb37745ede19ae777";
const BEFORE = Buffer.from("Codex is using your computer");
const AFTER = Buffer.from("Azrael is using the computer");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function brandComputerUse(bytes) {
  const sourceSha256 = sha256(bytes);
  if (sourceSha256 === BRANDED_SHA256) return { content: Buffer.from(bytes), transform: { id: "azrael-sky-display-v1", sourceSha256, upstreamSha256: SOURCE_SHA256, signature: "unsigned-local-copy", before: BEFORE.toString(), after: AFTER.toString(), labelOffset: bytes.indexOf(AFTER) } };
  if (sourceSha256 !== SOURCE_SHA256) throw new Error("Unsupported Sky Windows executable for Azrael display branding");
  const labelOffset = bytes.indexOf(BEFORE);
  if (BEFORE.length !== AFTER.length || labelOffset < 0 || bytes.indexOf(BEFORE, labelOffset + 1) >= 0) throw new Error("Sky display branding anchor changed");
  // Microsoft PE32+ layout: retain every section offset and executable instruction.
  const pe = bytes.readUInt32LE(0x3c), optional = pe + 24;
  if (bytes.toString("ascii", 0, 2) !== "MZ" || bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(optional) !== 0x20b) throw new Error("Unsupported Sky PE format");
  const securityDirectory = optional + 112 + 4 * 8;
  const certificateOffset = bytes.readUInt32LE(securityDirectory), certificateBytes = bytes.readUInt32LE(securityDirectory + 4);
  if (!certificateOffset || !certificateBytes || certificateOffset + certificateBytes !== bytes.length) throw new Error("Unsupported Sky certificate layout");
  const content = Buffer.from(bytes);
  AFTER.copy(content, labelOffset);
  // The modified local copy cannot claim the upstream Authenticode signature.
  // Clear its certificate directory and optional checksum; keep file layout intact.
  content.fill(0, securityDirectory, securityDirectory + 8);
  content.writeUInt32LE(0, optional + 64);
  if (sha256(content) !== BRANDED_SHA256) throw new Error("Unexpected Azrael Sky display output");
  return { content, transform: { id: "azrael-sky-display-v1", sourceSha256, signature: "unsigned-local-copy", before: BEFORE.toString(), after: AFTER.toString(), labelOffset } };
}
module.exports = { SKY_EXECUTABLE, SOURCE_SHA256, brandComputerUse };
