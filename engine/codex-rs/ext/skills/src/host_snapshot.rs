use std::io;
use std::sync::Arc;

use crate::SkillLoadOutcome;
use codex_skills::SkillMetadata;

/// Immutable snapshot of host-owned skills and their source filesystems.
#[derive(Debug, Clone)]
pub struct HostSkillsSnapshot {
    outcome: Arc<SkillLoadOutcome>,
    selected_only: bool,
}

impl HostSkillsSnapshot {
    pub fn new(outcome: Arc<SkillLoadOutcome>) -> Self {
        Self { outcome, selected_only: false }
    }

    pub fn with_selected_only(mut self, selected_only: bool) -> Self {
        self.selected_only = selected_only;
        self
    }

    pub fn selected_only(&self) -> bool { self.selected_only }

    pub fn outcome(&self) -> &SkillLoadOutcome {
        self.outcome.as_ref()
    }

    pub async fn read_skill_text(&self, skill: &SkillMetadata) -> io::Result<String> {
        self.outcome.read_skill_text(skill).await
    }
}
