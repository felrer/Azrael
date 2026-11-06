//! Shared local CLI boundary. OS permissions remain authoritative.
use crate::AccessMode;
use serde_json::Value;
use std::ffi::OsString;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

const MAX_REQUEST_BYTES: u64 = 64 * 1024 * 1024;

fn read_request(input: impl Read) -> Result<Value, String> {
    let mut bytes = Vec::new();
    input
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err("maintenance request exceeds 64 MiB".into());
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn absolute_plain(path: &Path) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("project and request paths must be absolute without traversal".into());
    }
    for ancestor in path.ancestors() {
        let metadata = std::fs::symlink_metadata(ancestor).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("link path rejected".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("reparse path rejected".into());
            }
        }
    }
    Ok(())
}

fn request_mode(args: &[OsString]) -> Result<Value, String> {
    request_mode_with_input(args, io::stdin().lock())
}

fn request_mode_with_input(args: &[OsString], input: impl Read) -> Result<Value, String> {
    request_mode_with_home(args, input, &crate::preferences::home()?)
}

fn request_mode_with_home(
    args: &[OsString],
    input: impl Read,
    home: &std::path::Path,
) -> Result<Value, String> {
    if args.len() != 4 || args[0] != "--project-root" || args[2] != "--request" {
        return Err(
            "usage: maintenance_owner --project-root ABSOLUTE_ROOT --request ABSOLUTE_IN_ROOT_JSON_OR_-"
                .into(),
        );
    }
    let selected = PathBuf::from(&args[1]);
    let request_path = PathBuf::from(&args[3]);
    absolute_plain(&selected)?;
    let root = dunce::canonicalize(&selected).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("project root must be a directory".into());
    }
    let mut request: Value = if args[3] == "-" {
        read_request(input)?
    } else {
        // Check lexical containment before observing a caller-selected request file.
        if !request_path.is_absolute() || !request_path.starts_with(&root) {
            return Err("request file must be absolute and within selected project".into());
        }
        absolute_plain(&request_path)?;
        if !request_path.is_file() {
            return Err("request must be a JSON file".into());
        }
        if crate::paths::within(&request_path, &root.join("artifacts/maintenance")) {
            return Err("disposable request file must be outside artifacts/maintenance; use --request - or a task-owned request file; recovery evidence paths are unchanged".into());
        }
        read_request(std::fs::File::open(&request_path).map_err(|error| error.to_string())?)?
    };
    if !matches!(
        request["operation"].as_str(),
        Some(
            "inventory"
                | "register"
                | "review"
                | "apply"
                | "begin_run"
                | "run_status"
                | "request_status"
                | "request_cancel"
                | "request_ack"
                | "request_recover"
                | "request_recover_pending"
                | "recover_lock"
                | "recover_reservation"
        )
    ) {
        return Err(
            "owner runner supports only inventory/register/review/apply/begin_run/run_status/request_status/request_cancel/request_ack/request_recover/request_recover_pending/recover_lock/recover_reservation".into(),
        );
    }
    let automatic = automatic_envelope(&mut request)?;
    let dispatch = |request| {
        crate::dispatch_with_preferences(
            home,
            &root,
            request,
            &|path, access| {
                if path.starts_with(&root) || (access == AccessMode::Read && root.starts_with(path))
                {
                    Ok(())
                } else {
                    Err(format!(
                        "outside selected project permission boundary: {}",
                        path.display()
                    ))
                }
            },
            &|| false,
        )
    };
    let outcome = dispatch(request);
    match automatic {
        Some(envelope) => finish_automatic_request(outcome, envelope, dispatch),
        None => outcome,
    }
}

fn automatic_envelope(request: &mut Value) -> Result<Option<Value>, String> {
    let recovery_context = request["operation"] == "request_recover_pending";
    if !matches!(
        request["operation"].as_str(),
        Some("register" | "apply" | "begin_run" | "request_recover_pending")
    ) {
        return Ok(None);
    }
    if !recovery_context && request["lock_wait_ms"].as_u64() == Some(0) {
        request
            .as_object_mut()
            .map(|object| object.remove("coordination"));
        return Ok(None);
    }
    if request.get("coordination").is_some() {
        return Ok(None);
    }
    static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let identity = format!("cli-{}-{timestamp}-{nonce}", std::process::id());
    let envelope =
        serde_json::json!({"session_id":identity,"request_id":identity,"wait_ms":600000});
    request["coordination"] = envelope.clone();
    // Snapshot recovery has no admitted producer request to acknowledge.
    Ok(if recovery_context {
        None
    } else {
        Some(envelope)
    })
}

