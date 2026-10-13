//! Bounded ripgrep searches using the native execution and filesystem boundaries.
use crate::function_tool::FunctionCallError;
use crate::shell::ShellType;
use crate::tools::context::{ToolInvocation, ToolOutput, ToolPayload};
use crate::tools::handlers::claude_shell::{
    arguments, error, exec_handler, function_spec, posix_quote,
};
use crate::tools::handlers::resolve_tool_environment;
use crate::tools::registry::{CoreToolRuntime, ToolExecutor};
use codex_tools::{JsonSchema, JsonToolOutput, ToolName, ToolSpec};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const MAX_RESULTS: usize = 2000;
const MAX_GLOB_SCAN: usize = 10000;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct GrepArgs {
    pattern: String,
    path: Option<String>,
    glob: Option<String>,
    #[serde(rename = "type")]
    file_type: Option<String>,
    output_mode: Option<String>,
    #[serde(rename = "-i", default)]
    insensitive: bool,
    #[serde(rename = "-n")]
    line_numbers: Option<bool>,
    #[serde(rename = "-A")]
    after: Option<usize>,
    #[serde(rename = "-B")]
    before: Option<usize>,
    #[serde(rename = "-C")]
    context: Option<usize>,
    #[serde(default)]
    multiline: bool,
    head_limit: Option<usize>,
    #[serde(default)]
    offset: usize,
}

fn grep_argv(args: &GrepArgs) -> Result<Vec<String>, FunctionCallError> {
    let mut argv = vec![
        "rg".into(),
        "--color=never".into(),
        "--no-heading".into(),
        "--with-filename".into(),
    ];
    match args.output_mode.as_deref().unwrap_or("files_with_matches") {
        "files_with_matches" => argv.push("--files-with-matches".into()),
        "count" => argv.push("--count".into()),
        "content" => {
            if args.line_numbers.unwrap_or(true) {
                argv.push("--line-number".into());
            }
            for (flag, value) in [
                ("--after-context", args.after),
                ("--before-context", args.before),
                ("--context", args.context),
            ] {
                if let Some(value) = value {
                    if value > MAX_RESULTS {
                        return Err(error("Context exceeds 2000 lines"));
                    }
                    argv.extend([flag.into(), value.to_string()]);
                }
            }
        }
        _ => {
            return Err(error(
                "output_mode must be content, files_with_matches or count",
            ));
        }
    }
    if args.insensitive {
        argv.push("--ignore-case".into());
    }
    if args.multiline {
        argv.extend(["--multiline".into(), "--multiline-dotall".into()]);
    }
    if let Some(glob) = &args.glob {
        argv.extend(["--glob".into(), glob.clone()]);
    }
    if let Some(file_type) = &args.file_type {
        argv.extend(["--type".into(), file_type.clone()]);
    }
    argv.extend([
        "--regexp".into(),
        args.pattern.clone(),
        "--".into(),
        args.path.clone().unwrap_or(".".into()),
    ]);
    Ok(argv)
}

