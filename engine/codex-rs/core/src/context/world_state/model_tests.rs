use super::*;
use crate::context::world_state::test_support::FragmentSectionTestExt as _;
use pretty_assertions::assert_eq;

fn model_state(
    model: &str,
    previous_model: Option<&str>,
    instructions: String,
) -> ModelInstructionsState {
    ModelInstructionsState::new(
        model,
        "openai",
        previous_model,
        previous_model.map(|_| "openai"),
        instructions,
    )
}

#[test]
fn model_change_without_behavior_snapshot_preserves_legacy_fallback() {
    let state = model_state("gpt-new", Some("gpt-old"), "instructions".into());

    for previous in [PreviousSectionState::Unknown, PreviousSectionState::Absent] {
        assert_eq!(
            state
                .render_fragment_diff(previous)
                .1
                .expect("model change should render")
                .markers(),
            ModelSwitchInstructions::type_markers()
        );
    }
}

#[test]
fn unchanged_model_does_not_render() {
    let state = model_state("gpt-test", Some("gpt-test"), "instructions".into());
    let previous = state.snapshot();

    assert!(
        state
            .render_fragment_diff(PreviousSectionState::Known(&previous))
            .1
            .is_none()
    );
    assert!(
        state
            .render_fragment_diff(PreviousSectionState::Absent)
            .1
            .is_none()
    );
}

#[test]
fn first_request_does_not_repeat_behavior_already_in_initial_instructions() {
    let state = model_state("gpt-new", Some("gpt-old"), "shared behavior".into())
        .with_initial_instructions(
            "shared behavior\n<custom_agent_instructions>preserved</custom_agent_instructions>",
        );
    assert!(
        state
            .render_fragment_diff(PreviousSectionState::Absent)
            .1
            .is_none()
    );
    let changed = model_state("gpt-new", Some("gpt-old"), "different behavior".into())
        .with_initial_instructions("shared behavior");
    assert!(
        changed
            .render_fragment_diff(PreviousSectionState::Absent)
            .1
            .is_some()
    );
    // Retained legacy switches may override the initial behavior; do not infer their profile.
    assert!(
        state
            .render_fragment_diff(PreviousSectionState::Unknown)
            .1
            .is_some()
    );
}

#[test]
fn model_switch_with_identical_behavior_updates_identity_without_repeating_instructions() {
    let initial = model_state("gpt-a", None, "shared behavior".into());
    let mut previous = initial.snapshot();
    for model in ["gpt-b", "gpt-c", "gpt-a"] {
        let state = model_state(model, Some(&previous.model), "shared behavior".into());
        let (snapshot, fragment) =
            state.render_fragment_diff(PreviousSectionState::Known(&previous));
        assert!(fragment.is_none());
        previous = snapshot.expect("model identity must advance without emitting instructions");
        assert_eq!(previous.model, model);
    }
}

#[test]
fn changed_behavior_refreshes_with_or_without_a_model_switch() {
    let original = model_state("gpt-a", None, "original behavior".into());
    for model in ["gpt-a", "gpt-b"] {
        let previous = original.snapshot();
        let changed = model_state(model, Some("gpt-a"), "new profile behavior".into());
        let (snapshot, fragment) =
            changed.render_fragment_diff(PreviousSectionState::Known(&previous));
        let fragment = fragment.expect("new behavior must reach the model");
        assert!(fragment.body().contains("new profile behavior"));
        assert!(!fragment.body().contains("original behavior"));
        let snapshot = snapshot.unwrap();
        assert!(
            changed
                .render_fragment_diff(PreviousSectionState::Known(&snapshot))
                .1
                .is_none()
        );

        let restored = model_state(model, Some(model), "original behavior".into());
        assert!(
            restored
                .render_fragment_diff(PreviousSectionState::Known(&snapshot))
                .1
                .is_some()
        );
    }
}

#[test]
fn identical_profile_survives_checkpoint_restore_without_a_model_switch_fragment() {
    use crate::context::world_state::WorldState;
    use crate::context::world_state::WorldStateSnapshot;
    use codex_protocol::models::ResponseItem;

    let mut initial = WorldState::default();
    initial.add_section(model_state("gpt-a", None, "shared behavior".into()));
    let (snapshot, updates) = initial.render_full();
    assert!(updates.is_empty());
    let snapshot: WorldStateSnapshot =
        serde_json::from_str(&serde_json::to_string(&snapshot).unwrap()).unwrap();
    let mut switched = WorldState::default();
    switched.add_section(model_state(
        "gpt-b",
        Some("gpt-a"),
        "shared behavior".into(),
    ));
    let (_, updates) =
        switched.render_history_diff(Some(&snapshot), std::iter::empty::<&ResponseItem>());
    assert!(
        updates.is_empty(),
        "an unrendered but valid behavior snapshot must survive restore"
    );
}