/// Release only observed terminal evidence for a caller-owned automatic envelope.
/// Preserve the producer outcome and report identities when cleanup is uncertain.
pub fn finish_automatic_request(
    outcome: Result<Value, String>,
    envelope: Value,
    dispatch: impl Fn(Value) -> Result<Value, String>,
) -> Result<Value, String> {
    let cleanup = (|| {
        let status =
            dispatch(serde_json::json!({"operation":"request_status","coordination":envelope}))?;
        if status["status"] != "terminal" {
            return Err(format!("request remains {}", status["status"]));
        }
        dispatch(serde_json::json!({"operation":"request_ack","coordination":envelope}))?;
        Ok::<_, String>(())
    })();
    match cleanup {
        Ok(()) => outcome,
        Err(error) => {
            let pending = serde_json::json!({"cleanup_pending":true,"session_id":envelope["session_id"],
                "request_id":envelope["request_id"],"error":error});
            match outcome {
                Ok(mut value) => {
                    if let Some(object) = value.as_object_mut() {
                        object.insert("request_cleanup".into(), pending);
                        Ok(value)
                    } else {
                        Ok(serde_json::json!({"result":value,"request_cleanup":pending}))
                    }
                }
                Err(error) => Err(format!("{error}; request_cleanup={pending}")),
            }
        }
    }
}

fn lease_mode(args: &[OsString]) -> Result<(), String> {
    if args.len() != 8
        || args[0] != "--lease"
        || args[2] != "--operation"
        || args[4] != "--wait-ms"
        || args[6] != "--parent-pid"
    {
        return Err("usage: maintenance_owner --lease ABS_LOCK --operation BOUNDED --wait-ms 0..5000 --parent-pid PID".into());
    }
    let operation = args[3].to_str().ok_or("invalid operation encoding")?;
    let wait_ms = args[5]
        .to_str()
        .ok_or("invalid wait")?
        .parse::<u64>()
        .map_err(|_| "invalid wait")?;
    let parent_pid = args[7]
        .to_str()
        .ok_or("invalid parent PID")?
        .parse::<u32>()
        .map_err(|_| "invalid parent PID")?;
    crate::lease::run(&PathBuf::from(&args[1]), operation, wait_ms, parent_pid)
}

/// Wire contract shared by the release entry and standalone owner.
pub fn capabilities() -> Value {
    let os = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    serde_json::json!({
        "schema": 1,
        "protocol": "maintenance-owner-lease-v1",
        "request_transports": ["file", "stdin"],
        "request_file_policy": "outside-maintenance-state",
        "max_lock_wait_ms": 600000,
        "request_queue_v1": true,
        "max_queued_requests": 256,
        "max_session_queued_requests": 32,
        "preferences": true,
        "platform": {"os": os, "arch": arch},
        "operations": [
            "inventory", "register", "review", "apply", "begin_run", "run_status",
            "request_status", "request_cancel", "request_ack", "request_recover", "request_recover_pending", "recover_lock",
            "recover_reservation",
        ],
        "storage_formats": ["legacy"]
    })
}

fn execute(args: &[OsString]) -> Result<(), String> {
    if args.first().is_some_and(|arg| arg == "preferences") {
        let home = crate::preferences::home()?;
        let value = if args.len() == 2 && args[1] == "read" {
            crate::preferences::snapshot(&home)?
        } else if args.len() == 2 && args[1] == "write" {
            crate::preferences::write(&home, read_request(io::stdin().lock())?)?
        } else {
            return Err(
                "usage: maintenance_owner preferences read|write (write: JSON stdin)".into(),
            );
        };
        println!("{value}");
    } else if args.first().is_some_and(|arg| arg == "capabilities") {
        if args.len() != 1 {
            return Err("usage: maintenance_owner capabilities".into());
        }
        println!("{}", capabilities());
    } else if args.first().is_some_and(|arg| arg == "--lease") {
        lease_mode(args)?;
    } else {
        println!("{}", request_mode(args)?);
    }
    Ok(())
}

