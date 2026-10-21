#![allow(clippy::expect_used)]

// Aggregates integration test modules without a dedicated test binary.
// The submodules live in `tests/suite/`.
pub use codex_protocol::error;

mod integration_test_setup;
mod suite;