fn shell_command(argv: &[String], shell: ShellType) -> Result<String, FunctionCallError> {
    if argv.iter().any(|arg| arg.contains('\0')) {
        return Err(error("Search arguments must not contain NUL"));
    }
    match shell {
        ShellType::PowerShell => Ok(format!(
            "& {}; exit $LASTEXITCODE",
            argv.iter()
                .map(|s| format!("'{}'", s.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(" ")
        )),
        ShellType::Bash | ShellType::Zsh | ShellType::Sh => Ok(argv
            .iter()
            .map(|s| posix_quote(s))
            .collect::<Vec<_>>()
            .join(" ")),
        ShellType::Cmd => Err(error(
            "Search requires PowerShell or a POSIX shell; cmd.exe is unsupported",
        )),
    }
}

async fn run_rg(
    mut invocation: ToolInvocation,
    argv: &[String],
) -> Result<Value, FunctionCallError> {
    let environment = resolve_tool_environment(
        &invocation.step_context,
        None,
        "Search requires an executor",
    )?;
    let shell = environment
        .shell
        .clone()
        .unwrap_or_else(|| invocation.session.user_shell().as_ref().clone());
    let command = shell_command(argv, shell.shell_type)?;
    invocation.payload = ToolPayload::Function {
        arguments:
            json!({"cmd":command, "login":false,"timeout_ms":120000,"max_output_tokens":null})
                .to_string(),
    };
    let output = exec_handler(false).handle(invocation.clone()).await?;
    let result = output.code_mode_result(&invocation.payload);
    match result.get("exit_code").and_then(Value::as_i64) {
        Some(0 | 1) => Ok(result),
        _ => Err(error(format!(
            "ripgrep search failed: {}",
            result
                .get("output")
                .and_then(Value::as_str)
                .unwrap_or("execution did not complete")
        ))),
    }
}

fn bounded_lines(
    result: &mut Value,
    offset: usize,
    head_limit: Option<usize>,
) -> Result<(), FunctionCallError> {
    if offset > 100_000 {
        return Err(error("offset exceeds 100000"));
    }
    let limit = head_limit
        .filter(|limit| *limit != 0)
        .unwrap_or(200)
        .min(MAX_RESULTS);
    let text = result.get("output").and_then(Value::as_str).unwrap_or("");
    let lines = text
        .lines()
        .skip(offset)
        .take(limit + 1)
        .collect::<Vec<_>>();
    let truncated = lines.len() > limit || result.get("output_omitted_bytes").is_some();
    let selected = lines
        .iter()
        .take(limit)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    result["output"] = Value::String(selected);
    result["truncated"] = json!(truncated);
    result["offset"] = json!(offset);
    Ok(())
}

pub struct ClaudeGrepHandler;
impl ToolExecutor<ToolInvocation> for ClaudeGrepHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("Grep")
    }
    fn spec(&self) -> ToolSpec {
        let mut properties = BTreeMap::new();
        for field in ["pattern", "path", "glob", "type", "output_mode"] {
            properties.insert(field.into(), JsonSchema::string(None));
        }
        for field in ["-i", "-n", "multiline"] {
            properties.insert(field.into(), JsonSchema::boolean(None));
        }
        for field in ["-A", "-B", "-C", "head_limit", "offset"] {
            properties.insert(field.into(), JsonSchema::number(None));
        }
        function_spec(
            "Grep",
            "Search with ripgrep regular expressions and native sandbox/permissions. Defaults to files_with_matches; content includes line numbers by default; count reports matching lines per file. Supports glob/type, -i/-n/-A/-B/-C and multiline (dot matches newline). Respects ignore files, skips hidden files and binary contents. head_limit defaults to 200 and is capped at 2000; offset skips output lines. Output has native collection limits and reports truncation.",
            properties,
            &["pattern"],
        )
    }
    fn supports_parallel_tool_calls(&self) -> bool {
        true
    }
    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let args: GrepArgs = arguments(&invocation)?;
            let argv = grep_argv(&args)?;
            let mut result = run_rg(invocation, &argv).await?;
            bounded_lines(&mut result, args.offset, args.head_limit)?;
            Ok(Box::new(JsonToolOutput::new(result)) as Box<dyn ToolOutput>)
        })
    }
}
impl CoreToolRuntime for ClaudeGrepHandler {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GlobArgs {
    pattern: String,
    path: Option<String>,
}
pub struct ClaudeGlobHandler;
impl ToolExecutor<ToolInvocation> for ClaudeGlobHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain("Glob")
    }
    fn spec(&self) -> ToolSpec {
        function_spec(
            "Glob",
            "Find files using ripgrep glob patterns under path (default executor cwd). Includes hidden files while respecting ignore files; never follows directory symlinks. Scans at most 10000 matching paths under the native 1MiB collection cap; returns at most 2000 files sorted by modification time descending with path tie-break. Reports truncation when scan or result bounds apply; narrow pattern/path for complete ordering beyond those limits. Paths containing newlines are unsupported.",
            BTreeMap::from([
                ("pattern".into(), JsonSchema::string(None)),
                ("path".into(), JsonSchema::string(None)),
            ]),
            &["pattern"],
        )
    }
    fn supports_parallel_tool_calls(&self) -> bool {
        true
    }
    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(async move {
            let args: GlobArgs = arguments(&invocation)?;
            let environment = resolve_tool_environment(
                &invocation.step_context,
                None,
                "Glob requires an executor",
            )?;
            let fs = environment.environment.get_filesystem();
            let sandbox = environment.sandbox_context(None);
            let argv = vec![
                "rg".into(),
                "--files".into(),
                "--hidden".into(),
                "--glob".into(),
                args.pattern,
                "--".into(),
                args.path.unwrap_or(".".into()),
            ];
            let mut result = run_rg(invocation.clone(), &argv).await?;
            let text = result.get("output").and_then(Value::as_str).unwrap_or("");
            let mut files = Vec::new();
            if result.get("output_omitted_bytes").is_some() {
                return Err(error(
                    "Glob exceeded the native 1MiB collection bound; narrow path/pattern to obtain complete paths for modification-time sorting",
                ));
            }
            let scan_truncated = text.lines().count() > MAX_GLOB_SCAN;
            // Sort complete paths, never token-truncated fragments. Metadata work
            // has a separate file-count bound from model output formatting.
            for file in text.lines().take(MAX_GLOB_SCAN) {
                if invocation.cancellation_token.is_cancelled() {
                    return Err(error("Glob cancelled"));
                }
                let path = environment
                    .cwd()
                    .join(file)
                    .map_err(|e| error(e.to_string()))?;
                let metadata = fs
                    .get_metadata(&path, Default::default(), Some(&sandbox))
                    .await
                    .map_err(|e| error(format!("Glob metadata failed for {file}: {e}")))?;
                if metadata.is_file {
                    files.push((metadata.modified_at_ms, file.to_string()));
                }
            }
            files.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
            result["truncated"] = json!(files.len() > MAX_RESULTS || scan_truncated);
            result["output"] = json!(
                files
                    .iter()
                    .take(MAX_RESULTS)
                    .map(|(_, path)| path.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            );
            Ok(Box::new(JsonToolOutput::new(result)) as Box<dyn ToolOutput>)
        })
    }
}
impl CoreToolRuntime for ClaudeGlobHandler {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn patterns_and_option_like_paths_remain_arguments() {
        let args: GrepArgs = serde_json::from_value(
            json!({"pattern":"$(oops)'|a", "path":"--hidden", "output_mode":"content", "-A":2}),
        )
        .unwrap();
        let argv = grep_argv(&args).unwrap();
        assert_eq!(
            &argv[argv.len() - 4..],
            &["--regexp", "$(oops)'|a", "--", "--hidden"]
        );
        let ps = shell_command(&argv, ShellType::PowerShell).unwrap();
        assert!(ps.contains("'$(oops)''|a'"));
        assert!(ps.ends_with("exit $LASTEXITCODE"));
    }
    #[test]
    fn offset_and_limit_are_applied_to_result_lines() {
        let mut result = json!({"output":"one\ntwo\nthree\nfour"});
        bounded_lines(&mut result, 1, Some(2)).unwrap();
        assert_eq!(result["output"], "two\nthree");
        assert_eq!(result["truncated"], true);
    }

