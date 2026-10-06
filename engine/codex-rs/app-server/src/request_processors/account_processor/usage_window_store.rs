//! Durable account-scoped reservations. The OS lock covers each complete execution step.
use codex_app_server_protocol::AzraelUsageWindowSchedule;
use codex_app_server_protocol::AzraelUsageWindowStatus;
use codex_app_server_protocol::GetAccountRateLimitsResponse;
use codex_login::AzraelProfileInfo;
use codex_protocol::account::PlanType;
use serde::Deserialize;
use serde::Serialize;
use sha2::Digest;
use sha2::Sha256;
use std::fs::File;
use std::fs::OpenOptions;
use std::io;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;

pub(super) const GRACE_SECONDS: i64 = 45;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Observation {
    pub(super) observed_at: i64,
    pub(super) windows: Vec<Window>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Window {
    slot: usize,
    duration: i64,
    pub(super) reset: Option<i64>,
    used: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Record {
    // Old records have no provenance: their saved enabled value is authoritative.
    #[serde(default)]
    choice: Choice,
    pub(super) schedule: AzraelUsageWindowSchedule,
    pub(super) observation: Observation,
    pub(super) processed: Vec<i64>,
    pub(super) attempt_until: [i64; 2],
    pub(super) checks: u32,
    pub(super) suspected_slots: Vec<usize>,
    pub(super) failures: u32,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum Choice {
    DefaultPolicy,
    #[default]
    Explicit,
}

pub(super) struct Store {
    path: PathBuf,
    // Dropping the handle releases the OS lock, including on process exit.
    _lock: File,
}

impl Store {
    pub(super) fn status(root: &Path, profile: &AzraelProfileInfo) -> io::Result<Record> {
        let snapshot = Self::snapshot(root, profile)?;
        if let Some(record) = &snapshot
            && !record.needs_default(profile)
        {
            return Ok(record.clone());
        }
        let store = match Self::open(root, profile) {
            Ok(store) => store,
            // A running step owns the lock; keep reporting its committed snapshot.
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                return Ok(snapshot.unwrap_or_else(|| Record::pending(profile)));
            }
            Err(error) => return Err(error),
        };
        // Re-read under the lock so another window's manual choice always wins.
        let mut record = store
            .load(profile)?
            .unwrap_or_else(|| Record::pending(profile));
        record.initialize_default(profile);
        store.save(&record)?;
        Ok(record)
    }

    pub(super) fn snapshot(root: &Path, profile: &AzraelProfileInfo) -> io::Result<Option<Record>> {
        // Atomic replacement makes an unlocked status read safe during a network step.
        let identity = serde_json::to_vec(&(&profile.workspace_account_id, &profile.user_id))?;
        let key = format!("{:x}", Sha256::digest(identity));
        Self::read_record(
            &root
                .join("azrael")
                .join("usage-windows")
                .join(format!("{key}.json")),
            profile,
        )
    }
    pub(super) fn open(root: &Path, profile: &AzraelProfileInfo) -> io::Result<Self> {
        let directory = root.join("azrael").join("usage-windows");
        std::fs::create_dir_all(&directory)?;
        let identity = serde_json::to_vec(&(&profile.workspace_account_id, &profile.user_id))?;
        let key = format!("{:x}", Sha256::digest(identity));
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join(format!("{key}.lock")))?;
        lock.try_lock().map_err(|error| match error {
            std::fs::TryLockError::WouldBlock => io::Error::from(io::ErrorKind::WouldBlock),
            std::fs::TryLockError::Error(error) => error,
        })?;
        Ok(Self {
            path: directory.join(format!("{key}.json")),
            _lock: lock,
        })
    }

    pub(super) fn load(&self, profile: &AzraelProfileInfo) -> io::Result<Option<Record>> {
        Self::read_record(&self.path, profile)
    }

    fn read_record(path: &Path, profile: &AzraelProfileInfo) -> io::Result<Option<Record>> {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let mut record: Record = serde_json::from_slice(&bytes)?;
        if record.schedule.workspace_account_id != profile.workspace_account_id
            || record.schedule.user_id != profile.user_id
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "reservation identity mismatch",
            ));
        }
        if record.observation.windows.len() > 2
            || record
                .observation
                .windows
                .iter()
                .any(|window| window.slot > 1 || ![300, 10080].contains(&window.duration))
            || record.suspected_slots.iter().any(|slot| *slot > 1)
            || record.processed.len() > 32
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid reservation window",
            ));
        }
        // A surviving alias can own the same account reservation after a profile is removed.
        record.schedule.profile_id.clone_from(&profile.id);
        Ok(Some(record))
    }

    pub(super) fn save(&self, record: &Record) -> io::Result<()> {
        let parent = self.path.parent().ok_or(io::ErrorKind::InvalidInput)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        serde_json::to_writer(&mut temporary, record)?;
        temporary.flush()?;
        temporary.as_file().sync_all()?;
        temporary.persist(&self.path).map_err(|error| error.error)?;
        Ok(())
    }
}

