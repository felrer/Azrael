//! Manually invoked owner runner. OS permissions remain authoritative.
use azrael_project_maintenance::{AccessMode, dispatch};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

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

fn run() -> Result<Value, String> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 4 || args[0] != "--project-root" || args[2] != "--request" {
        return Err(
            "usage: maintenance_owner --project-root ABSOLUTE_ROOT --request ABSOLUTE_IN_ROOT_JSON"
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
    // Check lexical containment before observing a caller-selected request file.
    if !request_path.is_absolute() || !request_path.starts_with(&root) {
        return Err("request file must be absolute and within selected project".into());
    }
    absolute_plain(&request_path)?;
    if !request_path.is_file() {
        return Err("request must be a JSON file".into());
    }
    let request: Value =
        serde_json::from_slice(&std::fs::read(&request_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if !matches!(
        request["operation"].as_str(),
        Some(
            "inventory" | "register" | "review" | "apply" | "recover_lock" | "recover_reservation"
        )
    ) {
        return Err(
            "owner runner supports only inventory/register/review/apply/recover_lock".into(),
        );
    }
    dispatch(&root, request, &|path, access| {
        if path.starts_with(&root) || (access == AccessMode::Read && root.starts_with(path)) {
            Ok(())
        } else {
            Err(format!(
                "outside selected project permission boundary: {}",
                path.display()
            ))
        }
    })
}

fn lease_mode() -> Result<(), String> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
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
    azrael_project_maintenance::lease::run(&PathBuf::from(&args[1]), operation, wait_ms, parent_pid)
}

fn main() {
    if std::env::args_os()
        .nth(1)
        .is_some_and(|arg| arg == "--lease")
    {
        if let Err(error) = lease_mode() {
            eprintln!("{}", serde_json::json!({"error":error}));
            std::process::exit(1);
        }
        return;
    }
    match run() {
        Ok(result) => println!("{}", result),
        Err(error) => {
            eprintln!("{}", serde_json::json!({"error":error}));
            std::process::exit(1);
        }
    }
}
