import * as path from "node:path";
import * as fs from "node:fs/promises";
import { spawn as spawnHelper } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { RateLimitWindow } from "./protocol";

export interface DevinUsageSnapshot {
  daily: RateLimitWindow | null;
  weekly: RateLimitWindow | null;
  updatedAt: number;
}

export function parseDevinScreen(text: string, now = Date.now()): DevinUsageSnapshot | null {
  const read = (label: string, duration: number): RateLimitWindow | null => {
    const match = new RegExp(`\\b${label}[^\\n]*?\\s([0-9]+(?:\\.[0-9]+)?)%\\s*used`, "i").exec(text);
    if (!match) return null;
    const usedPercent = Number(match[1]);
    if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
    const after = text.slice(match.index, match.index + 350).split(/\n(?=.*(?:Daily|Weekly))/)[0];
    let resetsAt: number | null = null;
    const relative = /reset(?:s)?\s+in\s+(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?/i.exec(after);
    if (relative && relative.slice(1).some(Boolean)) resetsAt = Math.floor(now / 1000) + Number(relative[1] ?? 0) * 86400 + Number(relative[2] ?? 0) * 3600 + Number(relative[3] ?? 0) * 60;
    const absolute = /resets?\s+([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+\(UTC([+-]\d{1,2})(?::(\d{2}))?\)/i.exec(after);
    if (absolute) {
      const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(absolute[1].toLowerCase());
      const offsetMinutes = Number(absolute[6]) * 60 + Math.sign(Number(absolute[6])) * Number(absolute[7] ?? 0);
      const localNow = new Date(now + offsetMinutes * 60_000);
      const hour = Number(absolute[3]) % 12 + (absolute[5].toUpperCase() === "PM" ? 12 : 0);
      if (month >= 0 && Number(absolute[2]) <= 31 && Number(absolute[3]) >= 1 && Number(absolute[3]) <= 12 && Number(absolute[4]) < 60) {
        let candidate = Date.UTC(localNow.getUTCFullYear(), month, Number(absolute[2]), hour, Number(absolute[4])) - offsetMinutes * 60_000;
        if (candidate < now - 180 * 86400_000) candidate = Date.UTC(localNow.getUTCFullYear() + 1, month, Number(absolute[2]), hour, Number(absolute[4])) - offsetMinutes * 60_000;
        resetsAt = candidate / 1000;
      }
    }
    return { usedPercent, resetsAt, windowDurationMins: duration };
  };
  const daily = read("Daily", 1440);
  const weekly = read("Weekly", 10080);
  if (!daily || !weekly) return null;
  return { daily, weekly, updatedAt: now };
}

export class DevinUsageService {
  snapshot: DevinUsageSnapshot | undefined;
  error: string | undefined;
  private pending: Promise<void> | undefined;
  private cancel: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly executable: string | undefined, private readonly codexHome: string) {}

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.read().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  dispose(): void { this.disposed = true; this.cancel?.(); }
  cancelRefresh(): void { this.cancel?.(); }

  private async read(): Promise<void> {
    if (this.disposed) return;
    if (!this.executable || !path.isAbsolute(this.executable)) { this.error = "Devin CLI 연결이 필요합니다."; return; }
    // Isolate the native PTY and its helper handles from the extension host.
    // Electron must run this child as Node, including node-pty's own forks.
    await new Promise<void>(resolve => {
      const child = spawnHelper(process.execPath, [__filename, "--devin-usage-child", this.executable!, this.codexHome], {
        windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
      });
      let result: { snapshot?: DevinUsageSnapshot; error?: string } | undefined;
      let settled = false;
      let cancelled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const finish = (error?: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (killTimer) clearTimeout(killTimer);
        if (result?.snapshot && !error) this.snapshot = result.snapshot;
        this.error = error ?? result?.error;
        this.cancel = undefined;
        resolve();
      };
      const cancel = (): void => {
        if (cancelled || settled) return;
        cancelled = true;
        result = { error: "Devin 사용량 조회가 취소됐습니다." };
        if (child.connected) child.send("cancel");
        killTimer = setTimeout(() => child.kill(), 4000);
      };
      const deadline = setTimeout(() => { cancel(); this.error = "Devin 사용량 실행기가 응답하지 않습니다."; }, 45_000);
      this.cancel = cancel;
      child.on("message", message => {
        if (!cancelled && typeof message === "object" && message !== null) result = message as typeof result;
      });
      child.on("error", () => finish("Devin 사용량 실행기를 시작하지 못했습니다."));
      child.on("exit", code => finish(code === 0 && result ? undefined : "Devin 사용량 실행기가 정상 종료되지 않았습니다."));
    });
  }

  async readNative(): Promise<void> {
    if (this.disposed) return;
    if (!this.executable || !path.isAbsolute(this.executable)) { this.error = "Devin CLI 연결이 필요합니다."; return; }
    try {
      const { spawn } = await import("node-pty");
      const { Terminal } = await import("@xterm/headless");
      const work = path.join(this.codexHome, "azrael", "devin-usage");
      await fs.mkdir(work, { recursive: true });
      if (this.disposed) return;
      const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color", NO_COLOR: "1" };
      delete env.WINDSURF_API_KEY;
      const terminal = new Terminal({ cols: 180, rows: 60, scrollback: 200, allowProposedApi: true });
      // Reuse CLI-owned configuration: a fresh --config triggers onboarding
      // before the interactive /usage command can run, even when signed in.
      const child = spawn(this.executable, ["--respect-workspace-trust", "false"], { name: "xterm-256color", cols: 180, rows: 60, cwd: work, env });
      // Respond to terminal device/status queries emitted by the CLI.
      terminal.onData(data => { try { child.write(data); } catch {} });
      let completed = false;
      let exited = false;
      let sent = false;
      let enterSent = false;
      let fetching = false;
      let received = 0;
      let transcript = "";
      let latestScreen = "";
      let sendTimer: NodeJS.Timeout | undefined;
      let enterTimer: NodeJS.Timeout | undefined;
      let exitTimer: NodeJS.Timeout | undefined;
      let forceTimer: NodeJS.Timeout | undefined;
      const output = await new Promise<DevinUsageSnapshot>((resolve, reject) => {
        const deadline = setTimeout(() => finish(undefined, "Devin 사용량 조회 시간이 초과됐습니다."), 35_000);
        const finish = (snapshot?: DevinUsageSnapshot, error?: string): void => {
          if (completed) return;
          completed = true;
          clearTimeout(deadline);
          if (sendTimer) clearTimeout(sendTimer);
          if (enterTimer) clearTimeout(enterTimer);
          // Only slash commands are sent. Never submit a natural-language prompt.
          if (!exited) {
            try {
              if (snapshot) {
                child.write("/exit\r");
                exitTimer = setTimeout(() => { try { child.write("\r"); } catch {} }, 1000);
              } else { child.write("\x03"); }
            } catch {}
            forceTimer = setTimeout(() => { if (!exited) { try { child.kill(); } catch {} } }, 2500);
          }
          if (snapshot) resolve(snapshot); else reject(new Error(error));
        };
        this.cancel = () => finish(undefined, "Devin 사용량 조회가 취소됐습니다.");
        child.onExit(() => {
          exited = true;
          if (exitTimer) clearTimeout(exitTimer);
          if (forceTimer) clearTimeout(forceTimer);
          terminal.dispose();
          if (!completed) finish(undefined, "Devin CLI가 사용량을 반환하지 않고 종료됐습니다.");
        });
        child.onData(data => {
          received += data.length;
          if (received > 1024 * 1024) { finish(undefined, "Devin 사용량 화면 크기를 초과했습니다."); return; }
          if (completed) return;
          transcript += data;
          terminal.write(data, () => {
            if (completed) return;
            const lines: string[] = [];
            for (let i = 0; i < terminal.buffer.active.length; i++) lines.push(terminal.buffer.active.getLine(i)?.translateToString(true) ?? "");
            const screen = lines.join("\n");
            latestScreen = screen;
            const plainOutput = stripVTControlCharacters(transcript);
            if (!sent && /Ask Devin to build features, fix bugs, or work on your code/.test(plainOutput)) {
              sent = true;
              sendTimer = setTimeout(() => {
                try { child.write("/usage"); }
                catch { finish(undefined, "Devin 명령을 전송하지 못했습니다."); }
              }, 300);
            }
            fetching ||= /Fetching quota|No quota consumed yet in this session/.test(plainOutput);
            // Wait for the CLI to echo the complete command. Submitting on a
            // fixed short delay can race the interactive slash-command picker.
            if (sent && !enterSent && /[❭❯>]\s*\/usage\b/.test(screen)) {
              enterSent = true;
              enterTimer = setTimeout(() => {
                if (!completed && !fetching) {
                  try { child.write("\r"); } catch {}
                  // The pinned CLI may consume the first Enter to accept its
                  // slash-command picker. A distinct second Enter submits it.
                  enterTimer = setTimeout(() => {
                    if (!completed && !fetching && /[❭❯>]\s*\/usage\b/.test(latestScreen)) { try { child.write("\r"); } catch {} }
                  }, 1000);
                }
              }, 1000);
            }
            const parsed = sent && /No quota consumed yet in this session/.test(plainOutput) ? parseDevinScreen(screen) : null;
            if (parsed) finish(parsed);
          });
        });
      });
      this.snapshot = output;
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error && error.message.startsWith("Devin") ? error.message : "Devin 사용량 실행기를 시작하지 못했습니다.";
    } finally { this.cancel = undefined; }
  }
}

if (require.main === module && process.argv[2] === "--devin-usage-child") {
  const service = new DevinUsageService(process.argv[3], process.argv[4]);
  process.on("message", message => { if (message === "cancel") service.dispose(); });
  void service.readNative().then(() => {
    process.send?.({ snapshot: service.snapshot, error: service.error });
    service.dispose();
    // The PTY gets its graceful /exit and bounded kill window before the helper
    // ends. Native addon event-loop handles must not retain the VS Code host.
    setTimeout(() => process.exit(0), 3000);
  }).catch(() => process.exit(1));
}
