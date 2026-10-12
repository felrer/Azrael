use crate::context::ContextualUserFragment;
use codex_protocol::models::ContentItemKind;

/// Preserve the producer's typed identity when withdrawing its guidance.
pub(super) struct InstructionRemoval<F> {
    pub(super) fragment: F,
    pub(super) notice: &'static str,
}

impl<F: ContextualUserFragment> ContextualUserFragment for InstructionRemoval<F> {
    fn content_kind(&self) -> ContentItemKind {
        self.fragment.content_kind()
    }

    fn role(&self) -> &'static str {
        self.fragment.role()
    }

    fn markers(&self) -> (&'static str, &'static str) {
        self.fragment.markers()
    }

    fn type_markers() -> (&'static str, &'static str) {
        F::type_markers()
    }

    fn body(&self) -> String {
        format!("\n{}\n", self.notice)
    }
}
