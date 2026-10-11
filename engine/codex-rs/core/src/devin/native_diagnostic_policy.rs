//! Optional native diagnostics, evaluated at request/log boundaries.
//! Environment changes in the launching host require an engine restart to be inherited.

#[derive(Clone, Copy)]
pub(super) struct DiagnosticPolicy {
    pub(super) inference: bool,
    pub(super) tools: bool,
}

impl DiagnosticPolicy {
    pub(super) fn from_env() -> Self {
        Self::resolve(
            std::env::var("AZRAEL_DIAGNOSTICS").ok().as_deref(),
            std::env::var("AZRAEL_DIAGNOSTICS_INFERENCE")
                .ok()
                .as_deref(),
            std::env::var("AZRAEL_DIAGNOSTICS_TOOLS").ok().as_deref(),
        )
    }

    fn resolve(master: Option<&str>, inference: Option<&str>, tools: Option<&str>) -> Self {
        let master = master.and_then(parse_bool).unwrap_or(true);
        Self {
            inference: inference.and_then(parse_bool).unwrap_or(master),
            tools: tools.and_then(parse_bool).unwrap_or(master),
        }
    }
}

fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_explicit_booleans_with_whitespace_and_case() {
        for value in ["1", "true", "on", " TRUE ", "\tOn\n"] {
            assert_eq!(parse_bool(value), Some(true));
        }
        for value in ["0", "false", "off", " FALSE ", "\tOff\n"] {
            assert_eq!(parse_bool(value), Some(false));
        }
        for value in ["", " ", "yes", "no", "2", "enabled", "true false"] {
            assert_eq!(parse_bool(value), None);
        }
    }

    #[test]
    fn defaults_and_invalid_values_preserve_existing_logging() {
        for value in [None, Some("invalid"), Some(""), Some("true")] {
            let policy = DiagnosticPolicy::resolve(value, None, Some("invalid"));
            assert!(policy.inference);
            assert!(policy.tools);
        }
    }

    #[test]
    fn categories_override_master_independently() {
        let policy = DiagnosticPolicy::resolve(Some("off"), Some(" ON "), Some("invalid"));
        assert!(policy.inference);
        assert!(!policy.tools);
        let policy = DiagnosticPolicy::resolve(Some("on"), Some("off"), None);
        assert!(!policy.inference);
        assert!(policy.tools);
        let policy = DiagnosticPolicy::resolve(Some("off"), None, Some("true"));
        assert!(!policy.inference);
        assert!(policy.tools);
        let policy = DiagnosticPolicy::resolve(Some("off"), None, None);
        assert!(!policy.inference);
        assert!(!policy.tools);
    }
}
