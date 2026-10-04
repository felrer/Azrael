use std::sync::Arc;

use crate::error_code::internal_error;
use crate::error_code::invalid_params;
use crate::error_code::invalid_request;
use codex_app_server_protocol::ClientResponsePayload;
use codex_app_server_protocol::JSONRPCErrorError;
use codex_app_server_protocol::RootResumeAction;
use codex_app_server_protocol::RootResumeParams;
use codex_app_server_protocol::RootResumeResponse;
use codex_core::ThreadManager;
use codex_protocol::error::CodexErr;
use codex_protocol::error::CodexErrorDetails;

#[derive(Clone)]
pub(crate) struct RootResumeRequestProcessor {
    thread_manager: Arc<ThreadManager>,
}

impl RootResumeRequestProcessor {
    pub(crate) fn new(thread_manager: Arc<ThreadManager>) -> Self {
        Self { thread_manager }
    }

    pub(crate) async fn root_resume(
        &self,
        params: RootResumeParams,
    ) -> Result<Option<ClientResponsePayload>, JSONRPCErrorError> {
        let action = validate_params(&params)?;
        match action {
            ValidatedAction::List => {}
            ValidatedAction::Resume {
                reservation_id,
                revision,
            } => self
                .thread_manager
                .resume_root_reservation(reservation_id, revision)
                .await
                .map_err(root_resume_error)?,
            ValidatedAction::Cancel {
                reservation_id,
                revision,
            } => self
                .thread_manager
                .cancel_root_reservation(reservation_id, revision)
                .await
                .map_err(root_resume_error)?,
        }

        let reservations = self
            .thread_manager
            .list_root_resumes()
            .await
            .map_err(root_resume_error)?;
        Ok(Some(RootResumeResponse { reservations }.into()))
    }
}

#[derive(Debug, PartialEq, Eq)]
enum ValidatedAction<'a> {
    List,
    Resume {
        reservation_id: &'a str,
        revision: i64,
    },
    Cancel {
        reservation_id: &'a str,
        revision: i64,
    },
}

fn validate_params(params: &RootResumeParams) -> Result<ValidatedAction<'_>, JSONRPCErrorError> {
    match params.action {
        RootResumeAction::List => {
            if params.reservation_id.is_some() || params.revision.is_some() {
                return Err(invalid_params(
                    "list does not accept reservationId or revision",
                ));
            }
            Ok(ValidatedAction::List)
        }
        RootResumeAction::Resume | RootResumeAction::Cancel => {
            let reservation_id = params
                .reservation_id
                .as_deref()
                .filter(|reservation_id| !reservation_id.trim().is_empty())
                .ok_or_else(|| invalid_params("reservationId must be a nonempty string"))?;
            let revision = params
                .revision
                .filter(|revision| *revision >= 0)
                .ok_or_else(|| invalid_params("revision must be a nonnegative integer"))?;
            Ok(match params.action {
                RootResumeAction::Resume => ValidatedAction::Resume {
                    reservation_id,
                    revision,
                },
                RootResumeAction::Cancel => ValidatedAction::Cancel {
                    reservation_id,
                    revision,
                },
                RootResumeAction::List => unreachable!("list handled above"),
            })
        }
    }
}

fn root_resume_error(err: CodexErr) -> JSONRPCErrorError {
    match err.details() {
        CodexErrorDetails::InvalidRequest(message) => invalid_request(message.clone()),
        _ => internal_error(format!("root resume operation failed: {err}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(
        action: RootResumeAction,
        reservation_id: Option<&str>,
        revision: Option<i64>,
    ) -> RootResumeParams {
        RootResumeParams {
            action,
            reservation_id: reservation_id.map(str::to_string),
            revision,
        }
    }

    #[test]
    fn list_rejects_target_fields() {
        let error = validate_params(&params(RootResumeAction::List, Some("r1"), None))
            .expect_err("list target must be rejected");
        assert_eq!(error.code, crate::error_code::INVALID_PARAMS_ERROR_CODE);
    }

    #[test]
    fn mutations_require_nonempty_id_and_nonnegative_revision() {
        for invalid in [
            params(RootResumeAction::Resume, None, Some(0)),
            params(RootResumeAction::Resume, Some("  "), Some(0)),
            params(RootResumeAction::Cancel, Some("r1"), None),
            params(RootResumeAction::Cancel, Some("r1"), Some(-1)),
        ] {
            let error = validate_params(&invalid).expect_err("mutation params must be rejected");
            assert_eq!(error.code, crate::error_code::INVALID_PARAMS_ERROR_CODE);
        }
    }

    #[test]
    fn mutations_preserve_valid_target_and_revision() {
        assert_eq!(
            validate_params(&params(RootResumeAction::Resume, Some("r1"), Some(4)))
                .expect("resume params should validate"),
            ValidatedAction::Resume {
                reservation_id: "r1",
                revision: 4,
            }
        );
        assert_eq!(
            validate_params(&params(RootResumeAction::Cancel, Some("r2"), Some(0)))
                .expect("cancel params should validate"),
            ValidatedAction::Cancel {
                reservation_id: "r2",
                revision: 0,
            }
        );
    }

    #[test]
    fn core_revision_conflicts_remain_native_request_errors() {
        let error = root_resume_error(CodexErr::InvalidRequest(
            "root resume reservation revision conflict".to_string(),
        ));

        assert_eq!(error.code, crate::error_code::INVALID_REQUEST_ERROR_CODE);
        assert_eq!(
            error.message,
            "root resume reservation revision conflict".to_string()
        );
    }
}