impl Record {
    pub(super) fn new(profile: &AzraelProfileInfo) -> Self {
        let mut record = Self::pending(profile);
        record.initialize_default(profile);
        record
    }

    fn pending(profile: &AzraelProfileInfo) -> Self {
        Self {
            choice: Choice::DefaultPolicy,
            schedule: AzraelUsageWindowSchedule {
                profile_id: profile.id.clone(),
                workspace_account_id: profile.workspace_account_id.clone(),
                user_id: profile.user_id.clone(),
                enabled: false,
                next_run_at: None,
                basis_reset_at: None,
                last_attempt_at: None,
                status: AzraelUsageWindowStatus::Disabled,
                error: None,
            },
            observation: Observation::default(),
            processed: Vec::new(),
            attempt_until: [0; 2],
            checks: 0,
            suspected_slots: Vec::new(),
            failures: 0,
        }
    }

    fn needs_default(&self, profile: &AzraelProfileInfo) -> bool {
        self.choice == Choice::DefaultPolicy
            && !self.schedule.enabled
            && Self::confirmed_paid(profile)
    }

    pub(super) fn confirmed_paid(profile: &AzraelProfileInfo) -> bool {
        profile.plan_type.as_ref().is_some_and(|plan| {
            let plan: PlanType = serde_json::from_value(serde_json::Value::String(plan.clone()))
                .unwrap_or(PlanType::Unknown);
            !matches!(plan, PlanType::Free | PlanType::Unknown)
        })
    }

    fn initialize_default(&mut self, profile: &AzraelProfileInfo) {
        if self.needs_default(profile) {
            self.change_enabled(true);
        }
    }

    pub(super) fn set_enabled(&mut self, enabled: bool) {
        // Even a no-op OFF is an explicit choice and must survive later plan discovery.
        self.choice = Choice::Explicit;
        self.change_enabled(enabled);
    }

    fn change_enabled(&mut self, enabled: bool) {
        if self.schedule.enabled == enabled {
            return;
        }
        self.schedule.enabled = enabled;
        self.schedule.error = None;
        self.failures = 0;
        self.schedule.next_run_at = None;
        if enabled {
            self.schedule.status = AzraelUsageWindowStatus::Scheduled;
            self.reserve(self.observation.clone());
            if self.schedule.next_run_at.is_none() {
                self.schedule.next_run_at = Some(chrono::Utc::now().timestamp());
            }
        } else {
            self.schedule.status = AzraelUsageWindowStatus::Disabled;
        }
    }

    pub(super) fn capture(data: &GetAccountRateLimitsResponse, now: i64) -> Observation {
        let windows = [&data.rate_limits.primary, &data.rate_limits.secondary]
            .into_iter()
            .enumerate()
            .filter_map(|(slot, window)| {
                let window = window.as_ref()?;
                let duration = window.window_duration_mins?;
                // Only authoritative five-hour and weekly ordinary windows are supported.
                if ![300, 10080].contains(&duration) {
                    return None;
                }
                Some(Window {
                    slot,
                    duration,
                    reset: window.resets_at,
                    used: window.used_percent,
                })
            })
            .collect();
        Observation {
            observed_at: now,
            windows,
        }
    }

