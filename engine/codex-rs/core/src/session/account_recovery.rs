//! Confirmed quota recovery stays inside the existing turn and sampling loop.
use std::sync::Arc;

use super::provider_handoff::public_history;
use super::session::Session;
use super::turn_context::TurnContext;
use crate::compact::CompactedHistoryMetadata;
use codex_login::AzraelQuotaRecoveryContext;
use codex_login::AzraelQuotaRecoveryOutcome;
use codex_login::CodexAuth;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;
use codex_protocol::error::Result;
use codex_protocol::protocol::EventMsg;
use codex_protocol::protocol::WarningEvent;
use tokio_util::sync::CancellationToken;

const MAX_EXHAUSTED_ACCOUNTS: usize = 64;

pub(super) fn confirmed_quota(error: &CodexErr) -> bool {
    matches!(
        error.details(),
        CodexErrorDetails::UsageLimitReached(_)
            | CodexErrorDetails::QuotaExceeded
            | CodexErrorDetails::UsageNotIncluded
    )
}

pub(super) async fn recover(
    sess: &Arc<Session>,
    ctx: &Arc<TurnContext>,
    previous_auth: Option<&CodexAuth>,
    cancellation: &CancellationToken,
) -> Result<bool> {
    if cancellation.is_cancelled() {
        return Err(CodexErr::TurnAborted);
    }
    // Serialize account selection and exhausted-account updates through the async
    // recovery attempt so concurrent recovery cannot select the same account.
    let mut excluded = Arc::clone(&ctx.exhausted_accounts).lock_owned().await;
    if excluded.len() >= MAX_EXHAUSTED_ACCOUNTS {
        warn_unavailable(
            sess,
            ctx,
            "자동 전환 시도 한도에 도달해 복구를 중단했습니다.",
        )
        .await;
        return Ok(false);
    }
    warn_unavailable(
        sess,
        ctx,
        "사용량이 소진되어 자동 전환 가능한 허용 계정을 확인합니다.",
    )
    .await;
    let model = ctx.model_info().slug.clone();
    let destination =
        if crate::managed_catalog::is_managed(&model) || crate::devin::catalog::is_devin(&model) {
            crate::managed_account_recovery::recover(sess, ctx, &mut excluded, cancellation).await
        } else {
            let lease = ctx
                .account_lease
                .lock()
                .ok()
                .and_then(|lease| lease.clone());
            let Some(lease) = lease else {
                return Ok(false);
            };
            let previous_account_id = previous_auth.and_then(CodexAuth::get_account_id);
            let previous_user_id = previous_auth.and_then(CodexAuth::get_chatgpt_user_id);
            if let (Some(account), Some(user)) = (&previous_account_id, &previous_user_id) {
                excluded.insert(serde_json::to_string(&(account, user)).map_err(|_| {
                    CodexErr::InvalidRequest("Invalid account recovery identity".to_string())
                })?);
            } else {
                return Ok(false);
            }
            match sess
                .services
                .auth_manager
                .recover_usage_limit(
                    &lease,
                    AzraelQuotaRecoveryContext {
                        previous_account_id,
                        previous_user_id,
                        excluded_profile_ids: excluded.iter().cloned().collect(),
                    },
                )
                .await
            {
                Ok(AzraelQuotaRecoveryOutcome::Switched { profile_id }) => {
                    excluded.insert(profile_id.clone());
                    Ok(Some(profile_id))
                }
                Ok(AzraelQuotaRecoveryOutcome::Unavailable) => Ok(None),
                Ok(AzraelQuotaRecoveryOutcome::Busy) => {
                    warn_unavailable(
                        sess,
                        ctx,
                        "다른 작업이 계정을 사용 중이므로 자동 전환하지 않았습니다.",
                    )
                    .await;
                    Ok(None)
                }
                Ok(AzraelQuotaRecoveryOutcome::Superseded) => {
                    warn_unavailable(
                        sess,
                        ctx,
                        "수동 계정 변경이 우선하므로 자동 전환하지 않았습니다.",
                    )
                    .await;
                    Ok(None)
                }
                Err(_) => {
                    warn_unavailable(
                        sess,
                        ctx,
                        "계정 상태를 확인하지 못해 자동 전환을 중단했습니다.",
                    )
                    .await;
                    Ok(None)
                }
            }
        };
    // A commit already admitted must finish atomically. Cancellation prevents
    // the next inference, rather than dropping a half-committed transaction.
    if cancellation.is_cancelled() {
        return Err(CodexErr::TurnAborted);
    }
    let destination = match destination {
        Ok(Some(destination)) => destination,
        Ok(None) => {
            warn_unavailable(
                sess,
                ctx,
                "자동 전환 가능한 허용 계정이 없거나 계정 변경을 진행할 수 없습니다.",
            )
            .await;
            return Ok(false);
        }
        Err(error) if matches!(error.details(), CodexErrorDetails::Interrupted) => {
            return Err(error);
        }
        Err(_) => {
            warn_unavailable(sess, ctx, "허용된 계정으로 자동 전환하지 못했습니다.").await;
            return Ok(false);
        }
    };
    let warning = format!(
        "사용량이 소진되어 허용된 계정 {destination}으로 자동 전환했습니다. 같은 모델과 턴에서 저장된 공개 대화와 도구 결과로 계속합니다. 계정 전용 추론과 암호화된 문맥은 제외했습니다."
    );
    let history = sess.clone_history().await;
    let input_goal_ids = crate::context::UserGoalUpdate::message_ids(history.raw_items());
    let replacement =
        public_history(&history.for_prompt_annotated(&ctx.model_info().input_modalities));
    let replacement_step_context = sess
        .capture_step_context(Arc::clone(ctx), cancellation)
        .await?;
    let world_state = sess
        .build_world_state_for_step(&replacement_step_context, /*new_window*/ true)
        .await?;
    let (replacement, world_state_baseline) = crate::compact::build_compaction_replacement_history(
        sess,
        &replacement_step_context,
        &world_state,
        replacement,
    )
    .await;
    let (window_number, window_ids) = sess.advance_auto_compact_window().await;
    // Append a native checkpoint; original rollout records and executed tool
    // identities remain intact. Future sampling steps cannot revive old replay.
    sess.replace_compacted_history(
        replacement,
        replacement_step_context.to_turn_context_item(),
        world_state_baseline,
        CompactedHistoryMetadata {
            input_goal_ids,
            message: warning.clone(),
            window_number,
            window_ids,
            compaction_response_id: None,
            compaction_model_hash: None,
            reviewer_compaction_hash: None,
        },
    )
    .await;
    sess.recompute_token_usage(ctx).await;
    warn_unavailable(sess, ctx, &warning).await;
    Ok(true)
}

async fn warn_unavailable(sess: &Session, ctx: &TurnContext, message: &str) {
    sess.send_event(
        ctx,
        EventMsg::Warning(WarningEvent {
            message: message.to_string(),
        }),
    )
    .await;
}
