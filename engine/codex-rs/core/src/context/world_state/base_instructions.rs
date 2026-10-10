//! Refreshes base instructions alongside tool declarations when common behavior changes.

use super::PreviousSectionState;
use super::SectionTransition;
use super::WorldStateHash;
use super::WorldStateSection;
use super::WorldStateUpdate;
use crate::context::BaseInstructionsFragment;

pub(crate) struct BaseInstructionsState(pub(crate) String);

impl WorldStateSection for BaseInstructionsState {
    const ID: &'static str = "base_instructions";
    type Snapshot = WorldStateHash;

    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> SectionTransition<Self::Snapshot> {
        let fragment = BaseInstructionsFragment(self.0.clone());
        let hash = WorldStateHash::from_fragment(&fragment);
        let changed = match previous {
            PreviousSectionState::Known(previous) => previous != &hash,
            PreviousSectionState::Unknown | PreviousSectionState::Absent => true,
        };
        let updates = WorldStateUpdate::optional_prefix_boxed_fragment(
            (changed && !self.0.is_empty()).then(|| Box::new(fragment) as _),
        );
        (Some(hash), updates)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_behavior_refreshes_existing_window_without_repeating_unchanged_text() {
        let previous = BaseInstructionsState("old catalog behavior".to_string());
        let (old_hash, _) = previous.render_diff(PreviousSectionState::Absent);
        let current = BaseInstructionsState(codex_prompts::COMMON_AGENT_INSTRUCTIONS.to_string());
        let (hash, updates) = current.render_diff(PreviousSectionState::Known(
            old_hash.as_ref().expect("previous hash"),
        ));
        assert_eq!(updates.len(), 1);
        assert!(
            current
                .render_diff(PreviousSectionState::Known(hash.as_ref().expect("hash")))
                .1
                .is_empty()
        );
        assert_eq!(
            current.render_diff(PreviousSectionState::Unknown).1.len(),
            1
        );
    }
}
