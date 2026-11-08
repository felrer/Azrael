//! Explicit approval of a directory object and its contents at execution time.
//! This does not turn an ordinary user directory into a generated artifact.
use crate::{AccessMode, Auth, Config, hash, paths, string};
use serde_json::{Value, json};
use std::path::{Component, Path, PathBuf};

pub(super) type Authorize<'a> = dyn Fn(&Path, AccessMode) -> Result<(), String> + 'a;

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[derive(Default)]
pub(super) struct Stats {
    pub files: u64,
    pub directories: u64,
    pub links: u64,
}

pub(crate) fn selected(item: &Value) -> bool {
    item["deletion_scope"] == "entire_directory"
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path.to_str().is_none()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
    {
        return Err("whole-directory approval requires a normalized UTF-8 absolute path".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(),Some(Component::Prefix(prefix)) if matches!(prefix.kind(),std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("whole-directory approval supports local drive paths only".into());
    }
    if !path
        .components()
        .any(|part| matches!(part, Component::Normal(_)))
    {
        return Err("whole-directory approval cannot select a filesystem root".into());
    }
    Ok(path.to_path_buf())
}

pub(crate) fn resolve_item(root: &Path, item: &Value) -> Result<PathBuf, String> {
    let path = Path::new(string(item, "path")?);
    if selected(item) && path.is_absolute() && !paths::within(path, root) {
        absolute(path)
    } else {
        paths::resolve(root, path)
    }
}

pub(crate) fn configure(root: &Path, item: &Value, auth: Auth<'_>) -> Result<(), String> {
    if selected(item) {
        validate_scope(item)?;
        let path = resolve_item(root, item)?;
        auth.directory_roots.borrow_mut().insert(path);
    }
    Ok(())
}

/// Serialized reservation members have no public authority of their own. Only
/// a root explicitly selected by the current registered/requested item may widen
/// this target lookup; evidence and ordinary exact-tree paths stay project-local.
pub(crate) fn resolve_scoped(root: &Path, path: &Path, auth: Auth<'_>) -> Result<PathBuf, String> {
    if path.is_absolute()
        && !paths::within(path, root)
        && auth
            .directory_roots
            .borrow()
            .iter()
            .any(|scope| paths::within(path, scope))
    {
        absolute(path)
    } else {
        paths::resolve(root, path)
    }
}

pub(crate) fn reserved(root: &Path, path: &Path) -> bool {
    if paths::within(path, root) {
        return paths::reserved(root, path);
    }
    if paths::within(root, path) {
        return true;
    }
    let names = path
        .components()
        .filter_map(|part| match part {
            Component::Normal(name) => Some(name.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect::<Vec<_>>();
    names
        .iter()
        .any(|name| [".git", ".azrael-ex", ".codex", ".ssh", ".config"].contains(&name.as_str()))
        || names
            .windows(2)
            .any(|pair| pair[0] == "artifacts" && pair[1] == "maintenance")
        || names
            .last()
            .is_some_and(|name| name == "project-maintenance.json")
}

pub(crate) fn validate_scope(item: &Value) -> Result<(), String> {
    if item.get("deletion_scope").is_some() && !selected(item) {
        return Err("deletion_scope must be entire_directory when specified".into());
    }
    if selected(item)
        && ["verified_junctions", "verified_file_symlinks"]
            .iter()
            .any(|field| item.get(field).is_some())
    {
        return Err("whole-directory approval does not accept exact-tree link declarations".into());
    }
    Ok(())
}

pub(crate) fn observe(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Value, String> {
    let observation = paths::registered_observation(root, path, auth)?;
    if observation["presence"] == "present" && observation["kind"] != "directory" {
        return Err("whole-directory approval requires a physical directory".into());
    }
    Ok(observation)
}

pub(crate) fn measure(observation: &Value) -> Result<Value, String> {
    Ok(json!({"identity":hash(observation)?,"logical_bytes":0,
        "payload_bytes_measured":false,"measurement":"directory_identity_only",
        "presence":observation["presence"],
        "remaining":match observation["presence"].as_str() {
            Some("present")=>Some(true),Some("absent")=>Some(false),_=>None},
        "error":observation["error"]}))
}

pub(crate) fn delete(
    root: &Path,
    config: &Config,
    path: &Path,
    item: &Value,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let mut stats = Stats::default();
    let authorize = |entry: &Path, mode: AccessMode| {
        if paths::within(entry, path)
            && (reserved(root, entry)
                || config.protected_paths.iter().any(|protected| {
                    let protected = root.join(protected);
                    paths::within(entry, &protected) || paths::within(&protected, entry)
                }))
        {
            return Err("whole-directory traversal reached a protected path".into());
        }
        auth(entry, mode)
    };
    let expected = &item["directory_observation"]["identity"];
    #[cfg(windows)]
    let result = windows::delete(path, expected, &authorize, &|| auth.cancelled(), &mut stats);
    #[cfg(unix)]
    let result = unix::delete(path, expected, &authorize, &|| auth.cancelled(), &mut stats);
    #[cfg(not(any(windows, unix)))]
    let result: Result<(), String> =
        Err("whole-directory deletion is unsupported on this platform".into());
    // A failed attempt can already have removed entries. Keep its actual error,
    // progress and final presence instead of turning it into an unknown success.
    let presence =
        auth(path, AccessMode::Read).and_then(|()| match std::fs::symlink_metadata(path) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.to_string()),
        });
    let remaining = presence.as_ref().ok().copied();
    let observation_error = presence.err();
    let error = result
        .err()
        .or_else(|| observation_error.clone())
        .or_else(|| {
            (remaining != Some(false)).then(|| "directory remains after deletion".to_owned())
        });
    Ok(
        json!({"status":if error.is_none(){"deleted"}else if auth.cancelled(){"cancelled"}else{"failed"},
        "remaining":remaining,"error":error,"observation_error":observation_error,"attributes":[],
        "deletion_scope":"entire_directory","physical_bytes_reclaimed":null,
        "removed_entries":stats.files+stats.directories+stats.links,
        "removed_files":stats.files,"removed_directories":stats.directories,"removed_links":stats.links}),
    )
}
