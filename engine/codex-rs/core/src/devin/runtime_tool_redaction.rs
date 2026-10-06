use regex_lite::Regex;
use std::sync::LazyLock;

pub(super) const MAX_REDACTION_SCAN_BYTES: usize = 16 * 1024;
pub(super) const TRUNCATED: &str = "... [truncated]";

static SECRET_ASSIGNMENT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)(["']?(?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|password|passwd|secret)["']?\s*[:=]\s*)(?:"[^"\r\n]*"?|'[^'\r\n]*'?|[^\s,;}\]]+)"#,
    )
    .unwrap_or_else(|error| panic!("secret assignment regex is valid: {error}"))
});
static AUTH_HEADER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(authorization|proxy-authorization)\s*:\s*([^\r\n]+)")
        .unwrap_or_else(|error| panic!("authorization header regex is valid: {error}"))
});
static BEARER_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")
        .unwrap_or_else(|error| panic!("bearer token regex is valid: {error}"))
});
static OPENAI_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\bsk-[a-zA-Z0-9_-]{8,}")
        .unwrap_or_else(|error| panic!("OpenAI token regex is valid: {error}"))
});

pub(in super::super) fn bounded_redacted(text: &str, limit: usize) -> String {
    // Bound regex work while leaving enough context to identify secrets before
    // applying the smaller display limit. Unterminated quoted values are matched.
    let input = scan_prefix(text, MAX_REDACTION_SCAN_BYTES);
    let text = SECRET_ASSIGNMENT.replace_all(input, "$1[REDACTED]");
    let text = AUTH_HEADER.replace_all(&text, "$1: [REDACTED]");
    let text = BEARER_TOKEN.replace_all(&text, "Bearer [REDACTED]");
    let text = OPENAI_TOKEN.replace_all(&text, "[REDACTED]");
    truncate_utf8(&text, limit)
}

fn scan_prefix(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn truncate_utf8(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    if limit <= TRUNCATED.len() {
        return TRUNCATED[..limit].to_string();
    }
    let mut end = limit - TRUNCATED.len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}{TRUNCATED}", &text[..end])
}
