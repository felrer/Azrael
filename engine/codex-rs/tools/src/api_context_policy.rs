/// Desktop runtimes omitted from user API model contexts and tool registries.
/// Skill catalog filtering uses the same policy as native tool dispatch.
pub fn api_excludes_tool_namespace(namespace: &str) -> bool {
    matches!(
        namespace,
        "azrael_window" | "mcp__azrael_window" | "node_repl" | "mcp__node_repl"
    )
}
