//! Guidance follows the actual registered capability, including withdrawal.
use codex_context_fragments::ContextualUserFragment;
use codex_protocol::models::ContentItemKind;

pub const PROJECT_MAINTENANCE_GUIDANCE: &str =
    include_str!("../templates/project-maintenance-guidance.md");

#[derive(Clone, Debug)]
pub struct ProjectMaintenanceGuidance {
    pub available_tools: Vec<String>,
}

impl ContextualUserFragment for ProjectMaintenanceGuidance {
    fn content_kind(&self) -> ContentItemKind {
        ContentItemKind("azrael.project_maintenance_guidance".into())
    }
    fn role(&self) -> &'static str {
        "developer"
    }
    fn markers(&self) -> (&'static str, &'static str) {
        Self::type_markers()
    }
    fn type_markers() -> (&'static str, &'static str) {
        (
            "<azrael_project_maintenance_guidance>",
            "</azrael_project_maintenance_guidance>",
        )
    }
    fn body(&self) -> String {
        if self.available_tools.is_empty() {
            return "Project maintenance tools are unavailable in this context. Prior project maintenance capability guidance is withdrawn.".into();
        }
        // A partial ceiling must not give usage instructions for omitted tools.
        if self.available_tools.len() != 5 {
            return format!(
                "Project maintenance capability version 1 is restricted. Available tools: {}. Use only each available tool's advertised actions and current permissions. Prior guidance for omitted tools is withdrawn. Cleanup requires explicit model delete/defer decisions; tool success does not establish command success or actual deletion.",
                self.available_tools.join(", ")
            );
        }
        format!(
            "Available tools and allowed actions: {}.\n\n{}",
            self.available_tools.join(", "),
            PROJECT_MAINTENANCE_GUIDANCE
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn omitted_capabilities_are_withdrawn_without_usage_instructions() {
        let unavailable = ProjectMaintenanceGuidance {
            available_tools: vec![],
        };
        assert!(unavailable.body().contains("withdrawn"));
        assert!(!unavailable.body().contains("Use project_inventory"));
        let partial = ProjectMaintenanceGuidance {
            available_tools: vec!["project_tests (plan/run/status)".into()],
        };
        assert!(!partial.body().contains("project_cleanup_apply"));
        assert!(ProjectMaintenanceGuidance::matches_text(&partial.render()));
    }
}
