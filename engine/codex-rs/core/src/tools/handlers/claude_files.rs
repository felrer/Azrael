//! Text-only Claude-compatible tools backed by the native filesystem and patch
//! approval runtime. Read state belongs to a Session, never a process-global map.
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use codex_exec_server::GetMetadataOptions;
use codex_exec_server::ReadFileOptions;
use codex_protocol::models::ResponseInputItem;
use codex_tools::JsonSchema;
use codex_tools::ResponsesApiTool;
use codex_tools::ToolName;
use codex_tools::ToolSpec;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;

use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::context::boxed_tool_output;
use crate::tools::handlers::apply_patch::execute_exact_file_write;
use crate::tools::handlers::parse_arguments;
use crate::tools::handlers::resolve_tool_environment;
use crate::tools::registry::CoreToolRuntime;
use crate::tools::registry::ToolExecutor;
use crate::tools::runtimes::apply_patch::ExactFileWrite;
use crate::tools::runtimes::apply_patch::canonical_write_path;
use crate::tools::sandboxing::ToolCtx;

const DEFAULT_LINES: usize = 2000;
const OUTPUT_BYTES: usize = 32 * 1024;

#[derive(Default)]
pub(crate) struct ClaudeFileState {
    reads: Mutex<HashMap<(String, String), ReadCoverage>>,
}

struct ReadCoverage {
    fingerprint: String,
    total_lines: usize,
    ranges: Vec<(usize, usize)>,
}

impl ReadCoverage {
    fn complete(&self) -> bool {
        self.total_lines == 0 || self.ranges.first() == Some(&(0, self.total_lines))
    }

    fn include(&mut self, start: usize, end: usize) {
        if start >= end {
            return;
        }
        self.ranges.push((start, end));
        self.ranges.sort_unstable();
        let mut merged: Vec<(usize, usize)> = Vec::new();
        for &(start, end) in &self.ranges {
            if let Some(last) = merged.last_mut()
                && start <= last.1
            {
                last.1 = last.1.max(end);
            } else {
                merged.push((start, end));
            }
        }
        self.ranges = merged;
    }
}

#[derive(Clone, Copy)]
pub(crate) enum ClaudeFileOperation {
    Read,
    Edit,
    Write,
}

impl ClaudeFileOperation {
    fn name(self) -> &'static str {
        match self {
            Self::Read => "Read",
            Self::Edit => "Edit",
            Self::Write => "Write",
        }
    }
}

pub(crate) struct ClaudeFileHandler {
    operation: ClaudeFileOperation,
    state: Arc<ClaudeFileState>,
    multi_environment: bool,
}

impl ClaudeFileHandler {
    pub(crate) fn new(
        operation: ClaudeFileOperation,
        state: Arc<ClaudeFileState>,
        multi_environment: bool,
    ) -> Self {
        Self {
            operation,
            state,
            multi_environment,
        }
    }

