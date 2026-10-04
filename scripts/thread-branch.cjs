"use strict";

// Serialized into the pinned webview. No Node APIs or module-scope dependencies.
async function inheritThreadBranchSelection(params, source, hostMode, readCatalog) {
  if (hostMode !== "default" || params.ephemeral || params.sideConversation || !source) return params;
  const nonempty = value => typeof value === "string" && value.trim() ? value : undefined;
  const settings = source.latestThreadSettings;
  const sourceProvider = source.modelProvider;
  const sourceMode = params.collaborationMode ?? settings?.collaborationMode ?? source.latestCollaborationMode;
  // Keep the click-time selection while discovery awaits an active source.
  const mode = sourceMode ? { ...sourceMode, settings: { ...sourceMode.settings } } : undefined;
  const model = nonempty(params.model) ?? nonempty(mode?.settings?.model) ??
    nonempty(settings?.model) ?? nonempty(source.latestModel);
  if (!model) {
    if (["azrael-managed", "devin"].includes(sourceProvider)) {
      throw new Error("분기할 원본의 모델 선택을 불러오지 못했습니다. 원본 대화를 다시 열어 주세요.");
    }
    return params;
  }
  const sourceModel = nonempty(settings?.model) ?? nonempty(source.latestModel);
  let effort = Object.hasOwn(params, "reasoningEffort") ? params.reasoningEffort :
    mode?.settings?.model === model ? mode.settings.reasoning_effort :
      sourceModel === model ? settings?.effort === undefined ? source.latestReasoningEffort : settings.effort : null;
  if (effort != null || model.startsWith("managed/") || model.startsWith("devin/")) {
    const models = await readCatalog();
    const row = models.find(row => row.model === model);
    if (!row) throw new Error("분기할 모델이 현재 모델 목록에 없습니다. 모델 목록을 새로고침해 주세요.");
    const choices = row.supportedReasoningEfforts ?? [];
    if (!choices.some(choice => choice.reasoningEffort === effort)) {
      effort = choices.some(choice => choice.reasoningEffort === row.defaultReasoningEffort)
        ? row.defaultReasoningEffort : choices[0]?.reasoningEffort ?? null;
    }
  }
  // Helper provider IDs are activated by select_model after config loading.
  // They are not configured native provider IDs and must not be supplied as
  // config provider overrides. Native forks retain their native provider.
  const provider = model.startsWith("managed/") || model.startsWith("devin/") ? undefined :
    ["azrael-managed", "devin"].includes(sourceProvider) ? "openai" : sourceProvider;
  return {
    ...params, model, modelProvider: params.modelProvider ?? provider, reasoningEffort: effort ?? null,
    // Native inherited goals must not start inference while fork setup is still
    // reconciling the child's selection. The user sends its first new turn.
    deferGoalContinuation: true,
    collaborationMode: { ...(mode ?? { mode: "default" }), settings: {
      ...(mode?.settings ?? { developer_instructions: null }), model, reasoning_effort: effort ?? null,
    } },
  };
}

module.exports = { inheritThreadBranchSelection };
