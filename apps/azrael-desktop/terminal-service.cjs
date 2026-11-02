"use strict";
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");

class TerminalService {
  constructor(transport, emit, { shell = process.env.ComSpec || "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", shellArgs } = {}) {
    this.transport = transport;
    this.emit = emit;
    this.shell = shell;
    this.shellArgs = shellArgs;
    this.sessions = new Map();
    this.notification = (method, p) => {
      if (method !== "command/exec/outputDelta" || !this.sessions.has(p?.processId)) return;
      if (p.capReached) this.emit({ id: p.processId, type: "error", message: "터미널 출력 한도에 도달했습니다." });
      if (typeof p.deltaBase64 === "string") {
        const session = this.sessions.get(p.processId);
        const stream = p.stream || "stdout";
        const decoder = session.decoders[stream] ||= new StringDecoder("utf8");
        this.emit({ id: p.processId, type: "data", data: decoder.write(Buffer.from(p.deltaBase64, "base64")) });
      }
    };
    transport.on("notification", this.notification);
  }
  size(value) {
    if (!value || !Number.isInteger(value.cols) || !Number.isInteger(value.rows) || value.cols < 2 || value.rows < 1 || value.cols > 65535 || value.rows > 65535) throw new Error("터미널 크기가 올바르지 않습니다.");
    return { cols: value.cols, rows: value.rows };
  }
  async create({ cwd, ...size }) {
    if (typeof cwd !== "string" || !path.isAbsolute(cwd) || !(await fs.stat(cwd)).isDirectory()) throw new Error("터미널 작업 폴더를 확인해주세요.");
    if (!this.transport.isConnected) throw new Error("엔진에 연결되지 않았습니다.");
    const id = randomUUID();
    const command = [this.shell, ...(this.shellArgs ?? (/(?:powershell|pwsh)(?:\.exe)?$/i.test(this.shell) ? ["-NoLogo"] : []))];
    const session = { id, ended: false, decoders: {} };
    this.sessions.set(id, session);
    // command/exec streams until exit. Keep its client deadline separate from
    // the server's disabled command timeout; ordinary RPC keeps its own default.
    session.completion = this.transport.request("command/exec", { command, cwd, processId: id, tty: true, size: this.size(size), disableTimeout: true, disableOutputCap: true }, 2147483647).then(result => {
      session.ended = true;
      for (const decoder of Object.values(session.decoders)) {
        const data = decoder.end();
        if (data) this.emit({ id, type: "data", data });
      }
      this.emit({ id, type: "exit", exitCode: result.exitCode });
    }, error => {
      session.ended = true;
      this.emit({ id, type: "error", message: error.message });
    }).finally(() => this.sessions.delete(id));
    return { id };
  }
  active(id) { if (!this.sessions.has(id)) throw new Error("터미널 세션이 종료되었습니다."); }
  write({ id, data }) {
    this.active(id);
    if (typeof data !== "string") throw new Error("터미널 입력이 올바르지 않습니다.");
    return this.transport.request("command/exec/write", { processId: id, deltaBase64: Buffer.from(data, "utf8").toString("base64") });
  }
  resize({ id, ...size }) { this.active(id); return this.transport.request("command/exec/resize", { processId: id, size: this.size(size) }); }
  async close({ id }) {
    if (!this.sessions.has(id)) return;
    await this.transport.request("command/exec/terminate", { processId: id });
    await this.sessions.get(id)?.completion;
  }
  async dispose() {
    const outcomes = await Promise.allSettled([...this.sessions.keys()].map(id => this.close({ id })));
    this.transport.off("notification", this.notification);
    this.transport.dispose();
    const failed = outcomes.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
module.exports = { TerminalService };