    pub(super) fn dormant(&self, observation: &Observation) -> Vec<usize> {
        observation
            .windows
            .iter()
            .filter(|window| {
                if window.used != 0 || self.attempt_until[window.slot] > observation.observed_at {
                    return false;
                }
                if window
                    .reset
                    .is_none_or(|reset| reset <= observation.observed_at)
                {
                    return true;
                }
                // A full-duration reset that slides with observation time is only a suspicion.
                let prior = self
                    .observation
                    .windows
                    .iter()
                    .find(|prior| prior.slot == window.slot);
                match (prior.and_then(|prior| prior.reset), window.reset) {
                    (Some(before), Some(after)) => {
                        let elapsed = observation.observed_at - self.observation.observed_at;
                        elapsed >= 10
                            && after - before >= 10
                            && ((after - before) - elapsed).abs() <= 10
                            && (after - observation.observed_at - window.duration * 60).abs() <= 60
                    }
                    _ => false,
                }
            })
            .map(|window| window.slot)
            .collect()
    }

    pub(super) fn confirm_started(&self, observation: &Observation) -> bool {
        // A rounded 0% is valid; a stable future absolute reset is the confirmation.
        !observation.windows.is_empty()
            && observation.windows.iter().all(|window| {
                window
                    .reset
                    .is_some_and(|reset| reset > observation.observed_at)
                    && (window.used > 0
                        || self.observation.windows.iter().any(|prior| {
                            prior.slot == window.slot
                                && prior.reset == window.reset
                                && observation.observed_at - self.observation.observed_at >= 10
                        }))
            })
    }

    pub(super) fn reserve(&mut self, observation: Observation) {
        if observation.observed_at < self.observation.observed_at
            || matches!(
                self.schedule.status,
                AzraelUsageWindowStatus::Checking | AzraelUsageWindowStatus::Confirming
            )
        {
            return;
        }
        let candidate = observation
            .windows
            .iter()
            .filter_map(|window| window.reset)
            .filter(|reset| !self.processed.contains(reset))
            .min();
        // Ordinary refresh never re-arms a timer. Only a verified new cycle can replace it.
        let can_replace = self.schedule.next_run_at.is_none()
            || (self
                .schedule
                .basis_reset_at
                .is_some_and(|basis| basis <= observation.observed_at)
                && candidate.is_some_and(|reset| reset > observation.observed_at)
                && self.dormant(&observation).is_empty());
        if self.schedule.enabled && can_replace {
            self.schedule.basis_reset_at = candidate;
            self.schedule.next_run_at =
                candidate.map(|reset| (reset + GRACE_SECONDS).max(observation.observed_at));
            if self.schedule.next_run_at.is_some() {
                self.schedule.status = AzraelUsageWindowStatus::Scheduled;
            }
        }
        self.observation = observation;
    }

    pub(super) fn finish_cycle(&mut self, observation: Observation) {
        if let Some(basis) = self.schedule.basis_reset_at
            && !self.processed.contains(&basis)
        {
            self.processed.push(basis);
            if self.processed.len() > 32 {
                self.processed.remove(0);
            }
        }
        self.schedule.next_run_at = None;
        self.schedule.basis_reset_at = None;
        self.checks = 0;
        self.suspected_slots.clear();
        self.reserve(observation);
    }

    pub(super) fn record_attempt(&mut self, observation: &Observation, slots: &[usize]) {
        for window in &observation.windows {
            if slots.contains(&window.slot) {
                self.attempt_until[window.slot] = observation.observed_at + window.duration * 60;
            }
        }
        self.schedule.last_attempt_at = Some(observation.observed_at);
        self.schedule.status = AzraelUsageWindowStatus::Confirming;
        self.schedule.next_run_at = Some(observation.observed_at + 15);
        self.checks = 0;
        self.observation = observation.clone();
    }
}

#[cfg(test)]
#[path = "usage_window_store_tests.rs"]
mod tests;
