import * as vscode from "vscode";
import { AccountService } from "./accountService";
import { AccountState, isProfileId, isRecord } from "./protocol";
import { accountWarning, SwitchCompletionTracker } from "./accountPresentation";

export const OPENAI_ACCOUNT_ACTIONS = new Set([
  "openaiRefresh", "openaiSwitch", "openaiCancelSwitch", "openaiLogin",
  "openaiLoginCancel", "openaiReauth", "openaiCapture", "openaiRemove",
]);

/** Owns native OpenAI account actions and the status item. The unified UsageView owns the only webview. */
export class AccountView implements vscode.Disposable {
  private readonly switchTracker = new SwitchCompletionTracker();
  private loginId: string | undefined;
  private readonly stateListener = (state: AccountState) => {
    this.switchTracker.observe(state);
    if (!state.loginPending) this.loginId = undefined;
    this.updateStatus();
  };
  private readonly errorListener = () => this.updateStatus();
  readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 25);

  constructor(private readonly service: AccountService) {
    service.on("state", this.stateListener);
    service.on("errorState", this.errorListener);
  }

  initialize(): void {
    this.status.command = "azrael.accountQuickPick";
    this.status.name = "azrael account";
    this.updateStatus();
    this.status.show();
  }

  async refreshAll(): Promise<void> { await this.service.refresh(); }

  async quickPick(): Promise<void> {
    const state = this.service.state ?? await this.service.refresh();
    const items = state.profiles.map(profile => ({
      label: `${profile.id === state.activeProfileId ? "$(check) " : ""}${profile.email ?? profile.id}`,
      description: profile.planType ?? undefined,
      profile,
    }));
    const picked = await vscode.window.showQuickPick([
      ...items,
      { label: "$(add) OpenAI 계정 추가", description: undefined, profile: undefined },
      { label: "$(refresh) 새로고침", description: undefined, profile: null },
    ], { placeHolder: state.pendingProfileId ? "계정 전환이 대기 중입니다. 계정 페이지에서 취소할 수 있습니다." : "현재 엔진에서 사용할 OpenAI 계정 선택" });
    if (!picked) return;
    if (picked.profile === undefined) return this.login();
    if (picked.profile === null) return this.refreshAll();
    if (picked.profile.id !== state.activeProfileId) await this.perform("switch", picked.profile.id);
  }

  async handleMessage(message: unknown): Promise<boolean> {
    if (!isRecord(message) || typeof message.action !== "string" || !OPENAI_ACCOUNT_ACTIONS.has(message.action)) return false;
    const profileId = message.profileId;
    if (profileId !== undefined && !isProfileId(profileId)) return true;
    if (profileId !== undefined && !this.service.state?.profiles.some(profile => profile.id === profileId)) return true;
    switch (message.action) {
      case "openaiRefresh": await this.refreshAll(); break;
      case "openaiSwitch": if (profileId) await this.perform("switch", profileId); break;
      case "openaiCancelSwitch": await this.perform("cancelSwitch"); break;
      case "openaiLogin": await this.login(); break;
      case "openaiLoginCancel": await this.cancelLogin(); break;
      case "openaiReauth": if (profileId) await this.login(profileId); break;
      case "openaiCapture": await this.perform("captureCurrent"); break;
      case "openaiRemove": if (profileId) await this.remove(profileId); break;
    }
    return true;
  }

  dispose(): void {
    this.service.off("state", this.stateListener);
    this.service.off("errorState", this.errorListener);
    this.status.dispose();
  }

  private async perform(action: "switch" | "cancelSwitch" | "captureCurrent", profileId?: string): Promise<void> {
    await this.service.call({ action, profileId });
    if (action === "switch" && this.service.state?.isSwitching) {
      void vscode.window.showInformationMessage("진행 중인 작업이 유휴 상태가 되면 현재 엔진의 OpenAI 계정 전환이 완료됩니다.");
    }
    await this.refreshAll();
  }

  private async login(profileId?: string): Promise<void> {
    const response = await this.service.call({ action: "loginStart", profileId });
    const login = response.login;
    if (!login) throw new Error("엔진이 OpenAI 로그인 URL을 반환하지 않았습니다.");
    this.loginId = login.loginId;
    let uri: vscode.Uri;
    try { uri = vscode.Uri.parse(login.authUrl, true); } catch { throw new Error("엔진이 잘못된 OpenAI 로그인 URL을 반환했습니다."); }
    if (uri.scheme !== "https" && uri.scheme !== "http") throw new Error("지원하지 않는 OpenAI 로그인 URL입니다.");
    if (!await vscode.env.openExternal(uri)) {
      await this.service.call({ action: "loginCancel", loginId: login.loginId });
      this.loginId = undefined;
      throw new Error("OpenAI 로그인 페이지를 열지 못했습니다.");
    }
  }

  private async cancelLogin(): Promise<void> {
    await this.service.call({ action: "loginCancel", loginId: this.loginId });
    this.loginId = undefined;
  }

  private async remove(profileId: string): Promise<void> {
    const profile = this.service.state?.profiles.find(item => item.id === profileId);
    const answer = await vscode.window.showWarningMessage(
      `${profile?.email ?? profileId} 계정을 모든 Azrael 세션에서 제거할까요? 이 계정을 사용 중인 작업은 중지되고 사용 가능한 대체 계정이 있으면 전환됩니다. 대체 계정이 없으면 중지 상태로 남으며, 작업은 자동으로 재개되지 않습니다.`,
      { modal: true }, "제거",
    );
    if (answer === "제거") await this.service.call({ action: "remove", profileId });
  }

  private updateStatus(): void {
    const state = this.service.state;
    const warning = accountWarning(this.service.error, state);
    if (warning) {
      this.status.text = "$(warning) azrael account";
      this.status.tooltip = warning;
      return;
    }
    const active = state?.profiles.find(profile => profile.id === state.activeProfileId);
    this.status.text = state?.isSwitching ? "$(sync~spin) OpenAI account" : `$(account) ${active?.email ?? "OpenAI account"}`;
    this.status.tooltip = state?.pendingProfileId ? "OpenAI account switch pending" : "Switch this engine's OpenAI account";
  }
}
