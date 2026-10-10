use super::*;
use crate::context::DeveloperInstructions;
use crate::context::world_state::Placement;
use crate::context::world_state::WorldState;
use codex_protocol::models::ResponseItem;

fn state() -> WorldState {
    let mut state = WorldState::default();
    state.add_section(RootCoordinationState);
    state
}

#[test]
fn root_coordination_creation_is_standalone_and_repeated_state_is_deduplicated() {
    let state = state();
    let (snapshot, updates) = state.render_full();
    assert_eq!(updates.len(), 1);
    assert!(updates[0].placement == Placement::Standalone);
    let retained: ResponseItem = ContextualUserFragment::into(RootCoordinationInstructions);
    assert!(
        state
            .render_history_fragment_diff(Some(&snapshot), &[retained])
            .1
            .is_empty()
    );
}

#[test]
fn root_coordination_resume_restores_missing_fragment_and_deduplicates_legacy_history() {
    let state = state();
    let snapshot = state.render_full().0;
    assert_eq!(
        state
            .render_history_fragment_diff(Some(&snapshot), &[])
            .1
            .len(),
        1
    );
    let retained: ResponseItem = ContextualUserFragment::into(RootCoordinationInstructions);
    assert!(
        state
            .render_history_fragment_diff(None, &[retained])
            .1
            .is_empty()
    );
}

#[test]
fn root_coordination_changed_fingerprint_is_emitted_again() {
    let previous = WorldStateHash::from_fragment(&DeveloperInstructions::new("old root guidance"));
    let (snapshot, updates) =
        RootCoordinationState.render_diff(PreviousSectionState::Known(&previous));
    assert_eq!(updates.len(), 1);
    assert_eq!(
        snapshot,
        Some(WorldStateHash::from_fragment(&RootCoordinationInstructions))
    );
}
