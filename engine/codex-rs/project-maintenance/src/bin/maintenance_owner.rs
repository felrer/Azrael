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
    if !matches!(request["operation"].as_str(), Some("review" | "apply"))
        || request.get("retire_managed_roots").is_none()
    {
        return Err(
            "owner runner supports only explicit managed-root retirement review/apply".into(),
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

fn main() {
    match run() {
        Ok(result) => println!("{}", result),
        Err(error) => {
            eprintln!("{}", serde_json::json!({"error":error}));
            std::process::exit(1);
        }
    }
}