    async fn handle_call(
        &self,
        invocation: ToolInvocation,
    ) -> Result<Box<dyn ToolOutput>, FunctionCallError> {
        let ToolPayload::Function { arguments } = &invocation.payload else {
            return Err(error("expected function arguments"));
        };
        let args: FileArgs = parse_arguments(arguments)?;
        args.validate(self.operation, self.multi_environment)?;
        let environment = resolve_tool_environment(
            &invocation.step_context,
            args.environment_id.as_deref(),
            "file tools are unavailable in this session",
        )?;
        let bytes = args.file_path.as_bytes();
        let native_absolute = match environment.cwd().infer_path_convention() {
            Some(codex_utils_path_uri::PathConvention::Windows) => {
                args.file_path.starts_with("\\\\")
                    || matches!(bytes, [drive, b':', slash, ..] if drive.is_ascii_alphabetic() && (*slash == b'/' || *slash == b'\\'))
            }
            Some(codex_utils_path_uri::PathConvention::Posix) => args.file_path.starts_with('/'),
            None => false,
        };
        if !native_absolute {
            return Err(error(
                "file_path must be absolute in the selected environment",
            ));
        }
        let sandbox = environment.sandbox_context(None);
        let fs = environment.environment.get_filesystem();
        let requested = environment
            .cwd()
            .join(&args.file_path)
            .map_err(|err| error(err.to_string()))?;
        let path = canonical_write_path(fs.as_ref(), &requested, Some(&sandbox))
            .await
            .map_err(|err| error(err.to_string()))?;
        let environment_id = environment.selection.environment_id.clone();
        let key = (environment_id.clone(), path.to_string());
        let metadata = fs
            .get_metadata(&path, GetMetadataOptions::default(), Some(&sandbox))
            .await;
        let exists = match metadata {
            Ok(metadata) if metadata.is_file => true,
            Ok(_) => return Err(error("file_path is not a regular file")),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(err) => return Err(error(err.to_string())),
        };
        let current = if exists {
            Some(
                fs.read_file_text(&path, ReadFileOptions::default(), Some(&sandbox))
                    .await
                    .map_err(|err| {
                        error(format!(
                            "text read failed (only UTF-8 text is supported): {err}"
                        ))
                    })?,
            )
        } else {
            None
        };
        match self.operation {
            ClaudeFileOperation::Read => {
                let text = current.ok_or_else(|| error("file does not exist"))?;
                let (visible, start, end, total_lines) = numbered_read(
                    &text,
                    args.offset.unwrap_or(1),
                    args.limit.unwrap_or(DEFAULT_LINES),
                );
                let stamp = ReadStamp {
                    environment_id,
                    canonical_path: path.to_string(),
                    fingerprint: fingerprint(&text),
                    start,
                    end,
                    total_lines,
                    visible_fingerprint: fingerprint(&visible),
                };
                Ok(boxed_tool_output(ReadOutput {
                    output: FunctionToolOutput::from_text(visible, Some(true)),
                    metadata: serde_json::json!({ "claude_read_stamp": stamp }),
                }))
            }
            ClaudeFileOperation::Edit | ClaudeFileOperation::Write => {
                if let Some(text) = &current {
                    let reads = self
                        .state
                        .reads
                        .lock()
                        .map_err(|_| error("read state unavailable"))?;
                    if !reads.get(&key).is_some_and(|read| {
                        read.fingerprint == fingerprint(text) && read.complete()
                    }) {
                        return Err(error(
                            "Read the entire current file before editing or overwriting it; accepted ranges may be combined, but rejected, missing, or stale ranges are insufficient",
                        ));
                    }
                }
                let content = match self.operation {
                    ClaudeFileOperation::Edit => exact_edit(
                        current
                            .as_deref()
                            .ok_or_else(|| error("Edit requires an existing file"))?,
                        args.old_string.as_deref().unwrap_or_default(),
                        args.new_string.as_deref().unwrap_or_default(),
                        args.replace_all.unwrap_or(false),
                    )?,
                    _ => args.content.unwrap_or_default(),
                };
                // Invalidate before awaiting approval: concurrent mutations cannot
                // inherit a stale accepted Read from this operation.
                self.state
                    .reads
                    .lock()
                    .map_err(|_| error("read state unavailable"))?
                    .remove(&key);
                let ctx = ToolCtx {
                    session: invocation.session,
                    step_context: Arc::clone(&invocation.step_context),
                    cancellation_token: invocation.cancellation_token,
                    call_id: invocation.call_id,
                    tool_name: invocation.tool_name,
                };
                let output = execute_exact_file_write(
                    ExactFileWrite {
                        path,
                        expected_content: current,
                        content,
                    },
                    environment.clone(),
                    Some(&invocation.tracker),
                    ctx,
                )
                .await?;
                // Conservatively require another accepted Read after any write.
                Ok(boxed_tool_output(FunctionToolOutput::from_text(
                    output,
                    Some(true),
                )))
            }
        }
    }
}

impl ToolExecutor<ToolInvocation> for ClaudeFileHandler {
    fn tool_name(&self) -> ToolName {
        ToolName::plain(self.operation.name())
    }
    fn spec(&self) -> ToolSpec {
        file_spec(self.operation, self.multi_environment)
    }
    fn supports_parallel_tool_calls(&self) -> bool {
        false
    }
    fn handle<'a>(&'a self, invocation: ToolInvocation) -> codex_tools::ToolExecutorFuture<'a>
    where
        ToolInvocation: 'a,
    {
        Box::pin(self.handle_call(invocation))
    }
}