    #[test]
    fn actual_ripgrep_regex_glob_binary_and_output_modes() {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::write(
            fixture.path().join("space 한글.rs"),
            "first\nAlpha 42\nlast\n",
        )
        .unwrap();
        std::fs::write(fixture.path().join("ignored.txt"), "Alpha 42\n").unwrap();
        std::fs::write(fixture.path().join(".gitignore"), "ignored.txt\n").unwrap();
        std::fs::write(fixture.path().join("binary.bin"), b"\0Alpha 42\0").unwrap();
        std::fs::write(fixture.path().join(".hidden.rs"), "Alpha 42\n").unwrap();
        let args: GrepArgs = serde_json::from_value(json!({"pattern":"alpha\\s+\\d+", "glob":"*.rs", "output_mode":"content", "-i":true,"-C":1})).unwrap();
        let argv = grep_argv(&args).unwrap();
        let output = std::process::Command::new("rg")
            .args(&argv[1..])
            .current_dir(fixture.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("space 한글.rs:2:Alpha 42"));
        assert!(text.contains("first") && text.contains("last"));
        assert!(!text.contains("hidden"));
        let count = GrepArgs {
            pattern: "Alpha".into(),
            output_mode: Some("count".into()),
            ..Default::default()
        };
        let argv = grep_argv(&count).unwrap();
        let output = std::process::Command::new("rg")
            .args(&argv[1..])
            .current_dir(fixture.path())
            .output()
            .unwrap();
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("space 한글.rs:1"));
        assert!(!text.contains("binary.bin"));
        let output = std::process::Command::new("rg")
            .args(["--files", "--hidden", "--glob", "*.rs", "--", "."])
            .current_dir(fixture.path())
            .output()
            .unwrap();
        assert!(
            String::from_utf8(output.stdout)
                .unwrap()
                .contains(".hidden.rs")
        );
    }

    #[cfg(windows)]
    #[test]
    fn actual_powershell_quoting_preserves_regex_metacharacters() {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::write(fixture.path().join("quote.txt"), "literal '$(value)\n").unwrap();
        let args: GrepArgs = serde_json::from_value(
            json!({"pattern":"literal '\\$\\(value\\)","path":"quote.txt","output_mode":"content"}),
        )
        .unwrap();
        let command = shell_command(&grep_argv(&args).unwrap(), ShellType::PowerShell).unwrap();
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &command])
            .current_dir(fixture.path())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(0));
        assert!(String::from_utf8_lossy(&output.stdout).contains("literal '$(value)"));
    }
}
