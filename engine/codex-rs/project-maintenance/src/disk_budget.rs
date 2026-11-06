//! Cross-project physical deletion admission within one selected settings home.
//!
//! Until a mapping proves independent backing storage, every target shares the
//! host budget. In particular, a VHD volume's disk number is not evidence of an
//! independent physical disk. This conservative backend never probes target data.
use crate::{lock_recovery, preferences};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::Path;
use std::time::Duration;

const SLOT_COUNT: u8 = 2;

/// An OS handle owns the slot; process exit also closes it. Slot release says
/// nothing about the terminal outcome of a durable deletion reservation.
pub(crate) struct Guard {
    _slot: File,
    _activity: preferences::Admission,
}

impl Guard {
    pub(crate) fn release(self) {
        drop(self);
    }
}

fn budget_key(_target: &Path) -> &'static str {
    "host-shared"
}

fn open_slot(path: &Path) -> Result<File, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => lock_recovery::final_plain_path(path)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|error| error.to_string())?;
    verify_slot(path, &file)?;
    Ok(file)
}

fn verify_slot(path: &Path, file: &File) -> Result<(), String> {
    lock_recovery::final_plain_path(path)?;
    let current = File::open(path).map_err(|error| error.to_string())?;
    if lock_recovery::identity(file)? != lock_recovery::identity(&current)? {
        return Err("maintenance disk budget slot identity changed".into());
    }
    Ok(())
}

pub(crate) fn acquire(
    home: &Path,
    target: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<Guard, String> {
    acquire_impl(home, target, cancelled, true)?
        .ok_or_else(|| "maintenance disk budget wait ended without a slot".into())
}

pub(crate) fn try_acquire(
    home: &Path,
    target: &Path,
    cancelled: &dyn Fn() -> bool,
) -> Result<Option<Guard>, String> {
    acquire_impl(home, target, cancelled, false)
}

fn acquire_impl(
    home: &Path,
    target: &Path,
    cancelled: &dyn Fn() -> bool,
    wait: bool,
) -> Result<Option<Guard>, String> {
    if cancelled() {
        return Err("maintenance disk budget wait cancelled".into());
    }
    // Admission freezes capacity throughout waiting and physical I/O, including
    // callers that do not already own an outer operation admission.
    let activity = preferences::enter(home, "apply")?;
    let capacity = preferences::read(home)?.deletion_parallelism;
    let directory = home.join("maintenance-coordination").join("disks");
    preferences::checked_home(&directory, true)?;
    let key = budget_key(target);
    let mut slots = (0..SLOT_COUNT)
        .map(|index| {
            let path = directory.join(format!("{key}.{index}.lock"));
            open_slot(&path).map(|file| (path, file))
        })
        .collect::<Result<Vec<_>, _>>()?;
    loop {
        if cancelled() {
            return Err("maintenance disk budget wait cancelled".into());
        }
        for index in 0..usize::from(capacity) {
            let (path, file) = &slots[index];
            match file.try_lock() {
                Ok(()) => {
                    verify_slot(path, file)?;
                    if cancelled() {
                        return Err("maintenance disk budget wait cancelled".into());
                    }
                    // Move the locked handle, never clone it: Unix file locks
                    // can otherwise share an open-file-description owner.
                    let (_, slot) = slots.swap_remove(index);
                    return Ok(Some(Guard {
                        _slot: slot,
                        _activity: activity,
                    }));
                }
                Err(TryLockError::WouldBlock) => {}
                Err(TryLockError::Error(error)) => return Err(error.to_string()),
            }
        }
        if cancelled() {
            return Err("maintenance disk budget wait cancelled".into());
        }
        if !wait {
            return Ok(None);
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn nonwaiting_acquisition_reports_occupancy_release_and_cancellation() {
        let fixture = tempfile::tempdir().unwrap();
        let home = fixture.path();
        let target = Path::new("project");
        let first = try_acquire(home, target, &|| false).unwrap().unwrap();
        let attempts = AtomicUsize::new(0);
        let occupied = try_acquire(home, target, &|| {
            // A busy-waiting regression must terminate instead of hanging the
            // suite, and returning Err then fails the expected None assertion.
            attempts.fetch_add(1, Ordering::Relaxed) >= 8
        })
        .unwrap();
        assert!(occupied.is_none());
        assert!(try_acquire(home, target, &|| true).is_err());
        first.release();
        let _replacement = try_acquire(home, target, &|| false).unwrap().unwrap();
    }

    // Retain this boundary check: later slot-accounting edits could bypass the
    // default capacity or accidentally partition unknown targets by project.
    #[test]
    fn default_capacity_waits_cancels_and_releases_across_targets() {
        let fixture = tempfile::tempdir().unwrap();
        let home = fixture.path();
        let first = acquire(home, Path::new("project-a"), &|| false).unwrap();
        let attempts = AtomicUsize::new(0);
        let error = acquire(home, Path::new("project-b"), &|| {
            attempts.fetch_add(1, Ordering::Relaxed) >= 4
        })
        .err()
        .unwrap();
        assert!(error.contains("cancelled"));
        first.release();
        let _next = acquire(home, Path::new("project-b"), &|| false).unwrap();
        assert_eq!(
            budget_key(Path::new("unknown-a")),
            budget_key(Path::new("unknown-b"))
        );
    }

    #[test]
    fn two_slots_block_third_and_capacity_transition_while_held() {
        let fixture = tempfile::tempdir().unwrap();
        let home = fixture.path();
        let update = |revision, capacity| json!({"expected_revision":revision,"groups":true,"locks":true,"deletion":true,"deletion_parallelism":capacity});
        preferences::write(home, update(0, 2)).unwrap();
        let first = acquire(home, Path::new("a"), &|| false).unwrap();
        let second = acquire(home, Path::new("b"), &|| false).unwrap();
        let attempts = AtomicUsize::new(0);
        assert!(
            acquire(home, Path::new("c"), &|| {
                attempts.fetch_add(1, Ordering::Relaxed) >= 4
            })
            .err()
            .unwrap()
            .contains("cancelled")
        );
        assert!(preferences::write(home, update(1, 1)).is_err());
        first.release();
        let replacement = acquire(home, Path::new("c"), &|| false).unwrap();
        drop((second, replacement));
        preferences::write(home, update(1, 1)).unwrap();
        assert_eq!(preferences::read(home).unwrap().deletion_parallelism, 1);
    }
}
