use super::*;
use crate::context::world_state::Placement;
use crate::context::world_state::WorldState;
use codex_protocol::models::ResponseItem;

fn state(has_parent: bool, tools_enabled: bool) -> WorldState {
    let mut state = WorldState::default();
    state.add_section(ParentRequestGuidanceState(ParentRequestGuidance {
        has_parent,
        tools_enabled,
    }));
    state
}

#[test]
fn guidance_restores_after_compaction_or_reload_and_deduplicates_retained_history() {
    let state = state(true, true);
    let (snapshot, updates) = state.render_full();
    assert_eq!(updates.len(), 1);
    assert!(updates[0].placement == Placement::Standalone);
    let retained: ResponseItem = ContextualUserFragment::into(ParentRequestGuidance {
        has_parent: true,
        tools_enabled: true,
    });
    assert!(
        state
            .render_history_fragment_diff(Some(&snapshot), &[retained.clone()])
            .1
            .is_empty()
    );
    assert!(
        state
            .render_history_fragment_diff(None, &[retained])
            .1
            .is_empty()
    );
    assert_eq!(
        state
            .render_history_fragment_diff(Some(&snapshot), &[])
            .1
            .len(),
        1
    );
}

#[test]
fn capability_or_parent_change_replaces_old_guidance_even_without_snapshot() {
    let old = state(true, true);
    let snapshot = old.render_full().0;
    let retained: ResponseItem = ContextualUserFragment::into(ParentRequestGuidance {
        has_parent: true,
        tools_enabled: true,
    });
    for state in [state(true, false), state(false, true)] {
        assert_eq!(
            state
                .render_history_fragment_diff(Some(&snapshot), &[retained.clone()])
                .1
                .len(),
            1
        );
        assert_eq!(
            state
                .render_history_fragment_diff(None, &[retained.clone()])
                .1
                .len(),
            1
        );
    }
}
