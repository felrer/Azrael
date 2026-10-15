use super::PreviousSectionState;
use super::SectionTransition;
use super::WorldStateHash;
use super::WorldStateSection;
use super::WorldStateUpdate;
use crate::context::ContextualUserFragment;
use codex_prompts::ProjectMaintenanceGuidance;

pub(crate) struct ProjectMaintenanceGuidanceState(pub(crate) ProjectMaintenanceGuidance);

impl WorldStateSection for ProjectMaintenanceGuidanceState {
    const ID: &'static str = "azrael_project_maintenance_guidance";
    type Snapshot = WorldStateHash;

    fn matches_current_legacy_fragment(&self, role: &str, text: &str) -> bool {
        role == "developer" && text == self.0.render()
    }
    fn has_retained_fragment_matcher() -> bool {
        true
    }
    fn matches_retained_fragment(role: &str, text: &str) -> bool {
        role == "developer" && ProjectMaintenanceGuidance::matches_text(text)
    }
    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> SectionTransition<Self::Snapshot> {
        let fingerprint = WorldStateHash::from_fragment(&self.0);
        let unchanged = matches!(previous, PreviousSectionState::Known(previous) if previous == &fingerprint)
            || matches!(previous, PreviousSectionState::Unknown);
        (
            Some(fingerprint),
            if unchanged {
                Vec::new()
            } else {
                vec![WorldStateUpdate::fragment(self.0.clone()).standalone()]
            },
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::WorldState;
    use super::*;
    use codex_protocol::models::ResponseItem;

    #[test]
    fn capability_withdrawal_replaces_retained_guidance_after_reload() {
        let available = ProjectMaintenanceGuidance {
            available_tools: vec!["project_tests (plan/run/status)".into()],
        };
        let retained: ResponseItem = ContextualUserFragment::into(available);
        let mut state = WorldState::default();
        state.add_section(ProjectMaintenanceGuidanceState(
            ProjectMaintenanceGuidance {
                available_tools: vec![],
            },
        ));
        assert_eq!(
            state
                .render_history_fragment_diff(None, &[retained])
                .1
                .len(),
            1
        );
        let (snapshot, _) = state.render_full();
        let retained: ResponseItem = ContextualUserFragment::into(ProjectMaintenanceGuidance {
            available_tools: vec![],
        });
        assert!(
            state
                .render_history_fragment_diff(Some(&snapshot), &[retained])
                .1
                .is_empty()
        );
    }
}
