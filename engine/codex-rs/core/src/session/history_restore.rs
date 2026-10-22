//! Share one verified, request-local rollout between startup restoration consumers.
use super::Session;
use codex_history::InitialHistory;
use codex_history::RolloutItem;
use codex_protocol::ThreadId;
use codex_protocol::error::CodexErr;
use codex_protocol::error::Result;
use std::borrow::Cow;
use std::future::Future;
use std::path::PathBuf;

impl Session {
    pub(super) async fn restore_session_history(&self, history: &InitialHistory) -> Result<()> {
        let path = if matches!(history, InitialHistory::Resumed(_)) {
            self.current_rollout_path()
                .await
                .map_err(|error| CodexErr::InvalidRequest(error.to_string()))?
        } else {
            None
        };
        self.restore_session_history_with_loader(history, path, |path| async move {
            codex_rollout::RolloutRecorder::load_rollout_items(&path).await
        })
        .await
    }

    pub(super) async fn restore_session_history_with_loader<F, Fut>(
        &self,
        history: &InitialHistory,
        path: Option<PathBuf>,
        load: F,
    ) -> Result<()>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: Future<Output = std::io::Result<(Vec<RolloutItem>, Option<ThreadId>, usize)>>,
    {
        let resumed = matches!(history, InitialHistory::Resumed(_));
        let items = match history {
            InitialHistory::Resumed(history) => {
                if let Some(path) = path {
                    let (items, id, errors) = load(path).await?;
                    // Refuse partial or foreign history before either consumer mutates state.
                    if id != Some(self.thread_id) || errors != 0 {
                        return Err(CodexErr::InvalidRequest(
                            "incomplete session restoration history".into(),
                        ));
                    }
                    Cow::Owned(items)
                } else {
                    Cow::Borrowed(history.history.as_slice())
                }
            }
            InitialHistory::Forked(items) => Cow::Borrowed(items.as_slice()),
            InitialHistory::New | InitialHistory::Cleared => Cow::Borrowed(&[][..]),
        };
        self.restore_user_questions(&items, resumed).await?;
        self.restore_host_approvals(resumed.then_some(items.as_ref()));
        // The full rollout is released when this call returns, before initial history recording.
        Ok(())
    }
}
