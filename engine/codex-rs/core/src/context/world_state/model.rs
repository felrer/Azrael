use super::PreviousSectionState;
use super::SectionTransition;
use super::WorldStateHash;
use super::WorldStateSection;
use super::WorldStateUpdate;
use crate::context::ContextualUserFragment;
use crate::context::ModelSwitchInstructions;

/// Model identity and behavior, tracked independently to avoid repeating shared profiles.
#[derive(Clone, Debug)]
pub(crate) struct ModelInstructionsState {
    model: String,
    provider: String,
    previous_model: Option<String>,
    previous_provider: Option<String>,
    instructions: String,
    initial_behavior_matches: bool,
}

impl ModelInstructionsState {
    pub(crate) fn new(
        model: &str,
        provider: &str,
        previous_model: Option<&str>,
        previous_provider: Option<&str>,
        instructions: String,
    ) -> Self {
        Self {
            model: model.to_string(),
            provider: provider.to_string(),
            previous_model: previous_model.map(str::to_string),
            previous_provider: previous_provider.map(str::to_string),
            instructions,
            initial_behavior_matches: false,
        }
    }

    pub(crate) fn with_initial_instructions(mut self, initial_instructions: &str) -> Self {
        self.initial_behavior_matches = initial_instructions
            .replace("\r\n", "\n")
            .starts_with(&self.instructions.replace("\r\n", "\n"));
        self
    }

    fn snapshot(&self) -> ModelInstructionsSnapshot {
        ModelInstructionsSnapshot {
            model: self.model.clone(),
            provider: Some(self.provider.clone()),
            instructions: WorldStateHash::from_fragment(&ModelSwitchInstructions::new(
                self.instructions.clone(),
            )),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct ModelInstructionsSnapshot {
    model: String,
    #[serde(default)]
    provider: Option<String>,
    instructions: WorldStateHash,
}

impl WorldStateSection for ModelInstructionsState {
    const ID: &'static str = "model";
    type Snapshot = ModelInstructionsSnapshot;

    fn matches_legacy_fragment(role: &str, text: &str) -> bool {
        role == "developer" && ModelSwitchInstructions::matches_text(text)
    }

    fn render_diff(
        &self,
        previous: PreviousSectionState<'_, Self::Snapshot>,
    ) -> SectionTransition<Self::Snapshot> {
        let current = self.snapshot();
        let instructions_changed = match previous {
            PreviousSectionState::Known(previous) => {
                previous.provider != current.provider
                    || previous.instructions != current.instructions
            }
            // Legacy snapshots cannot establish the provider that received the behavior.
            PreviousSectionState::Unknown => true,
            PreviousSectionState::Absent => {
                self.previous_provider
                    .as_deref()
                    .is_some_and(|previous| previous != self.provider)
                    || (!self.initial_behavior_matches
                        && self
                            .previous_model
                            .as_deref()
                            .is_some_and(|previous| previous != self.model))
            }
        };

        let fragment: Option<Box<dyn ContextualUserFragment>> =
            (instructions_changed && !self.instructions.is_empty()).then(|| {
                Box::new(ModelSwitchInstructions::new(self.instructions.clone()))
                    as Box<dyn ContextualUserFragment>
            });
        (
            Some(current),
            WorldStateUpdate::optional_standalone_boxed_fragment(fragment),
        )
    }
}

#[cfg(test)]
#[path = "model_tests.rs"]
mod tests;
