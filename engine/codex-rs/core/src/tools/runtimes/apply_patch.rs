//! Apply Patch runtime: executes verified patches under the orchestrator.
//!
//! Assumes `apply_patch` verification/approval happened upstream. Reuses the
//! selected turn environment filesystem for both local and remote turns, with
//! sandboxing enforced by the explicit filesystem sandbox context.
use crate::exec::is_likely_sandbox_denied;
use crate::session::turn_context::TurnEnvironment;
use crate::tools::sandboxing::Approvable;
use crate::tools::sandboxing::ApprovalAction;
use crate::tools::sandboxing::ExecApprovalRequirement;
use crate::tools::sandboxing::SandboxAttempt;
use crate::tools::sandboxing::Sandboxable;
use crate::tools::sandboxing::ToolCtx;
use crate::tools::sandboxing::ToolError;
use crate::tools::sandboxing::ToolRuntime;
use crate::tools::sandboxing::executor_windows_sandbox_selection;
use codex_apply_patch::AppliedPatchDelta;
use codex_apply_patch::ApplyPatchAction;
use codex_apply_patch::ApplyPatchOptions;
use codex_exec_server::CreateDirectoryOptions;
use codex_exec_server::ExecutorFileSystem;
use codex_exec_server::FileSystemSandboxContext;
use codex_exec_server::GetMetadataOptions;
use codex_exec_server::ReadFileOptions;
use codex_exec_server::WriteFileOptions;
use codex_protocol::error::CodexErr;
use codex_protocol::error::SandboxErr;
use codex_protocol::exec_output::ExecToolCallOutput;
use codex_protocol::exec_output::StreamOutput;
use codex_protocol::models::AdditionalPermissionProfile;
use codex_protocol::protocol::AskForApproval;
use codex_protocol::protocol::FileChange;
use codex_sandboxing::SandboxType;
use codex_sandboxing::SandboxablePreference;
use codex_sandboxing::is_likely_executor_managed_sandbox_denied;
use codex_sandboxing::policy_transforms::effective_permission_profile;
use codex_sandboxing::record_filesystem_sandbox_violation;
use codex_utils_path_uri::PathUri;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Debug, Eq, PartialEq, Hash, serde::Serialize)]
pub(crate) struct ApplyPatchApprovalKey {
    pub(crate) environment_id: String,
    pub(crate) path: PathUri,
}

#[derive(Debug)]
pub struct ApplyPatchRequest {
    pub(crate) exact_write: Option<ExactFileWrite>,
    pub turn_environment: TurnEnvironment,
    pub action: ApplyPatchAction,
    pub file_paths: Vec<PathUri>,
    pub changes: Arc<std::collections::HashMap<PathBuf, FileChange>>,
    pub exec_approval_requirement: ExecApprovalRequirement,
    pub additional_permissions: Option<AdditionalPermissionProfile>,
    pub permissions_preapproved: bool,
}

#[derive(Debug)]
pub(crate) struct ExactFileWrite {
    pub path: PathUri,
    /// None requires that the target still does not exist after approval.
    pub expected_content: Option<String>,
    pub content: String,
}

/// Canonicalizes the existing ancestor as well as existing targets. Missing
/// suffixes are retained so a Write can create nested directories safely.
pub(crate) async fn canonical_write_path(
    fs: &dyn ExecutorFileSystem,
    path: &PathUri,
    sandbox: Option<&FileSystemSandboxContext>,
) -> std::io::Result<PathUri> {
    let mut ancestor = path.clone();
    let mut missing: Vec<String> = Vec::new();
    loop {
        match fs.canonicalize(&ancestor, sandbox).await {
            Ok(mut canonical) => {
                for name in missing.iter().rev() {
                    canonical = canonical.join(name).map_err(std::io::Error::other)?;
                }
                return Ok(canonical);
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                // A dangling link is an existing filesystem entry, not a new
                // file or directory that this operation may overwrite.
                match fs
                    .get_metadata(
                        &ancestor,
                        GetMetadataOptions {
                            follow_symlinks: false,
                        },
                        sandbox,
                    )
                    .await
                {
                    Ok(_) => {
                        return Err(std::io::Error::other(
                            "cannot resolve an existing filesystem entry",
                        ));
                    }
                    Err(metadata_error)
                        if metadata_error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(metadata_error) => return Err(metadata_error),
                }
                missing.push(
                    ancestor
                        .basename()
                        .ok_or_else(|| std::io::Error::other("missing filename"))?,
                );
                ancestor = ancestor.parent().ok_or(err)?;
            }
            Err(err) => return Err(err),
        }
    }
}