impl CoreToolRuntime for ClaudeFileHandler {
    fn on_tool_result_accepted(&self, invocation: &ToolInvocation, result: &dyn ToolOutput) {
        if !matches!(self.operation, ClaudeFileOperation::Read) {
            return;
        }
        let Some(stamp) = result
            .tool_result_metadata()
            .and_then(|metadata| metadata.get("claude_read_stamp"))
            .and_then(|stamp| serde_json::from_value::<ReadStamp>(stamp.clone()).ok())
        else {
            return;
        };
        // A hook may replace the model-facing output with feedback. Such output
        // must not certify that the model saw the file.
        let visible = result.to_response_item(&invocation.call_id, &invocation.payload);
        let ResponseInputItem::FunctionCallOutput { output, .. } = visible else {
            return;
        };
        let visible_fingerprint = fingerprint(&output.body.to_text().unwrap_or_default());
        let Ok(mut reads) = self.state.reads.lock() else {
            return;
        };
        let key = (stamp.environment_id, stamp.canonical_path);
        if visible_fingerprint != stamp.visible_fingerprint {
            return;
        }
        let read = reads.entry(key).or_insert_with(|| ReadCoverage {
            fingerprint: stamp.fingerprint.clone(),
            total_lines: stamp.total_lines,
            ranges: Vec::new(),
        });
        if read.fingerprint != stamp.fingerprint {
            *read = ReadCoverage {
                fingerprint: stamp.fingerprint,
                total_lines: stamp.total_lines,
                ranges: Vec::new(),
            };
        }
        read.include(stamp.start, stamp.end);
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileArgs {
    file_path: String,
    environment_id: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    old_string: Option<String>,
    new_string: Option<String>,
    replace_all: Option<bool>,
    content: Option<String>,
}

impl FileArgs {
    fn validate(
        &self,
        operation: ClaudeFileOperation,
        multi_environment: bool,
    ) -> Result<(), FunctionCallError> {
        let bytes = self.file_path.as_bytes();
        let absolute = self.file_path.starts_with('/')
            || self.file_path.starts_with("\\\\")
            || matches!(bytes, [drive, b':', slash, ..] if drive.is_ascii_alphabetic() && (*slash == b'/' || *slash == b'\\'));
        if !absolute || self.file_path.contains('\0') {
            return Err(error(
                "file_path must be an absolute native filesystem path",
            ));
        }
        if self.environment_id.is_some() && !multi_environment {
            return Err(error("environment selection is unavailable for this turn"));
        }
        let valid = match operation {
            ClaudeFileOperation::Read => {
                self.content.is_none()
                    && self.old_string.is_none()
                    && self.new_string.is_none()
                    && self.replace_all.is_none()
                    && self.offset != Some(0)
                    && self.limit != Some(0)
            }
            ClaudeFileOperation::Edit => {
                self.old_string.is_some()
                    && self.new_string.is_some()
                    && self.content.is_none()
                    && self.offset.is_none()
                    && self.limit.is_none()
            }
            ClaudeFileOperation::Write => {
                self.content.is_some()
                    && self.old_string.is_none()
                    && self.new_string.is_none()
                    && self.replace_all.is_none()
                    && self.offset.is_none()
                    && self.limit.is_none()
            }
        };
        if !valid {
            return Err(error("invalid or missing arguments for this file tool"));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
struct ReadStamp {
    environment_id: String,
    canonical_path: String,
    fingerprint: String,
    start: usize,
    end: usize,
    total_lines: usize,
    visible_fingerprint: String,
}

struct ReadOutput {
    output: FunctionToolOutput,
    metadata: Value,
}
impl ToolOutput for ReadOutput {
    fn log_output(&self) -> String {
        self.output.log_output()
    }
    fn success_for_logging(&self) -> bool {
        true
    }
    fn to_response_item(&self, call_id: &str, payload: &ToolPayload) -> ResponseInputItem {
        self.output.to_response_item(call_id, payload)
    }
    fn tool_result_metadata(&self) -> Option<&Value> {
        Some(&self.metadata)
    }
    fn fallback_token_limit_override(&self) -> Option<usize> {
        Some(OUTPUT_BYTES + 1024)
    }
}

fn fingerprint(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn error(message: impl Into<String>) -> FunctionCallError {
    FunctionCallError::RespondToModel(message.into())
}

fn numbered_read(text: &str, offset: usize, limit: usize) -> (String, usize, usize, usize) {
    let mut output = String::new();
    let total_lines = text.lines().count();
    let start = offset.saturating_sub(1).min(total_lines);
    let mut count = 0;
    for (index, line) in text.lines().enumerate() {
        if index < offset.saturating_sub(1) {
            continue;
        }
        let numbered = format!("{}\t{}\n", index + 1, line);
        if count >= limit || output.len() + numbered.len() > OUTPUT_BYTES {
            output.push_str(
                "[Read truncated; use offset/limit to read remaining lines before Edit/Write.]\n",
            );
            break;
        }
        count += 1;
        output.push_str(&numbered);
    }
    if text.is_empty() {
        output.push_str("[File is empty]\n");
    }
    (output, start, start + count, total_lines)
}

fn exact_edit(
    text: &str,
    old: &str,
    new: &str,
    replace_all: bool,
) -> Result<String, FunctionCallError> {
    if old.is_empty() {
        return Err(error("old_string must not be empty"));
    }
    if old == new {
        return Err(error("old_string and new_string must differ"));
    }
    let matches = text
        .char_indices()
        .filter(|(index, _)| text[*index..].starts_with(old))
        .count();
    if matches == 0 {
        return Err(error("old_string was not found in the file"));
    }
    if matches > 1 && !replace_all {
        return Err(error(
            "old_string is not unique; provide more context or use replace_all",
        ));
    }
    Ok(if replace_all {
        text.replace(old, new)
    } else {
        text.replacen(old, new, 1)
    })
}

fn file_spec(operation: ClaudeFileOperation, multi_environment: bool) -> ToolSpec {
    let mut properties = BTreeMap::from([(
        "file_path".to_string(),
        JsonSchema::string(Some("Absolute path to a UTF-8 text file.".to_string())),
    )]);
    let mut required = vec!["file_path".to_string()];
    let description = match operation {
        ClaudeFileOperation::Read => {
            properties.insert(
                "offset".into(),
                JsonSchema::integer(Some("First line, starting at 1.".into())),
            );
            properties.insert(
                "limit".into(),
                JsonSchema::integer(Some(
                    "Positive maximum line count; defaults to 2000. Output is also byte limited."
                        .into(),
                )),
            );
            "Read UTF-8 text with numbered lines. Images, PDF and notebooks are unsupported. Read all lines before Edit or overwriting with Write; accepted offset/limit ranges of unchanged content are combined. Output is byte limited; lines exceeding the output budget are unsupported."
        }
        ClaudeFileOperation::Edit => {
            properties.insert(
                "old_string".into(),
                JsonSchema::string(Some(
                    "Nonempty exact text to replace; must be unique unless replace_all is true."
                        .into(),
                )),
            );
            properties.insert(
                "new_string".into(),
                JsonSchema::string(Some(
                    "Replacement text; must differ from old_string.".into(),
                )),
            );
            properties.insert(
                "replace_all".into(),
                JsonSchema::boolean(Some("Replace all occurrences; defaults to false.".into())),
            );
            required.extend(["old_string".into(), "new_string".into()]);
            "Replace exact text in a file after an accepted complete Read. Rejects changed files and ambiguous matches. Uses native patch approvals and sandbox, and preserves exact bytes including CRLF. Read again after writing."
        }
        ClaudeFileOperation::Write => {
            properties.insert(
                "content".into(),
                JsonSchema::string(Some(
                    "Exact UTF-8 text to write, including desired line endings.".into(),
                )),
            );
            required.push("content".into());
            "Write a UTF-8 text file using native patch approvals and sandbox. Creates a new file; overwriting requires an accepted complete Read of the current file. Read again after writing."
        }
    };
    if multi_environment {
        properties.insert(
            "environment_id".into(),
            JsonSchema::string(Some(
                "Environment id; omit for the primary environment.".into(),
            )),
        );
    }
    ToolSpec::Function(ResponsesApiTool {
        name: operation.name().into(),
        description: description.into(),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(properties, Some(required), Some(false.into())),
        output_schema: None,
    })
}

#[cfg(test)]
#[path = "claude_files_tests.rs"]
mod tests;
