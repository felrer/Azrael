//! A startup ceiling on tool selection and construction, independent of session identity.
//! This policy only restricts tools; permission and approval checks still apply.

use crate::ToolName;

/// Supply through `ExtensionDataInit` before starting a thread. The host captures
/// the policy once; later extension-state changes cannot relax it. Callers must
/// supply it again when resuming a thread.
#[derive(Clone, Debug)]
pub struct ToolPolicy {
    /// `None` keeps ordinary tool selection; an empty list permits no tools.
    /// Names include their namespace; plain names use the default namespace.
    /// Generated tools such as Code Mode's `exec` and `wait` must also be listed.
    pub allowed_tools: Option<Vec<ToolName>>,
    /// Require native selected-window MCP ownership for external runtimes.
    pub selected_window_only: bool,
    /// Omit core tools unless the thread and every ready environment use a managed sandbox.
    pub require_managed_sandbox: bool,
    /// Omit shell tools when unified exec is disabled, instead of using one-shot exec.
    pub require_unified_exec: bool,
    /// Advertise additional-permission arguments when the feature is enabled.
    pub expose_additional_permissions: bool,
}

impl Default for ToolPolicy {
    fn default() -> Self {
        Self {
            allowed_tools: None,
            selected_window_only: false,
            require_managed_sandbox: false,
            require_unified_exec: false,
            expose_additional_permissions: true,
        }
    }
}

impl ToolPolicy {
    /// Selected-window ceiling; approval and sandbox settings remain independent.
    pub fn selected_window() -> Self {
        let mut tools = vec![
            ToolName::plain("exec"),
            ToolName::plain("wait"),
            ToolName::plain("tool_search"),
        ];
        for namespace in ["azrael_window", "mcp__azrael_window"] {
            for name in [
                "capture",
                "status",
                "invoke",
                "set_value",
                "toggle",
                "select",
                "expand",
                "collapse",
                "scroll",
                "resize",
                "run_size_macro",
            ] {
                tools.push(ToolName::namespaced(namespace, name));
            }
        }
        Self {
            allowed_tools: Some(tools),
            selected_window_only: true,
            ..Self::default()
        }
    }

    pub fn allows(&self, tool: &ToolName) -> bool {
        self.allowed_tools.as_ref().is_none_or(|tools| {
            tools.iter().any(|allowed| {
                allowed.name == tool.name
                    && (allowed.namespace == tool.namespace
                        || (allowed.is_default_namespace() && tool.is_default_namespace()))
            })
        })
    }
}