/// Run arguments excluding the executable and the release's maintenance prefix.
/// Results use stdout; errors preserve the owner's structured stderr contract.
pub fn run(args: impl IntoIterator<Item = OsString>) -> i32 {
    match execute(&args.into_iter().collect::<Vec<_>>()) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{}", crate::error_response(&error));
            1
        }
    }
}

/// Claim only an exact first `maintenance` argument, before app initialization.
pub fn run_if_requested(args: impl IntoIterator<Item = OsString>) -> Option<i32> {
    let mut args = args.into_iter();
    args.next();
    if args.next().is_some_and(|arg| arg == "maintenance") {
        Some(run(args))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(|value| OsString::from(*value)).collect()
    }

    // Caller refactors must preserve immediate mode and caller-owned identities.
    #[test]
    fn automatic_coordination_respects_explicit_controls() {
        let mut request = serde_json::json!({"operation":"apply"});
        let envelope = automatic_envelope(&mut request).unwrap().unwrap();
        assert_eq!(request["coordination"], envelope);
        assert_eq!(envelope["wait_ms"], 600000);
        assert!(automatic_envelope(&mut request).unwrap().is_none());
        request["lock_wait_ms"] = serde_json::json!(0);
        assert!(automatic_envelope(&mut request).unwrap().is_none());
        assert!(request.get("coordination").is_none());
        assert!(
            automatic_envelope(&mut serde_json::json!({"operation":"inventory"}))
                .unwrap()
                .is_none()
        );
        assert!(
            automatic_envelope(&mut serde_json::json!({"operation":"run_status"}))
                .unwrap()
                .is_none()
        );
        let mut pending = serde_json::json!({"operation":"request_recover_pending","queue_sha256":"absent","pending_sha256":"exact"});
        assert!(automatic_envelope(&mut pending).unwrap().is_none());
        assert!(pending["coordination"]["request_id"].as_str().is_some());
        assert_eq!(pending["queue_sha256"], "absent");
        assert_eq!(pending["pending_sha256"], "exact");
    }

    // Never acknowledge uncertain execution merely because dispatch returned.
    #[test]
    fn automatic_ack_preserves_outcomes_and_uncertainty() {
        let envelope = serde_json::json!({"session_id":"cli","request_id":"one"});
        let original = serde_json::json!({"run_id":"run-one","steps":[]});
        let calls = std::cell::Cell::new(0);
        let result = finish_automatic_request(Ok(original.clone()), envelope.clone(), |request| {
            calls.set(calls.get() + 1);
            match request["operation"].as_str().unwrap() {
                "request_status" => Ok(serde_json::json!({"status":"terminal"})),
                "request_ack" => Ok(serde_json::json!({"acknowledged":true})),
                _ => panic!("unexpected operation"),
            }
        })
        .unwrap();
        assert_eq!(result, original);
        assert_eq!(calls.get(), 2);
        let error = finish_automatic_request(
            Err("execution unknown".into()),
            envelope.clone(),
            |request| {
                assert_eq!(request["operation"], "request_status");
                Ok(serde_json::json!({"status":"unknown"}))
            },
        )
        .unwrap_err();
        assert!(error.contains("execution unknown"));
        assert!(error.contains("cleanup_pending"));
        let result = finish_automatic_request(Ok(original), envelope, |request| {
            if request["operation"] == "request_status" {
                Ok(serde_json::json!({"status":"terminal"}))
            } else {
                Err("ack denied".into())
            }
        })
        .unwrap();
        assert_eq!(result["run_id"], "run-one");
        assert_eq!(result["request_cleanup"]["request_id"], "one");
        assert_eq!(result["request_cleanup"]["cleanup_pending"], true);
    }

    // A later CLI transport refactor must not put disposable requests back in
    // protected state or give stdin a different dispatch/authorization path.
    #[test]
    fn request_transports_keep_disposable_files_outside_management_state() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        std::fs::write(root.join("project-maintenance.json"), r#"{"schema_version":1,"project_id":"cli-request","managed_roots":["generated"],"bundles":[]}"#).unwrap();
        let request = br#"{"operation":"inventory"}"#;
        let mut command = vec![
            OsString::from("--project-root"),
            root.clone().into_os_string(),
            OsString::from("--request"),
            OsString::from("-"),
        ];
        assert_eq!(
            request_mode_with_home(&command, &request[..], &root.join("settings")).unwrap()["project_id"],
            "cli-request"
        );
        let task_file = root.join("artifacts/tasks/request.json");
        std::fs::create_dir_all(task_file.parent().unwrap()).unwrap();
        std::fs::write(&task_file, request).unwrap();
        command[3] = task_file.into_os_string();
        assert_eq!(
            request_mode_with_home(&command, io::empty(), &root.join("settings")).unwrap()["project_id"],
            "cli-request"
        );
        let control_file = root.join("artifacts/maintenance/evidence/request.json");
        std::fs::create_dir_all(control_file.parent().unwrap()).unwrap();
        std::fs::write(&control_file, b"{malformed disposable request").unwrap();
        command[3] = control_file.clone().into_os_string();
        assert!(
            request_mode_with_home(&command, io::empty(), &root.join("settings"))
                .unwrap_err()
                .contains("disposable request file must be outside")
        );
        assert_eq!(
            std::fs::read(control_file).unwrap(),
            b"{malformed disposable request"
        );
    }

    #[test]
    fn request_transport_rejects_malformed_and_oversized_json() {
        assert!(read_request(&b"{} {}"[..]).is_err());
        assert!(read_request(io::empty()).is_err());
        assert_eq!(
            read_request(io::repeat(b' ')).unwrap_err(),
            "maintenance request exceeds 64 MiB"
        );
    }

    // Future CLI additions must not loosen the bounded interface or let a later
    // maintenance argument hijack the app's ordinary startup.
    #[test]
    fn command_boundaries() {
        assert_eq!(
            run_if_requested(args(&["azrael", "maintenance", "capabilities"])),
            Some(0)
        );
        assert!(execute(&args(&["capabilities", "extra"])).is_err());
        assert!(request_mode(&args(&[])).is_err());
        assert_eq!(
            request_mode(&args(&[
                "--project-root",
                "relative",
                "--request",
                "relative"
            ]))
            .unwrap_err(),
            "project and request paths must be absolute without traversal"
        );
        assert!(
            request_mode(&args(&[
                "--project-root",
                "relative",
                "--request",
                "relative",
                "extra"
            ]))
            .unwrap_err()
            .starts_with("usage:")
        );
        assert!(
            lease_mode(&args(&[
                "--lease",
                "relative",
                "--operation",
                "test",
                "--wait-ms",
                "0",
                "--parent-pid",
                "1",
                "extra"
            ]))
            .unwrap_err()
            .starts_with("usage:")
        );
        assert_eq!(
            run_if_requested(args(&["azrael", "--help", "maintenance"])),
            None
        );
        assert_eq!(
            run_if_requested(args(&["azrael", "maintenance-extra"])),
            None
        );
        assert_eq!(
            run_if_requested(args(&["azrael", "maintenance", "capabilities", "extra"])),
            Some(1)
        );
    }

    // Callers negotiate these strings; future owner refactors must preserve them.
    #[test]
    fn capability_contract() {
        let value = capabilities();
        assert_eq!(value["schema"], 1);
        assert_eq!(value["protocol"], "maintenance-owner-lease-v1");
        assert_eq!(
            value["request_transports"],
            serde_json::json!(["file", "stdin"])
        );
        assert_eq!(value["request_file_policy"], "outside-maintenance-state");
        assert_eq!(value["request_queue_v1"], true);
        assert_eq!(value["max_queued_requests"], 256);
        assert_eq!(value["max_session_queued_requests"], 32);
        assert_eq!(
            value["operations"],
            serde_json::json!([
                "inventory",
                "register",
                "review",
                "apply",
                "begin_run",
                "run_status",
                "request_status",
                "request_cancel",
                "request_ack",
                "request_recover",
                "request_recover_pending",
                "recover_lock",
                "recover_reservation",
            ])
        );
        assert_eq!(value["storage_formats"], serde_json::json!(["legacy"]));
        #[cfg(target_os = "windows")]
        assert_eq!(value["platform"]["os"], "win32");
        #[cfg(target_os = "linux")]
        assert_eq!(value["platform"]["os"], "linux");
        #[cfg(target_os = "macos")]
        assert_eq!(value["platform"]["os"], "darwin");
        #[cfg(target_arch = "x86_64")]
        assert_eq!(value["platform"]["arch"], "x64");
        #[cfg(target_arch = "aarch64")]
        assert_eq!(value["platform"]["arch"], "arm64");
    }
}