impl ExactFileWrite {
    async fn apply(
        &self,
        fs: &dyn ExecutorFileSystem,
        sandbox: Option<&FileSystemSandboxContext>,
        follow_symlinks: bool,
    ) -> std::io::Result<AppliedPatchDelta> {
        if canonical_write_path(fs, &self.path, sandbox).await? != self.path {
            return Err(std::io::Error::other(
                "file path changed after Read or while awaiting approval; Read again",
            ));
        }
        if self.expected_content.is_none() {
            match fs
                .get_metadata(
                    &self.path,
                    GetMetadataOptions {
                        follow_symlinks: false,
                    },
                    sandbox,
                )
                .await
            {
                Ok(_) => {
                    return Err(std::io::Error::other(
                        "file appeared while awaiting approval; Read again",
                    ));
                }
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(err),
            }
        }
        let current = match fs
            .read_file(&self.path, ReadFileOptions { follow_symlinks }, sandbox)
            .await
        {
            Ok(bytes) => Some(bytes),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
            Err(err) => return Err(err),
        };
        if current.as_deref() != self.expected_content.as_deref().map(str::as_bytes) {
            return Err(std::io::Error::other(
                "file changed after Read or while awaiting approval; Read again",
            ));
        }
        if self.expected_content.is_none() {
            if let Some(parent) = self.path.parent() {
                fs.create_directory(
                    &parent,
                    CreateDirectoryOptions {
                        recursive: true,
                        follow_symlinks,
                    },
                    sandbox,
                )
                .await?;
            }
        }
        fs.write_file(
            &self.path,
            self.content.as_bytes().to_vec(),
            WriteFileOptions { follow_symlinks },
            sandbox,
        )
        .await?;
        Ok(AppliedPatchDelta::exact_file_write(
            self.path.clone(),
            self.expected_content.clone(),
            self.content.clone(),
        ))
    }
}

#[derive(Default)]
pub struct ApplyPatchRuntime {
    committed_delta: AppliedPatchDelta,
}

#[derive(Debug)]
pub struct ApplyPatchRuntimeOutput {
    pub exec_output: ExecToolCallOutput,
    pub delta: AppliedPatchDelta,
}

impl ApplyPatchRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn committed_delta(&self) -> &AppliedPatchDelta {
        &self.committed_delta
    }

    fn build_approval_action(req: &ApplyPatchRequest, call_id: &str) -> ApprovalAction {
        ApprovalAction::ApplyPatch {
            id: call_id.to_string(),
            environment_id: req.turn_environment.selection.environment_id.clone(),
            cwd: req.action.cwd.clone(),
            files: req.file_paths.clone(),
            patch: req.action.patch.clone(),
            changes: Arc::clone(&req.changes),
            permissions_preapproved: req.permissions_preapproved,
        }
    }

    fn file_system_sandbox_context_for_attempt(
        req: &ApplyPatchRequest,
        attempt: &SandboxAttempt<'_>,
    ) -> Option<FileSystemSandboxContext> {
        if !attempt.sandbox_requested {
            return None;
        }

        let permissions = effective_permission_profile(
            attempt.exec_server_permissions,
            req.additional_permissions.as_ref(),
        );
        Some(FileSystemSandboxContext {
            permissions,
            cwd: attempt.sandbox_cwd.clone(),
            workspace_roots: attempt.workspace_roots.to_vec(),
            user_home_dir: req.turn_environment.user_home_dir.clone(),
            temporary_directories: None,
            windows_sandbox_selection: executor_windows_sandbox_selection(
                attempt.windows_sandbox_type,
                attempt.windows_sandbox_level,
                attempt.sandbox_cwd,
            ),
            windows_sandbox_proxy_settings_mode: None,
            use_legacy_landlock: attempt.use_legacy_landlock,
        })
    }
}

impl Sandboxable for ApplyPatchRuntime {
    fn sandbox_preference(&self) -> SandboxablePreference {
        SandboxablePreference::Auto
    }
    fn escalate_on_failure(&self) -> bool {
        true
    }
}

impl Approvable<ApplyPatchRequest> for ApplyPatchRuntime {
    fn approval_action(
        &self,
        req: &ApplyPatchRequest,
        call_id: &str,
    ) -> std::io::Result<ApprovalAction> {
        Ok(ApplyPatchRuntime::build_approval_action(req, call_id))
    }

    fn wants_no_sandbox_approval(&self, policy: AskForApproval) -> bool {
        match policy {
            AskForApproval::Never => false,
            AskForApproval::Granular(granular_config) => granular_config.allows_sandbox_approval(),
            AskForApproval::OnRequest => true,
            AskForApproval::UnlessTrusted => true,
        }
    }

