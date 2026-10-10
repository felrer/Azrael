use super::PreviousSectionState;
use super::SectionTransition;
use super::WorldStateHash;
use super::WorldStateSection;
use super::WorldStateUpdate;
use crate::context::ContextualUserFragment;
use crate::context::RootCoordinationInstructions;

/// Root-only guidance tracked separately from configurable multi-agent role text.
pub(crate) struct RootCoordinationState;

impl WorldStateSection for RootCoordinationState {
    const ID: &'static str = "azrael_root_coordination";
    type Snapshot = WorldStateHash;

    fn matches_current_legacy_fragment(&self, role: &str, text: &str) -> bool {
        role == "developer" && text == RootCoordinationInstructions.render()
    }

    fn has_retained_fragment_matcher() -> bool {
        true
    }

    fn matches_retained_fragment(role: &str, text: &str) -> bool {
        role == "developer" && text == RootCoordinationInstructions.render()
    }

    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> SectionTransition<Self::Snapshot> {
        let fingerprint = WorldStateHash::from_fragment(&RootCoordinationInstructions);
        let unchanged = matches!(previous, PreviousSectionState::Known(previous) if previous == &fingerprint)
            || matches!(previous, PreviousSectionState::Unknown);
        (
            Some(fingerprint),
            if unchanged {
                Vec::new()
            } else {
                vec![WorldStateUpdate::fragment(RootCoordinationInstructions).standalone()]
            },
        )
    }
}

#[cfg(test)]
#[path = "root_coordination_tests.rs"]
mod tests;
