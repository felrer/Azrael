use super::PreviousSectionState;
use super::SectionTransition;
use super::WorldStateHash;
use super::WorldStateSection;
use super::WorldStateUpdate;
use crate::context::ContextualUserFragment;
use crate::context::ParentRequestGuidance;

/// Communication guidance rebuilt from actual capability and parent identity.
pub(crate) struct ParentRequestGuidanceState(pub(crate) ParentRequestGuidance);

impl WorldStateSection for ParentRequestGuidanceState {
    const ID: &'static str = "azrael_parent_request_guidance";
    type Snapshot = WorldStateHash;

    fn matches_current_legacy_fragment(&self, role: &str, text: &str) -> bool {
        role == "developer" && text == self.0.render()
    }

    fn has_retained_fragment_matcher() -> bool {
        true
    }

    fn matches_retained_fragment(role: &str, text: &str) -> bool {
        role == "developer" && ParentRequestGuidance::matches_text(text)
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
#[path = "parent_request_guidance_tests.rs"]
mod tests;