    // apply_patch approvals are decided upstream by assess_patch_safety.
    //
    // This override ensures the orchestrator runs the patch approval flow when required instead
    // of falling back to the global exec approval policy.
    fn exec_approval_requirement(
        &self,
        req: &ApplyPatchRequest,
    ) -> Option<ExecApprovalRequirement> {
        Some(req.exec_approval_requirement.clone())
    }
}

impl ToolRuntime<ApplyPatchRequest, ApplyPatchRuntimeOutput> for ApplyPatchRuntime {
    fn turn_environment<'a>(&self, req: &'a ApplyPatchRequest) -> &'a TurnEnvironment {
        &req.turn_environment
    }

    fn uses_executor_managed_process_sandbox(&self, req: &ApplyPatchRequest) -> bool {
        req.turn_environment.environment.is_remote()
    }

    fn sandbox_cwd<'a>(&self, req: &'a ApplyPatchRequest) -> Option<&'a PathUri> {
        Some(&req.action.cwd)
    }

    async fn run(
        &mut self,
        req: &ApplyPatchRequest,
        attempt: &SandboxAttempt<'_>,
        _ctx: &ToolCtx,
    ) -> Result<ApplyPatchRuntimeOutput, ToolError> {
        let started_at = Instant::now();
        let fs = req.turn_environment.environment.get_filesystem();
        let sandbox = Self::file_system_sandbox_context_for_attempt(req, attempt);
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let follow_symlinks = attempt.sandbox_requested
            || !attempt.manager.should_sandbox(
                attempt.permissions,
                self.sandbox_preference(),
                attempt.enforce_managed_network,
            );
        let result = if let Some(write) = &req.exact_write {
            match write
                .apply(fs.as_ref(), sandbox.as_ref(), follow_symlinks)
                .await
            {
                Ok(delta) => {
                    stdout.extend_from_slice(
                        format!(
                            "Success. Updated file: {}\n",
                            write.path.inferred_native_path_string()
                        )
                        .as_bytes(),
                    );
                    Ok(delta)
                }
                Err(err) => {
                    stderr.extend_from_slice(format!("{err}\n").as_bytes());
                    // Failed preconditions commit no textual mutation.
                    Err((err.to_string(), AppliedPatchDelta::default()))
                }
            }
        } else {
            codex_apply_patch::apply_patch_with_options(
                &req.action.patch,
                ApplyPatchOptions {
                    // Only reject links when an otherwise-required sandbox was bypassed.
                    // Executor-managed sandboxes can have SandboxType::None.
                    follow_symlinks: attempt.sandbox_requested
                        || !attempt.manager.should_sandbox(
                            attempt.permissions,
                            self.sandbox_preference(),
                            attempt.enforce_managed_network,
                        ),
                },
                &req.action.cwd,
                &mut stdout,
                &mut stderr,
                fs.as_ref(),
                sandbox.as_ref(),
            )
            .await
            .map_err(|failure| {
                let (error, delta) = failure.into_parts();
                (error.to_string(), delta)
            })
        };
        let stdout = String::from_utf8_lossy(&stdout).into_owned();
        let stderr = String::from_utf8_lossy(&stderr).into_owned();
        let failed = result.is_err();
        let exit_code = if failed { 1 } else { 0 };
        let delta = match result {
            Ok(delta) => delta,
            Err((_, delta)) => delta,
        };
        self.committed_delta.append(delta);
        let output = ExecToolCallOutput {
            exit_code,
            stdout: StreamOutput::new(stdout.clone()),
            stderr: StreamOutput::new(stderr.clone()),
            aggregated_output: StreamOutput::new(format!("{stdout}{stderr}")),
            duration: started_at.elapsed(),
            timed_out: false,
        };
        let sandbox_denied = failed
            && if attempt.sandbox == SandboxType::None {
                attempt.sandbox_requested && is_likely_executor_managed_sandbox_denied(&output)
            } else {
                is_likely_sandbox_denied(attempt.sandbox, &output)
            };
        if sandbox_denied {
            // TODO(iceweasel): Report executor filesystem sandbox backends like process/start so
            // executor-managed apply_patch denials can emit backend-specific violation telemetry.
            if attempt.sandbox != SandboxType::None {
                record_filesystem_sandbox_violation(attempt.sandbox, &output);
            }
            return Err(ToolError::Codex(CodexErr::Sandbox(SandboxErr::Denied {
                output: Box::new(output),
                network_policy_decision: None,
            })));
        }
        Ok(ApplyPatchRuntimeOutput {
            exec_output: output,
            delta: self.committed_delta.clone(),
        })
    }
}

#[cfg(test)]
#[path = "apply_patch_tests.rs"]
mod tests;
