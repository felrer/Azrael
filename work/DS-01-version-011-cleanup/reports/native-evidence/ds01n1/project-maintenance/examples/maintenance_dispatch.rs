//! Development-only fixture adapter. This is not a distributed product runner.
use azrael_project_maintenance::{AccessMode, dispatch};
use std::path::{Path, PathBuf};

fn main() -> Result<(), String> {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err("usage: maintenance_dispatch FIXTURE_ROOT REQUEST_JSON_FILE".into());
    }
    let supplied = PathBuf::from(&args[0]);
    if !supplied.is_absolute() {
        return Err("fixture root must be absolute".into());
    }
    let root = dunce::canonicalize(&supplied).map_err(|e| e.to_string())?;
    let request_path = dunce::canonicalize(PathBuf::from(&args[1])).map_err(|e| e.to_string())?;
    if !request_path.starts_with(&root) {
        return Err("request must be inside selected fixture root".into());
    }
    let request = serde_json::from_slice(&std::fs::read(request_path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let authorize = |path: &Path, mode| {
        if path.starts_with(&root) || (mode == AccessMode::Read && root.starts_with(path)) {
            Ok(())
        } else {
            Err(format!("fixture access denied: {}", path.display()))
        }
    };
    let response = dispatch(&supplied, request, &authorize)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&response).map_err(|e| e.to_string())?
    );
    Ok(())
}
