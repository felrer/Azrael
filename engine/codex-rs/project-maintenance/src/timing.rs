//! Opt-in diagnostics only: never change a maintenance result on output failure.
use serde_json::{Value, json};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub(crate) struct Span(Option<ActiveSpan>);

/// Observe one existing operation without inspecting, cloning or transforming
/// its result. Diagnostic output remains best effort, including on errors.
pub(crate) fn phase<T, E>(
    operation: &str,
    path: Option<&Path>,
    run: impl FnOnce() -> Result<T, E>,
) -> Result<T, E> {
    let mut span = Span::new("maintenance.phase", operation, path);
    span.attempt();
    let result = run();
    span.outcome(if result.is_ok() { "success" } else { "error" });
    result
}

struct ActiveSpan {
    start: Instant,
    event: &'static str,
    operation: String,
    path: Option<PathBuf>,
    attempts: u64,
    outcome: &'static str,
}

impl Span {
    pub(crate) fn new(event: &'static str, operation: &str, path: Option<&Path>) -> Self {
        Self::with_enabled(
            std::env::var_os("AZRAEL_MAINTENANCE_TIMING").is_some_and(|value| value == "1"),
            event,
            operation,
            path,
        )
    }

    fn with_enabled(
        enabled: bool,
        event: &'static str,
        operation: &str,
        path: Option<&Path>,
    ) -> Self {
        Self(enabled.then(|| ActiveSpan {
            start: Instant::now(),
            event,
            operation: operation.to_owned(),
            path: path.map(Path::to_owned),
            attempts: 0,
            outcome: "interrupted",
        }))
    }

    pub(crate) fn attempt(&mut self) {
        if let Some(span) = &mut self.0 {
            span.attempts = span.attempts.saturating_add(1);
        }
    }

    pub(crate) fn outcome(&mut self, outcome: &'static str) {
        if let Some(span) = &mut self.0 {
            span.outcome = outcome;
        }
    }
}

impl ActiveSpan {
    fn record(&self) -> Value {
        json!({
            "event": self.event,
            "component": "project-maintenance",
            "level": "DEBUG",
            "timestamp_unix_ms": SystemTime::now().duration_since(UNIX_EPOCH)
                .unwrap_or_default().as_millis().min(u64::MAX as u128) as u64,
            "pid": std::process::id(),
            "version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "operation": self.operation,
            "path": self.path.as_ref().map(|path| path.to_string_lossy()),
            "elapsed_us": self.start.elapsed().as_micros().min(u64::MAX as u128) as u64,
            "attempts": self.attempts,
            "outcome": self.outcome,
        })
    }
}

fn write_record(writer: &mut impl Write, record: &Value) {
    // Buffer one JSON line first, so serialization cannot leave a partial record.
    if let Ok(mut bytes) = serde_json::to_vec(record) {
        bytes.push(b'\n');
        let _ = writer.write_all(&bytes);
    }
}

impl Drop for Span {
    fn drop(&mut self) {
        if let Some(span) = &self.0 {
            write_record(&mut std::io::stderr().lock(), &span.record());
        }
    }
}

// Detailed review diagnostics are opt-in and aggregated per observation. Never
// retain paths, item IDs, authority results or payloads in this collector.
#[derive(Default)]
struct DetailStats {
    count: u64,
    total_us: u64,
    max_us: u64,
}

struct DetailCollector {
    scope: &'static str,
    stats: std::collections::BTreeMap<&'static str, DetailStats>,
}

thread_local! {
    static DETAILS: std::cell::RefCell<Option<DetailCollector>> = const { std::cell::RefCell::new(None) };
}

pub(crate) struct DetailScope {
    active: bool,
    previous: Option<DetailCollector>,
    thread: std::marker::PhantomData<std::rc::Rc<()>>,
}

impl DetailScope {
    pub(crate) fn new(scope: &'static str) -> Self {
        Self::with_enabled(
            std::env::var_os("AZRAEL_MAINTENANCE_DETAIL_TIMING").is_some_and(|v| v == "1"),
            scope,
        )
    }

    fn with_enabled(active: bool, scope: &'static str) -> Self {
        let previous = if active {
            DETAILS.with(|slot| {
                slot.replace(Some(DetailCollector {
                    scope,
                    stats: Default::default(),
                }))
            })
        } else {
            None
        };
        Self {
            active,
            previous,
            thread: Default::default(),
        }
    }
}

