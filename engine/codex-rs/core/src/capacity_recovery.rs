//! Capacity recovery budget shared by every sampling attempt for one user request.

use std::time::Duration;

const RETRY_DELAYS: [Duration; 3] = [
    Duration::from_secs(1),
    Duration::from_secs(5),
    Duration::from_secs(10),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapacityRecoveryAction {
    Retry(Duration),
    RecreateConnection,
    LegacyRetry,
}

#[derive(Debug, Default)]
pub(crate) struct CapacityRecoveryState {
    request_id: Option<String>,
    retries_used: usize,
    connection_recreated: bool,
}

impl CapacityRecoveryState {
    /// Only a different substantive request receives a fresh recovery budget.
    /// Reentry and tool continuations must retain the original request identity.
    pub(crate) fn begin_request(&mut self, request_id: String) {
        if request_id.is_empty() || self.request_id.as_ref() == Some(&request_id) {
            return;
        }

        self.request_id = Some(request_id);
        self.retries_used = 0;
        self.connection_recreated = false;
    }

    pub(crate) fn request_id(&self) -> Option<&str> {
        self.request_id.as_deref()
    }

    /// Consume recovery quota before the caller awaits a delay or reconnect.
    /// Success, cancellation, and a failed reconnect do not refund that quota.
    pub(crate) fn on_overload(&mut self) -> CapacityRecoveryAction {
        if self.request_id.is_none() {
            return CapacityRecoveryAction::LegacyRetry;
        }

        if let Some(&delay) = RETRY_DELAYS.get(self.retries_used) {
            self.retries_used += 1;
            return CapacityRecoveryAction::Retry(delay);
        }

        if !self.connection_recreated {
            self.connection_recreated = true;
            return CapacityRecoveryAction::RecreateConnection;
        }

        CapacityRecoveryAction::LegacyRetry
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overload_sequence_exhausts_three_retries_and_one_reconnect() {
        let mut state = CapacityRecoveryState::default();
        state.begin_request("request-1".to_owned());

        for seconds in [1, 5, 10] {
            assert_eq!(
                state.on_overload(),
                CapacityRecoveryAction::Retry(Duration::from_secs(seconds))
            );
        }
        assert_eq!(
            state.on_overload(),
            CapacityRecoveryAction::RecreateConnection
        );
        for _ in 0..3 {
            assert_eq!(state.on_overload(), CapacityRecoveryAction::LegacyRetry);
        }
    }

    #[test]
    fn same_identity_preserves_quota_across_sampling_reentry() {
        let mut state = CapacityRecoveryState::default();
        for seconds in [1, 5, 10] {
            state.begin_request("request-1".to_owned());
            assert_eq!(state.request_id(), Some("request-1"));
            assert_eq!(
                state.on_overload(),
                CapacityRecoveryAction::Retry(Duration::from_secs(seconds))
            );
        }
        state.begin_request("request-1".to_owned());
        assert_eq!(
            state.on_overload(),
            CapacityRecoveryAction::RecreateConnection
        );
        state.begin_request("request-1".to_owned());
        assert_eq!(state.on_overload(), CapacityRecoveryAction::LegacyRetry);
    }

    #[test]
    fn changed_identity_resets_exhausted_budget() {
        let mut state = CapacityRecoveryState::default();
        state.begin_request("request-1".to_owned());
        for _ in 0..5 {
            state.on_overload();
        }

        state.begin_request("request-2".to_owned());
        assert_eq!(state.request_id(), Some("request-2"));
        for seconds in [1, 5, 10] {
            assert_eq!(
                state.on_overload(),
                CapacityRecoveryAction::Retry(Duration::from_secs(seconds))
            );
        }
        assert_eq!(
            state.on_overload(),
            CapacityRecoveryAction::RecreateConnection
        );
    }

    #[test]
    fn empty_identity_neither_starts_nor_resets_budget() {
        let mut state = CapacityRecoveryState::default();
        assert_eq!(state.request_id(), None);
        assert_eq!(state.on_overload(), CapacityRecoveryAction::LegacyRetry);
        state.begin_request(String::new());
        assert_eq!(state.request_id(), None);
        assert_eq!(state.on_overload(), CapacityRecoveryAction::LegacyRetry);

        state.begin_request("request-1".to_owned());
        assert_eq!(
            state.on_overload(),
            CapacityRecoveryAction::Retry(Duration::from_secs(1))
        );
        state.begin_request(String::new());
        assert_eq!(state.request_id(), Some("request-1"));
        assert_eq!(
            state.on_overload(),
            CapacityRecoveryAction::Retry(Duration::from_secs(5))
        );
    }
}