#[test]
fn model_only_legacy_checkpoint_advances_to_behavior_snapshot() {
    use crate::context::world_state::ErasedWorldStateSection;

    let state = model_state("gpt-new", Some("gpt-old"), "current behavior".into());
    let legacy = serde_json::json!("gpt-old");
    let (snapshot, updates) =
        ErasedWorldStateSection::render_diff(&state, PreviousSectionState::Known(&legacy));
    assert_eq!(updates.len(), 1);
    let snapshot = snapshot.expect("legacy checkpoint must advance");
    assert_eq!(snapshot["model"], "gpt-new");
    assert!(snapshot["instructions"].is_string());
    let (_, updates) =
        ErasedWorldStateSection::render_diff(&state, PreviousSectionState::Known(&snapshot));
    assert!(updates.is_empty());
}

#[test]
fn line_endings_do_not_change_behavior_and_empty_instructions_do_not_render() {
    let original = model_state("gpt-a", None, "shared\r\nbehavior".into()).snapshot();
    let normalized = model_state("gpt-b", Some("gpt-a"), "shared\nbehavior".into());
    assert!(
        normalized
            .render_fragment_diff(PreviousSectionState::Known(&original))
            .1
            .is_none()
    );
    let empty = model_state("gpt-b", Some("gpt-a"), String::new());
    assert!(
        empty
            .render_fragment_diff(PreviousSectionState::Known(&original))
            .1
            .is_none()
    );
}

#[test]
fn provider_changes_refresh_identical_behavior_once_in_both_directions() {
    let mut previous = model_state("gpt-a", None, "shared behavior".into()).snapshot();
    for model in ["gpt-a", "gpt-b"] {
        for provider in ["api/connection-a", "api/connection-b", "openai"] {
            let state = ModelInstructionsState::new(
                model,
                provider,
                Some(&previous.model),
                previous.provider.as_deref(),
                "shared behavior".into(),
            );
            let (snapshot, fragment) =
                state.render_fragment_diff(PreviousSectionState::Known(&previous));
            assert!(fragment.unwrap().body().contains("shared behavior"));
            previous = snapshot.unwrap();
            assert_eq!(previous.provider.as_deref(), Some(provider));
            assert!(
                state
                    .render_fragment_diff(PreviousSectionState::Known(&previous))
                    .1
                    .is_none()
            );
        }
    }
}

#[test]
fn full_context_provider_change_refreshes_even_with_matching_initial_instructions() {
    let state = ModelInstructionsState::new(
        "gpt-a",
        "provider-b",
        Some("gpt-a"),
        Some("provider-a"),
        "shared behavior".into(),
    )
    .with_initial_instructions("shared behavior");
    assert!(
        state
            .render_fragment_diff(PreviousSectionState::Absent)
            .1
            .is_some()
    );
}

#[test]
fn provider_identity_survives_checkpoint_restore() {
    let initial = model_state("gpt-a", None, "shared behavior".into()).snapshot();
    let restored = serde_json::from_str(&serde_json::to_string(&initial).unwrap()).unwrap();
    let changed = ModelInstructionsState::new(
        "gpt-a",
        "provider-b",
        Some("gpt-a"),
        Some("openai"),
        "shared behavior".into(),
    );
    assert!(
        changed
            .render_fragment_diff(PreviousSectionState::Known(&restored))
            .1
            .is_some()
    );
}

#[test]
fn providerless_checkpoint_refreshes_once_even_for_unchanged_model_and_behavior() {
    use crate::context::world_state::ErasedWorldStateSection;

    let state = model_state("gpt-a", Some("gpt-a"), "shared behavior".into());
    let mut legacy = serde_json::to_value(state.snapshot()).unwrap();
    legacy.as_object_mut().unwrap().remove("provider");
    for legacy in [legacy, serde_json::json!("gpt-a")] {
        let (snapshot, updates) =
            ErasedWorldStateSection::render_diff(&state, PreviousSectionState::Known(&legacy));
        assert_eq!(updates.len(), 1);
        let snapshot = snapshot.unwrap();
        assert_eq!(snapshot["provider"], "openai");
        let (_, updates) =
            ErasedWorldStateSection::render_diff(&state, PreviousSectionState::Known(&snapshot));
        assert!(updates.is_empty());
    }
}
