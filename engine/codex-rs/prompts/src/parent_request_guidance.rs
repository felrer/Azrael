//! Capability-scoped communication guidance, independent of configurable role hints.
use codex_context_fragments::ContextualUserFragment;
use codex_protocol::models::ContentItemKind;

pub const PARENT_REQUEST_GUIDANCE: &str = include_str!("../templates/parent-request-guidance.md");

#[derive(Clone, Debug)]
pub struct ParentRequestGuidance {
    pub has_parent: bool,
    pub tools_enabled: bool,
}

impl ContextualUserFragment for ParentRequestGuidance {
    fn content_kind(&self) -> ContentItemKind {
        ContentItemKind("azrael.parent_request_guidance".to_string())
    }
    fn role(&self) -> &'static str {
        "developer"
    }
    fn markers(&self) -> (&'static str, &'static str) {
        Self::type_markers()
    }
    fn type_markers() -> (&'static str, &'static str) {
        (
            "<azrael_parent_request_guidance>",
            "</azrael_parent_request_guidance>",
        )
    }
    fn body(&self) -> String {
        let (common, rest) = PARENT_REQUEST_GUIDANCE
            .split_once("<!-- child-enabled -->")
            .unwrap();
        let (child, rest) = rest.split_once("<!-- parent-enabled -->").unwrap();
        let (parent, fallback) = rest.split_once("<!-- child-fallback -->").unwrap();
        let mut body = common.to_string();
        if self.tools_enabled {
            if self.has_parent {
                body.push_str(child);
            }
            body.push_str(parent);
        } else if self.has_parent {
            body.push_str(fallback);
        }
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn capabilities_and_relationship_select_guidance_without_role_hints() {
        for has_parent in [false, true] {
            for tools_enabled in [false, true] {
                let fragment = ParentRequestGuidance {
                    has_parent,
                    tools_enabled,
                };
                assert_eq!(fragment.role(), "developer");
                let body = fragment.body();
                assert_eq!(
                    body.contains("use request_parent"),
                    has_parent && tools_enabled
                );
                assert_eq!(body.contains("Use respond_to_request"), tools_enabled);
                assert_eq!(body.contains("PARTIAL final"), has_parent && !tools_enabled);
                assert!(ParentRequestGuidance::matches_text(&fragment.render()));
                assert!(!crate::MultiAgentRoleInstructions::matches_text(
                    &fragment.render()
                ));
            }
        }
    }
}
