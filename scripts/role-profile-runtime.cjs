"use strict";

// Host admission adapter. Persistent configuration belongs to RoleProfileStore;
// execution and resume enforcement belong to the native role_profile policy.
function nativePolicy(capture, commonInstructions) {
  if (!capture || !["team", "direct"].includes(capture.mode) || !Array.isArray(capture.profiles)) throw Error("Role profile capture is unavailable");
  const role = capture.mode === "team" ? "lead" : "root";
  const profileId = role === "lead" ? capture.leadProfileId : capture.rootProfileId;
  const selected = capture.profiles.find(p => p.id === profileId);
  if (!selected?.allowedRoles?.includes(role)) throw Error("Selected profile cannot serve this role");
  const profiles = capture.profiles.map(p => ({
    id: p.id, name: p.name, allowed_roles: p.allowedRoles, ...(p.model == null ? {} : { model: p.model }),
    ...(p.provider == null ? {} : { provider: p.provider }),
    ...(p.reasoningEffort == null ? {} : { reasoning_effort: p.reasoningEffort }),
    instructions: p.instructions,
    profile_extension: {
      ...require("./instruction-workbench.cjs").validateProfileResources(p),
      ...(p.image == null ? {} : { image: p.image }),
    },
  }));
  return {
    role, profile_id: profileId, profiles,
    root_profile_ids: capture.rootProfileIds ?? [], subagent_profile_ids: capture.subagentProfileIds ?? [],
    ...(commonInstructions ? { base_developer_instructions: commonInstructions } : {}),
  };
}

function applyCapture(params, capture, capturedPolicy) {
  const common = params.developerInstructions;
  const policy = capturedPolicy ?? nativePolicy(capture, common);
  const selected = policy.profiles.find(p => p.id === policy.profile_id);
  return {
    ...params, ...(selected.model == null ? {} : { model: selected.model }),
    ...(selected.provider == null ? {} : { modelProvider: selected.provider }),
    config: { ...params.config, role_profile: policy, ...(selected.reasoning_effort == null ? {} : { model_reasoning_effort: selected.reasoning_effort }) },
    developerInstructions: [common, selected.instructions].filter(Boolean).join("\n\n"),
  };
}

class RoleProfileRuntime {
  constructor({ capture, createTeamConfiguration, materializeProfile }) { this.capture = capture; this.createTeamConfiguration = createTeamConfiguration; this.materializeProfile = materializeProfile; }
  async materializePolicy(policy, captured, options = {}) {
    for (const profile of policy.profiles) {
      const source = captured.profiles.find(p => p.id === profile.id);
      if (source.diagnostics?.length) throw Error("Profile resources have unresolved diagnostics");
      if (source.optionalSelection !== undefined || source.components?.length || source.providerAccount) {
        if (typeof this.materializeProfile !== "function") throw Error("Profile materialization is unavailable");
        profile.profile_extension.agentProfile = await this.materializeProfile({ revision: captured.revision, roleProfile: true, ...(captured.projectId == null ? {} : { projectId: captured.projectId }), profile: source, components: source.components ?? [] }, options);
        if (!profile.profile_extension.agentProfile) throw Error("Profile materialization failed");
      }
    }
    return policy;
  }
  async prepare(hostId, method, params, teamCapture) {
    if (method !== "thread/start") return params;
    // Do not turn a remote creation into a local mode, or accept UI supplied policy.
    if (hostId !== "local") {
      if (teamCapture) throw Error("Role profiles require the native local host");
      return params;
    }
    const config = { ...params.config }; delete config.role_profile;
    const captured = teamCapture ?? await this.capture("direct");
    const policy = captured.mode === "team"
      ? await this.createTeamConfiguration(captured, params.developerInstructions)
      : nativePolicy(captured, params.developerInstructions);
    if (captured.mode !== "team") await this.materializePolicy(policy, captured, { cwd: params.cwd ?? null, config: params.config ?? {} });
    return applyCapture({ ...params, config }, captured, policy);
  }
}

async function materializePolicy(capture, common, materializeProfile, options = {}) {
  return new RoleProfileRuntime({ materializeProfile }).materializePolicy(nativePolicy(capture, common), capture, options);
}
module.exports = { RoleProfileRuntime, nativePolicy, applyCapture, materializePolicy };
