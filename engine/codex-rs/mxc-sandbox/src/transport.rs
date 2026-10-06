//! Bounded launcher-only environment transport for policies too large for
//! Windows command lines. Every transport variable is removed before spawn.

use std::collections::HashMap;

#[cfg(any(windows, test))]
use anyhow::Context;
use anyhow::Result;
use codex_windows_sandbox::environment_transport;

use crate::MxcCommand;

/// Restore only executor-owned Windows setup values in the wrapper environment.
#[cfg(any(windows, test))]
pub(super) fn add_launcher_environment(
    env: &mut HashMap<String, String>,
    mut executor_value: impl FnMut(&str) -> Option<std::ffi::OsString>,
) -> Result<()> {
    for key in ["SystemDrive", "LOCALAPPDATA", "SystemRoot"] {
        env.retain(|candidate, _| !launcher_key_eq(candidate, key));
        if let Some(value) = executor_value(key) {
            let value = value
                .into_string()
                .map_err(|_| anyhow::anyhow!("MXC requires Unicode launcher environment values"))?;
            env.insert(key.to_owned(), value);
        }
    }
    Ok(())
}

#[cfg(windows)]
fn launcher_key_eq(candidate: &str, key: &str) -> bool {
    // Match Windows environment-name comparison, including Unicode casing.
    // This is the same platform comparison used by the shared transport codec.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CompareStringOrdinal(
            left: *const u16,
            left_len: i32,
            right: *const u16,
            right_len: i32,
            ignore_case: i32,
        ) -> i32;
    }
    let candidate: Vec<u16> = candidate.encode_utf16().collect();
    let key: Vec<u16> = key.encode_utf16().collect();
    candidate.len() == key.len()
        && unsafe {
            CompareStringOrdinal(
                candidate.as_ptr(),
                candidate.len() as i32,
                key.as_ptr(),
                key.len() as i32,
                /*ignore_case*/ 1,
            ) == 2
        }
}

#[cfg(all(not(windows), test))]
fn launcher_key_eq(candidate: &str, key: &str) -> bool {
    candidate.eq_ignore_ascii_case(key)
}

pub(super) fn encode(command: &MxcCommand, env: &mut HashMap<String, String>) -> Result<()> {
    let payload = serde_json::to_string(command)?;
    environment_transport::encode(&payload, env)
}

#[cfg(any(windows, test))]
pub(super) fn decode(env: &mut HashMap<String, String>) -> Result<MxcCommand> {
    let payload = environment_transport::decode_and_scrub(env)?;
    let mut command: MxcCommand =
        serde_json::from_str(&payload).context("invalid MXC launcher request")?;
    command
        .command_environment
        .retain(|key, _| !environment_transport::is_key(key.as_ref()));
    Ok(command)
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