impl Drop for DetailScope {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let collector = DETAILS.with(|slot| slot.replace(self.previous.take()));
        if let Some(collector) = collector {
            for (operation, stats) in collector.stats {
                let mut span = Span::with_enabled(true, "maintenance.detail", operation, None);
                let mut record = span.0.take().unwrap().record();
                record["scope"] = json!(collector.scope);
                record["count"] = json!(stats.count);
                record["elapsed_us"] = json!(stats.total_us);
                record["max_us"] = json!(stats.max_us);
                // Scope exit is an observation, not a success/authority receipt.
                record["outcome"] = json!("scope_exit");
                write_record(&mut std::io::stderr().lock(), &record);
            }
        }
    }
}

pub(crate) struct DetailSpan {
    start: Option<Instant>,
    operation: &'static str,
    thread: std::marker::PhantomData<std::rc::Rc<()>>,
}

pub(crate) fn detail(operation: &'static str) -> DetailSpan {
    DetailSpan {
        start: DETAILS.with(|slot| slot.borrow().as_ref().map(|_| Instant::now())),
        operation,
        thread: Default::default(),
    }
}

impl Drop for DetailSpan {
    fn drop(&mut self) {
        let Some(start) = self.start else {
            return;
        };
        let elapsed = start.elapsed().as_micros().min(u64::MAX as u128) as u64;
        DETAILS.with(|slot| {
            if let Some(collector) = slot.borrow_mut().as_mut() {
                let stats = collector.stats.entry(self.operation).or_default();
                stats.count = stats.count.saturating_add(1);
                stats.total_us = stats.total_us.saturating_add(elapsed);
                stats.max_us = stats.max_us.max(elapsed);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detailed_scopes_aggregate_and_restore_without_leaking_between_reviews() {
        let disabled = DetailScope::with_enabled(false, "disabled");
        drop(detail("ignored"));
        assert!(DETAILS.with(|slot| slot.borrow().is_none()));
        drop(disabled);

        let outer = DetailScope::with_enabled(true, "outer");
        drop(detail("repeat"));
        drop(detail("repeat"));
        let inner = DetailScope::with_enabled(true, "inner");
        drop(detail("nested"));
        let nested = DETAILS.with(|slot| slot.take()).unwrap();
        assert_eq!(nested.scope, "inner");
        assert_eq!(nested.stats["nested"].count, 1);
        drop(inner);
        drop(detail("after_nested"));
        let collected = DETAILS.with(|slot| slot.take()).unwrap();
        assert_eq!(collected.scope, "outer");
        assert_eq!(collected.stats["repeat"].count, 2);
        assert!(collected.stats["repeat"].total_us >= collected.stats["repeat"].max_us);
        assert_eq!(collected.stats["after_nested"].count, 1);
        assert!(!collected.stats.contains_key("nested"));
        drop(outer);
        assert!(DETAILS.with(|slot| slot.borrow().is_none()));
    }

    #[test]
    fn phase_preserves_owned_results_and_invokes_operation_once() {
        #[derive(Debug, PartialEq)]
        struct Marker(u8);
        let calls = std::cell::Cell::new(0);
        let success = phase("test.success", None, || {
            calls.set(calls.get() + 1);
            Ok::<_, Marker>(Marker(1))
        });
        assert_eq!(success, Ok(Marker(1)));
        let failure = phase("test.failure", None, || {
            calls.set(calls.get() + 1);
            Err::<Marker, _>(Marker(2))
        });
        assert_eq!(failure, Err(Marker(2)));
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn timing_record_preserves_structured_context_without_environment_mutation() {
        let mut span = Span::with_enabled(true, "maintenance.lock_wait", "wait_for_lock", None);
        span.attempt();
        span.attempt();
        span.outcome("timeout");
        let active = span.0.take().unwrap();
        let mut bytes = Vec::new();
        write_record(&mut bytes, &active.record());
        assert_eq!(bytes.last(), Some(&b'\n'));
        let record: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(record["event"], "maintenance.lock_wait");
        assert_eq!(record["operation"], "wait_for_lock");
        assert!(record["path"].is_null());
        assert_eq!(record["attempts"], 2);
        assert_eq!(record["outcome"], "timeout");
        assert_eq!(record["pid"], std::process::id());
        assert!(record["elapsed_us"].as_u64().is_some());
    }

    #[test]
    fn disabled_timing_and_failed_output_do_not_affect_the_caller() {
        let mut span = Span::with_enabled(false, "maintenance.lock_hold", "test", None);
        span.attempt();
        span.outcome("released");
        assert!(span.0.is_none());
        struct FailedWriter;
        impl Write for FailedWriter {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("diagnostic sink unavailable"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        write_record(
            &mut FailedWriter,
            &json!({"event": "maintenance.lock_hold"}),
        );
    }
}
