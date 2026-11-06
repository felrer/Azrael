//! Durable, project-local admission. Custody loss never authorizes replay.
use crate::{AccessMode, Auth, lock_recovery, lock_wait, paths};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_RECORDS: usize = 4096;
const UNKNOWN_PREFIX: &str = "maintenance_execution_unknown:";

/// The callback ended without proving that its external producer tree stopped.
pub(crate) fn unknown(reason: &str) -> String {
    format!("{UNKNOWN_PREFIX}{reason}")
}

fn unknown_result(result: &Result<Value, String>) -> bool {
    matches!(result, Err(error) if error.starts_with(UNKNOWN_PREFIX))
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Scope {
    pub(crate) path: PathBuf,
    pub(crate) exclusive: bool,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Queue {
    generation: u64,
    executions: Vec<Execution>,
    #[serde(skip)]
    changed: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Execution {
    id: String,
    project: String,
    fingerprint: String,
    scopes: Vec<Scope>,
    state: String,
    subscribers: Vec<Subscriber>,
    result: Option<Result<Value, String>>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Subscriber {
    session: String,
    request: String,
    deadline: u64,
    cancelled: bool,
    expired: bool,
    acknowledged: bool,
}

struct Key<'a> {
    session: &'a str,
    request: &'a str,
    wait: u64,
}

fn project(root: &Path, request: &Value) -> Result<String, String> {
    let path = match request.get("_coordination_project") {
        Some(value) => Path::new(
            value
                .as_str()
                .ok_or("_coordination_project must be an absolute canonical path string")?,
        ),
        None => root,
    };
    validate_scope(&Scope {
        path: path.to_owned(),
        exclusive: false,
    })?;
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "coordination project requires a Unicode path".into())
}

fn key(request: &Value) -> Result<Key<'_>, String> {
    let envelope = request
        .get("coordination")
        .ok_or("coordination envelope required")?;
    let id = |name| -> Result<&str, String> {
        envelope
            .get(name)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
            .ok_or_else(|| format!("coordination.{name} must be a nonempty bounded identifier"))
    };
    let wait = match envelope.get("wait_ms") {
        None => 600_000,
        Some(v) => v
            .as_u64()
            .filter(|v| *v <= 600_000)
            .ok_or("coordination.wait_ms must be in 0..600000")?,
    };
    Ok(Key {
        session: id("session_id")?,
        request: id("request_id")?,
        wait,
    })
}

fn directory(root: &Path, auth: Auth<'_>) -> Result<PathBuf, String> {
    let mut path = root.to_owned();
    for part in ["artifacts", "maintenance", "requests"] {
        path.push(part);
        paths::check(root, &path, auth)?;
        auth(&path, AccessMode::Write)?;
        match fs::create_dir(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.to_string()),
        }
        lock_recovery::final_plain_path(&path)?;
        if !fs::metadata(&path).map_err(|e| e.to_string())?.is_dir() {
            return Err("queue directory is not a directory".into());
        }
    }
    Ok(path)
}

fn checked_file(root: &Path, path: &Path, auth: Auth<'_>) -> Result<File, String> {
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Read)?;
    lock_recovery::final_plain_path(path)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    let identity = lock_recovery::identity(&file)?;
    if identity != lock_recovery::identity(&File::open(path).map_err(|e| e.to_string())?)? {
        return Err("queue file identity changed".into());
    }
    Ok(file)
}

fn load(root: &Path, dir: &Path, auth: Auth<'_>) -> Result<Queue, String> {
    if paths::checked_metadata(root, &dir.join("recovery.pending"), auth)?.is_some() {
        return Err("queue recovery intent requires request_recover_pending reconciliation".into());
    }
    let pending = dir.join("queue.pending");
    if paths::checked_metadata(root, &pending, auth)?.is_some() {
        return Err(
            "queue pending snapshot requires explicit recovery; execution outcome may be unknown"
                .into(),
        );
    }
    let path = dir.join("queue.json");
    if paths::checked_metadata(root, &path, auth)?.is_none() {
        return Ok(Queue::default());
    }
    let file = checked_file(root, &path, auth)?;
    let identity = lock_recovery::identity(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("queue snapshot exceeds size bound".into());
    }
    if identity != lock_recovery::identity(&checked_file(root, &path, auth)?)? {
        return Err("queue snapshot replaced during read".into());
    }
    let mut queue: Queue =
        serde_json::from_slice(&bytes).map_err(|e| format!("invalid queue snapshot: {e}"))?;
    validate(&queue)?;
    // An unlocked running fence is evidence of uncertainty, never permission to execute.
    for execution in &mut queue.executions {
        if execution.state == "running" {
            let custody_path = dir.join(format!("{}.lock", execution.id));
            if paths::checked_metadata(root, &custody_path, auth)?.is_none() {
                execution.state = "unknown".into();
                queue.changed = true;
                continue;
            }
            let custody = checked_file(root, &custody_path, auth)?;
            match custody.try_lock_shared() {
                Ok(()) => {
                    custody.unlock().map_err(|e| e.to_string())?;
                    execution.state = "unknown".into();
                    queue.changed = true;
                }
                Err(std::fs::TryLockError::WouldBlock) => {}
                Err(std::fs::TryLockError::Error(e)) => return Err(e.to_string()),
            }
        }
    }
    Ok(queue)
}

fn validate(queue: &Queue) -> Result<(), String> {
    if queue.executions.len() > MAX_RECORDS {
        return Err("queue execution bound exceeded".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut keys = std::collections::BTreeSet::new();
    for e in &queue.executions {
        validate_scope(&Scope {
            path: PathBuf::from(&e.project),
            exclusive: false,
        })?;
        if e.id.is_empty()
            || e.id.len() > 128
            || !e.id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
            || !ids.insert(&e.id)
            || e.subscribers.is_empty()
            || !matches!(
                e.state.as_str(),
                "waiting" | "running" | "terminal" | "unknown"
            )
            || match e.state.as_str() {
                "terminal" => e.result.is_none(),
                "unknown" => e
                    .result
                    .as_ref()
                    .is_some_and(|result| !unknown_result(result)),
                _ => e.result.is_some(),
            }
        {
            return Err("invalid durable execution record".into());
        }
        for scope in &e.scopes {
            validate_scope(scope)?;
        }
        for s in &e.subscribers {
            if s.session.is_empty()
                || s.session.len() > 128
                || s.request.is_empty()
                || s.request.len() > 128
                || !keys.insert((&s.session, &s.request))
                || keys.len() > MAX_RECORDS
            {
                return Err("invalid durable subscriber record".into());
            }
        }
    }
    Ok(())
}

fn save(root: &Path, dir: &Path, queue: &mut Queue, auth: Auth<'_>) -> Result<(), String> {
    validate(queue)?;
    queue.generation = queue
        .generation
        .checked_add(1)
        .ok_or("queue generation exhausted")?;
    queue.changed = false;
    let bytes = serde_json::to_vec(queue).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("queue snapshot exceeds size bound; result not committed".into());
    }
    let pending = dir.join("queue.pending");
    let target = dir.join("queue.json");
    for path in [&pending, &target] {
        paths::check(root, path, auth)?;
        auth(path, AccessMode::Write)?;
    }
    let prior = if paths::checked_metadata(root, &target, auth)?.is_some() {
        Some(lock_recovery::identity(&checked_file(
            root, &target, auth,
        )?)?)
    } else {
        None
    };
    let mut file = OpenOptions::new()
        .write(true)
        .read(true)
        .create_new(true)
        .open(&pending)
        .map_err(|e| {
            format!("queue pending creation failed; explicit recovery may be required: {e}")
        })?;
    let identity = lock_recovery::identity(&file)?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("queue pending write failed; pending snapshot retained: {e}"))?;
    if identity != lock_recovery::identity(&checked_file(root, &pending, auth)?)? {
        return Err("queue pending identity changed; snapshot retained".into());
    }
    let current = if paths::checked_metadata(root, &target, auth)?.is_some() {
        Some(lock_recovery::identity(&checked_file(
            root, &target, auth,
        )?)?)
    } else {
        None
    };
    if current != prior {
        return Err("queue target changed; pending snapshot retained".into());
    }
    drop(file);
    fs::rename(&pending, &target)
        .map_err(|e| format!("queue publish failed; pending snapshot retained: {e}"))?;
    #[cfg(unix)]
    File::open(dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("queue directory sync failed; publication durability unknown: {e}"))?;
    Ok(())
}

fn mutex<'a>(
    root: &Path,
    dir: &Path,
    auth: Auth<'a>,
) -> Result<lock_recovery::Sentinel<'a>, String> {
    mutex_bounded(root, dir, auth, Duration::from_secs(600))
}

fn mutex_bounded<'a>(
    root: &Path,
    dir: &Path,
    auth: Auth<'a>,
    limit: Duration,
) -> Result<lock_recovery::Sentinel<'a>, String> {
    let wait = auth
        .lock_wait
        .get()
        .min(limit)
        .min(Duration::from_secs(600));
    lock_recovery::wait_for_lock_cancel(wait, &|| auth.cancelled(), || {
        lock_recovery::Sentinel::acquire(root, &dir.join("queue.lock"), "request_queue", auth)
    })
}

fn validate_scope(scope: &Scope) -> Result<(), String> {
    if !scope.path.is_absolute()
        || scope.path.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::CurDir
            )
        })
    {
        return Err("queue scope must be an absolute normalized path".into());
    }
    Ok(())
}

fn conflicts(left: &[Scope], right: &[Scope]) -> bool {
    left.iter().any(|a| {
        right.iter().any(|b| {
            (a.exclusive || b.exclusive)
                && (paths::within(&a.path, &b.path) || paths::within(&b.path, &a.path))
        })
    })
}

fn active(subscriber: &Subscriber, now: u64, running: bool) -> bool {
    !subscriber.cancelled
        && !subscriber.expired
        && !subscriber.acknowledged
        && (running || subscriber.deadline >= now)
}

fn expire(queue: &mut Queue, now: u64) {
    for e in &mut queue.executions {
        if e.state != "waiting" {
            continue;
        }
        for s in &mut e.subscribers {
            if s.deadline < now && !s.expired {
                s.expired = true;
                queue.changed = true;
            }
        }
        if !e.subscribers.iter().any(|s| active(s, now, false)) {
            e.state = "terminal".into();
            e.result = Some(Err(
                "request cancelled or wait deadline exhausted before admission".into(),
            ));
            queue.changed = true;
        }
    }
}

fn locate(queue: &Queue, key: &Key<'_>) -> Option<(usize, usize)> {
    queue.executions.iter().enumerate().find_map(|(i, e)| {
        e.subscribers
            .iter()
            .position(|s| s.session == key.session && s.request == key.request)
            .map(|j| (i, j))
    })
}

fn busy(dir: &Path, reason: &str) -> String {
    json!({"error":reason,"code":"maintenance_busy","retryable":true,
        "lock_path":dir.join("queue.lock"),"owner":null,"queue_status":"full","retry_after_ms":1000}).to_string()
}

fn fingerprint(request: &Value, scopes: &[Scope]) -> Result<String, String> {
    let mut operation = request.clone();
    let object = operation
        .as_object_mut()
        .ok_or("request must be an object")?;
    object.remove("coordination");
    object.remove("lock_wait_ms");
    crate::hash(&json!({"request":operation,"scopes":scopes}))
}

/// Returns the exact producer result. Only control responses carry queue metadata.
pub(crate) fn run(
    root: &Path,
    request: &Value,
    scopes: &[Scope],
    auth: Auth<'_>,
    execute: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    let key = key(request)?;
    let mut deadline = Instant::now() + Duration::from_millis(key.wait);
    let wall_deadline = crate::now_ms()?.saturating_add(key.wait);
    let project = project(root, request)?;
    if scopes.is_empty() {
        return Err("queue admission requires a nonempty scope set".into());
    }
    for scope in scopes {
        validate_scope(scope)?;
    }
    let fingerprint = fingerprint(request, scopes)?;
    let dir = directory(root, auth)?;
    let mut execute = Some(execute);
    let mut enrolled = false;
    let mut first_attempt = true;
    loop {
        if !enrolled && auth.cancelled() {
            return Err("request cancelled before enrollment".into());
        }
        let guard = match mutex_bounded(
            root,
            &dir,
            auth,
            deadline.saturating_duration_since(Instant::now()),
        ) {
            Ok(guard) => guard,
            Err(_) if enrolled && auth.cancelled() => {
                // Record this subscriber's cancellation even when the caller's
                // callback interrupted mutex acquisition. Never cancel followers.
                lock_recovery::wait_for_lock(
                    auth.lock_wait
                        .get()
                        .min(Duration::from_millis(200))
                        .min(deadline.saturating_duration_since(Instant::now())),
                    || {
                        lock_recovery::Sentinel::acquire(
                            root,
                            &dir.join("queue.lock"),
                            "request_queue",
                            auth,
                        )
                    },
                )?
            }
            Err(error) => return Err(error),
        };
        let mut queue = load(root, &dir, auth)?;
        let now = crate::now_ms()?;
        expire(&mut queue, now);
        if !enrolled {
            if let Some((i, j)) = locate(&queue, &key) {
                if queue.executions[i].project != project {
                    return Err(
                        "request ID reused for a different project in this coordination domain"
                            .into(),
                    );
                }
                if queue.executions[i].fingerprint != fingerprint {
                    return Err(
                        "request ID reused with a different operation or scope identity".into(),
                    );
                }
                if queue.executions[i].subscribers[j].acknowledged {
                    return Err("request already acknowledged".into());
                }
                let original_remaining = Duration::from_millis(
                    queue.executions[i].subscribers[j]
                        .deadline
                        .saturating_sub(now),
                );
                deadline = deadline.min(Instant::now() + original_remaining);
            } else {
                let total = queue
                    .executions
                    .iter()
                    .map(|e| e.subscribers.len())
                    .sum::<usize>();
                if total >= MAX_RECORDS {
                    return Err(busy(
                        &dir,
                        "request evidence capacity reached; acknowledge known terminal requests",
                    ));
                }
                let subscriber = Subscriber {
                    session: key.session.into(),
                    request: key.request.into(),
                    deadline: wall_deadline,
                    cancelled: false,
                    expired: false,
                    acknowledged: false,
                };
                if let Some(existing) = queue.executions.iter_mut().find(|e| {
                    e.project == project
                        && e.fingerprint == fingerprint
                        && matches!(e.state.as_str(), "waiting" | "running")
                }) {
                    existing.subscribers.push(subscriber);
                } else {
                    let waiting = queue
                        .executions
                        .iter()
                        .filter(|e| e.state == "waiting" && e.project == project)
                        .count();
                    let session_waiting = queue
                        .executions
                        .iter()
                        .filter(|e| {
                            e.state == "waiting"
                                && e.project == project
                                && e.subscribers
                                    .iter()
                                    .any(|s| s.session == key.session && active(s, now, false))
                        })
                        .count();
                    if waiting >= 256 || session_waiting >= 32 {
                        return Err(busy(&dir, "project or session waiting queue is full"));
                    }
                    use std::hash::{BuildHasher, Hasher};
                    let mut random = std::collections::hash_map::RandomState::new().build_hasher();
                    random.write_u64(now);
                    let id = format!(
                        "{:x}-{:x}-{:016x}",
                        std::process::id(),
                        queue.generation,
                        random.finish()
                    );
                    queue.executions.push(Execution {
                        id,
                        project: project.clone(),
                        fingerprint: fingerprint.clone(),
                        scopes: scopes.to_vec(),
                        state: "waiting".into(),
                        subscribers: vec![subscriber],
                        result: None,
                    });
                }
            }
            enrolled = true;
            save(root, &dir, &mut queue, auth)?;
        }
        let (i, j) = locate(&queue, &key).ok_or("request reference disappeared")?;
        if auth.cancelled() {
            queue.executions[i].subscribers[j].cancelled = true;
        }
        if queue.executions[i].state == "waiting"
            && (!first_attempt || key.wait != 0)
            && Instant::now() >= deadline
        {
            queue.executions[i].subscribers[j].expired = true;
        }
        // A zero wait still permits one immediate admission attempt.
        let e = &queue.executions[i];
        if e.subscribers[j].cancelled || e.subscribers[j].expired {
            expire(&mut queue, now);
            save(root, &dir, &mut queue, auth)?;
            return Err("request cancelled or wait deadline exhausted".into());
        }
        if e.state == "unknown" {
            let error = e
                .result
                .as_ref()
                .and_then(|result| result.as_ref().err())
                .cloned()
                .unwrap_or_else(|| {
                    "request execution outcome unknown; automatic replay prohibited".into()
                });
            save(root, &dir, &mut queue, auth)?;
            return Err(error);
        }
        if let Some(result) = &e.result {
            return result.clone();
        }
        if e.state == "running" && Instant::now() >= deadline {
            return Err(json!({"error":"request is still running; response wait exhausted", "code":"maintenance_busy",
                "retryable":true,"lock_path":dir.join("queue.lock"),"owner":null,
                "queue_status":"running","execution_id":e.id,"request_id":key.request}).to_string());
        }
        let blocker = queue
            .executions
            .iter()
            .enumerate()
            .find(|(index, other)| {
                *index != i
                    && matches!(other.state.as_str(), "waiting" | "running" | "unknown")
                    && (other.state != "waiting" || *index < i)
                    && conflicts(&e.scopes, &other.scopes)
            })
            .map(|(_, other)| (other.id.clone(), other.state.clone()));
        if e.state == "waiting" && blocker.is_none() {
            let id = e.id.clone();
            let custody = lock_recovery::Sentinel::acquire(
                root,
                &dir.join(format!("{id}.lock")),
                "request_execution",
                auth,
            )
            .map_err(|e| match e {
                lock_recovery::LockAcquireError::Other(s)
                | lock_recovery::LockAcquireError::Busy(s)
                | lock_recovery::LockAcquireError::Queued(s, _) => s,
            })?;
            queue.executions[i].state = "running".into();
            save(root, &dir, &mut queue, auth)?;
            guard.release()?;
            let result = execute
                .take()
                .ok_or("execution callback already consumed")?();
            // Completion persistence must survive caller cancellation.
            let guard = lock_recovery::wait_for_lock(
                auth.lock_wait
                    .get()
                    .max(Duration::from_secs(10))
                    .min(Duration::from_secs(600)),
                || {
                    lock_recovery::Sentinel::acquire(
                        root,
                        &dir.join("queue.lock"),
                        "request_queue",
                        auth,
                    )
                },
            )?;
            let mut queue = load(root, &dir, auth)?;
            let e = queue
                .executions
                .iter_mut()
                .find(|e| e.id == id)
                .ok_or("execution fence disappeared; result outcome uncommitted")?;
            if e.state != "running" {
                return Err("execution fence changed; result outcome uncommitted".into());
            }
            custody.verify()?;
            e.result = Some(result.clone());
            e.state = if unknown_result(&result) {
                "unknown"
            } else {
                "terminal"
            }
            .into();
            save(root, &dir, &mut queue, auth)?;
            guard.release()?;
            custody.release()?;
            return result;
        }
        let mut hint = None;
        let waiting_on = if e.state == "running" {
            Some(e.id.clone())
        } else {
            blocker
                .filter(|(_, state)| state == "running")
                .map(|(id, _)| id)
        };
        if let Some(id) = waiting_on {
            let path = dir.join(format!("{id}.lock"));
            let file = checked_file(root, &path, auth)?;
            hint = lock_wait::Waiter::prepare(&path, &file)?;
        }
        guard.release()?;
        first_attempt = false;
        // Custody release is a hint; the persisted result and fence decide completion.
        if let Some(hint) = hint {
            if let Err(error) = hint.wait(
                deadline.min(Instant::now() + Duration::from_millis(200)),
                &|| auth.cancelled(),
            ) {
                if !auth.cancelled() {
                    return Err(error);
                }
            }
        } else {
            std::thread::sleep(
                Duration::from_millis(100).min(deadline.saturating_duration_since(Instant::now())),
            );
        }
    }
}

pub(crate) fn control(root: &Path, request: &Value, auth: Auth<'_>) -> Result<Value, String> {
    let key = key(request)?;
    let project = project(root, request)?;
    let operation = crate::string(request, "operation")?;
    if !matches!(
        operation,
        "request_status"
            | "request_cancel"
            | "request_ack"
            | "request_recover"
            | "request_recover_pending"
    ) {
        return Err("unknown request control operation".into());
    }
    let dir = directory(root, auth)?;
    let guard = mutex_bounded(root, &dir, auth, Duration::from_millis(key.wait))?;
    if operation == "request_recover_pending" {
        let result = recover_pending(root, &dir, request, &project, auth);
        guard.release()?;
        return result;
    }
    let mut queue = load(root, &dir, auth)?;
    expire(&mut queue, crate::now_ms()?);
    let (i, j) = locate(&queue, &key).ok_or("request not found for this session")?;
    if queue.executions[i].project != project {
        return Err("request does not belong to this project".into());
    }
    if operation == "request_recover" {
        let result = recover_execution(root, &dir, request, &project, &mut queue, i, auth);
        guard.release()?;
        return result;
    }
    if operation == "request_cancel" {
        queue.executions[i].subscribers[j].cancelled = true;
        expire(&mut queue, crate::now_ms()?);
    }
    if operation == "request_ack" {
        if queue.executions[i].state != "terminal" {
            return Err("only known terminal requests can be acknowledged".into());
        }
        queue.executions[i].subscribers[j].acknowledged = true;
    }
    let e = &queue.executions[i];
    let s = &e.subscribers[j];
    let response = json!({"execution_id":e.id,"recovery_token":crate::hash(e)?,"request_id":s.request,"session_id":s.session,
        "status":e.state,"cancel_requested":s.cancelled,"expired":s.expired,"acknowledged":s.acknowledged,"result":e.result});
    let remove = e.state == "terminal" && e.subscribers.iter().all(|s| s.acknowledged);
    let custody_path = dir.join(format!("{}.lock", e.id));
    if remove {
        // Persist every acknowledgement before disposing evidence. Keep the
        // record until ordinary deletion succeeds, allowing an exact ack retry.
        save(root, &dir, &mut queue, auth)?;
        let file = if paths::checked_metadata(root, &custody_path, auth)?.is_some() {
            Some(checked_file(root, &custody_path, auth)?)
        } else {
            None
        };
        if let Some(file) = &file {
            file.try_lock()
                .map_err(|e| format!("terminal custody still active: {e}"))?;
        }
        if let Some(file) = file {
            let identity = lock_recovery::identity(&file)?;
            auth(&custody_path, AccessMode::Write)?;
            if identity != lock_recovery::identity(&checked_file(root, &custody_path, auth)?)? {
                return Err("terminal custody identity changed".into());
            }
            drop(file);
            fs::remove_file(&custody_path)
                .map_err(|e| format!("terminal custody cleanup failed: {e}"))?;
            if paths::checked_metadata(root, &custody_path, auth)?.is_some() {
                return Err("terminal custody cleanup not verified".into());
            }
        }
        queue.executions.remove(i);
        save(root, &dir, &mut queue, auth)?;
    } else {
        save(root, &dir, &mut queue, auth)?;
    }
    guard.release()?;
    Ok(response)
}

struct Snapshot {
    path: PathBuf,
    identity: Vec<u64>,
    bytes: Vec<u8>,
    digest: String,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn snapshot(root: &Path, path: &Path, auth: Auth<'_>) -> Result<Snapshot, String> {
    let file = checked_file(root, path, auth)?;
    let identity = lock_recovery::identity(&file)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("recovery input exceeds size bound".into());
    }
    if identity != lock_recovery::identity(&checked_file(root, path, auth)?)? {
        return Err("recovery input identity changed".into());
    }
    Ok(Snapshot {
        path: path.to_owned(),
        identity,
        digest: digest(&bytes),
        bytes,
    })
}

fn verify_snapshot(root: &Path, original: &Snapshot, auth: Auth<'_>) -> Result<(), String> {
    let current = snapshot(root, &original.path, auth)?;
    if current.identity != original.identity
        || current.digest != original.digest
        || current.bytes != original.bytes
    {
        return Err("recovery input identity or bytes changed".into());
    }
    Ok(())
}

fn stopped_proof(
    project: &str,
    dir: &Path,
    request: &Value,
    auth: Auth<'_>,
) -> Result<Snapshot, String> {
    if request.get("producer_stopped_verified") != Some(&Value::Bool(true)) {
        return Err("explicit verification that the exact producer and its process tree stopped is required; PID absence is insufficient".into());
    }
    crate::string(request, "reason")?
        .trim()
        .len()
        .checked_sub(1)
        .filter(|length| *length < 4096)
        .ok_or("nonempty bounded recovery reason required")?;
    let project = Path::new(project);
    let evidence = Path::new(crate::string(request, "evidence_ref")?);
    if !evidence.is_absolute() {
        return Err("recovery evidence must be an absolute contained project file".into());
    }
    let evidence = paths::resolve(project, evidence)?;
    if paths::within(&evidence, dir) {
        return Err("stopped proof must be independent of queue control evidence".into());
    }
    let proof = snapshot(project, &evidence, auth)?;
    if proof.bytes.is_empty() || proof.digest != crate::string(request, "evidence_sha256")? {
        return Err("recovery evidence hash mismatch or empty proof".into());
    }
    Ok(proof)
}

fn custody_for_recovery(
    root: &Path,
    dir: &Path,
    id: &str,
    auth: Auth<'_>,
) -> Result<Option<File>, String> {
    let path = dir.join(format!("{id}.lock"));
    if paths::checked_metadata(root, &path, auth)?.is_none() {
        return Ok(None);
    }
    let file = checked_file(root, &path, auth)?;
    file.try_lock().map_err(|error| {
        format!("recovery refused: execution custody remains held or unavailable: {error}")
    })?;
    Ok(Some(file))
}

// Receipts are immutable control evidence, independent of request ack. Never
// truncate a receipt left by a prior interrupted recovery attempt.
fn evidence_file(
    root: &Path,
    path: &Path,
    bytes: &[u8],
    auth: Auth<'_>,
) -> Result<Snapshot, String> {
    if bytes.len() > MAX_BYTES {
        return Err("recovery evidence output exceeds bound".into());
    }
    paths::check(root, path, auth)?;
    auth(path, AccessMode::Write)?;
    match OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(path)
    {
        Ok(mut file) => {
            lock_recovery::identity(&file)?;
            file.write_all(bytes)
                .and_then(|()| file.sync_all())
                .map_err(|e| {
                    format!("recovery evidence write failed; partial evidence retained: {e}")
                })?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e.to_string()),
    }
    let observed = snapshot(root, path, auth)?;
    if observed.bytes != bytes {
        return Err("existing recovery evidence differs; explicit reconciliation required".into());
    }
    #[cfg(unix)]
    File::open(path.parent().ok_or("recovery evidence parent missing")?)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(observed)
}

fn remove_snapshot(root: &Path, original: &Snapshot, auth: Auth<'_>) -> Result<(), String> {
    verify_snapshot(root, original, auth)?;
    auth(&original.path, AccessMode::Write)?;
    fs::remove_file(&original.path)
        .map_err(|e| format!("recovery ordinary deletion failed; evidence retained: {e}"))?;
    if paths::checked_metadata(root, &original.path, auth)?.is_some() {
        return Err("recovery deletion not verified".into());
    }
    #[cfg(unix)]
    File::open(original.path.parent().ok_or("recovery parent missing")?)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn recover_execution(
    root: &Path,
    dir: &Path,
    request: &Value,
    project: &str,
    queue: &mut Queue,
    index: usize,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let proof = stopped_proof(project, dir, request, auth)?;
    let e = &queue.executions[index];
    let token = crate::hash(e)?;
    if e.id != crate::string(request, "execution_id")?
        || token != crate::string(request, "recovery_token")?
    {
        return Err(
            "execution identity or recovery token changed; inspect current request status".into(),
        );
    }
    if e.state != "unknown"
        || e.result
            .as_ref()
            .is_some_and(|result| !unknown_result(result))
    {
        return Err(
            "only an unknown execution without a known actual result can be recovered".into(),
        );
    }
    let _custody = custody_for_recovery(root, dir, &e.id, auth)?;
    let receipt = json!({"schema":1,"operation":"request_recover","project":project,"execution_id":e.id,
        "recovery_token":token,"reason":crate::string(request,"reason")?,"producer_stopped_verified":true,
        "evidence_ref":proof.path,"evidence_sha256":proof.digest,"evidence_identity":proof.identity,
        "before":e,"outcome":"interrupted; explicit recovery released custody"});
    let receipt_id = crate::hash(&receipt)?;
    let receipt_path = dir.join(format!("recovery-{receipt_id}-intent.json"));
    evidence_file(
        root,
        &receipt_path,
        &serde_json::to_vec(&receipt).map_err(|e| e.to_string())?,
        auth,
    )?;
    verify_snapshot(Path::new(project), &proof, auth)?;
    if crate::hash(&queue.executions[index])? != token {
        return Err("execution changed before recovery commit".into());
    }
    queue.executions[index].state = "terminal".into();
    queue.executions[index].result =
        Some(Err("interrupted; explicit recovery released custody".into()));
    save(root, dir, queue, auth)?;
    let completed_path = dir.join(format!("recovery-{receipt_id}-completed.json"));
    let completed = json!({"schema":1,"intent":receipt_path,"intent_sha256":digest(&serde_json::to_vec(&receipt).map_err(|e| e.to_string())?),
        "execution_id":queue.executions[index].id,"terminal_token":crate::hash(&queue.executions[index])?,"outcome":"interrupted"});
    evidence_file(
        root,
        &completed_path,
        &serde_json::to_vec(&completed).map_err(|e| e.to_string())?,
        auth,
    )?;
    Ok(
        json!({"execution_id":queue.executions[index].id,"status":"terminal","result":queue.executions[index].result,"recovery_receipt":completed_path}),
    )
}

fn decode_snapshot(snapshot: &Snapshot) -> Result<Queue, String> {
    let queue: Queue = serde_json::from_slice(&snapshot.bytes)
        .map_err(|e| format!("recovery requires a complete valid queue snapshot: {e}"))?;
    validate(&queue)?;
    Ok(queue)
}

fn fence_unknown(execution: &mut Execution, previous: Option<&Result<Value, String>>) {
    let provenance = execution
        .result
        .as_ref()
        .filter(|r| unknown_result(r))
        .cloned()
        .or_else(|| previous.filter(|r| unknown_result(r)).cloned());
    execution.state = "unknown".into();
    execution.result = provenance;
}

struct RecoveryProofs {
    projects: Vec<String>,
    snapshots: Vec<(String, Snapshot)>,
    manifest: Value,
}

fn pending_proofs(
    dir: &Path,
    request: &Value,
    project: &str,
    queue: &Queue,
    auth: Auth<'_>,
) -> Result<RecoveryProofs, String> {
    let projects = queue
        .executions
        .iter()
        .map(|e| e.project.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let declared = request.get("affected_projects");
    if let Some(declared) = declared {
        if declared != &json!(projects) {
            return Err(format!(
                "affected_projects must equal the exact sorted snapshot project set ({} projects)",
                projects.len()
            ));
        }
    } else if projects.len() > 1 || projects.first().is_some_and(|p| p != project) {
        return Err(format!(
            "explicit exact affected_projects authorization required ({} projects)",
            projects.len()
        ));
    }
    for p in &projects {
        let path = Path::new(p);
        auth(path, AccessMode::Read)?;
        auth(path, AccessMode::Write)?;
        paths::check(path, path, auth)?;
        lock_recovery::final_plain_path(path)?;
        if dunce::canonicalize(path).map_err(|e| e.to_string())? != path {
            return Err("affected project root is not its exact canonical identity".into());
        }
    }
    let required = queue
        .executions
        .iter()
        .filter(|e| matches!(e.state.as_str(), "running" | "unknown"))
        .map(|e| (e.id.as_str(), e.project.as_str()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut snapshots = Vec::new();
    let mut manifest = Vec::new();
    if projects.len() <= 1 && request.get("execution_proofs").is_none() {
        let owner = projects.first().map_or(project, String::as_str);
        let proof = stopped_proof(owner, dir, request, auth)?;
        manifest.push(json!({"execution_ids":required.keys().collect::<Vec<_>>(),"project":owner,"evidence_ref":proof.path,"evidence_sha256":proof.digest,"evidence_identity":proof.identity}));
        snapshots.push((owner.to_owned(), proof));
    } else {
        let proofs = request
            .get("execution_proofs")
            .and_then(Value::as_array)
            .ok_or("execution_proofs array required for each affected execution")?;
        if proofs.len() != required.len() {
            return Err(
                "execution_proofs must cover exactly the affected running/unknown executions"
                    .into(),
            );
        }
        let mut seen = std::collections::BTreeSet::new();
        let mut total = 0usize;
        for entry in proofs {
            let id = crate::string(entry, "execution_id")?;
            let owner = required
                .get(id)
                .ok_or("execution_proofs contains an unrelated execution")?;
            if !seen.insert(id) || crate::string(entry, "project")? != *owner {
                return Err("execution proof identity/project mismatch or duplicate".into());
            }
            let proof = stopped_proof(owner, dir, entry, auth)?;
            total = total
                .checked_add(proof.bytes.len())
                .filter(|n| *n <= MAX_BYTES)
                .ok_or("combined recovery proof bytes exceed bound")?;
            manifest.push(json!({"execution_id":id,"project":owner,"evidence_ref":proof.path,"evidence_sha256":proof.digest,"evidence_identity":proof.identity,"reason":crate::string(entry,"reason")?}));
            snapshots.push(((*owner).to_owned(), proof));
        }
        manifest.sort_by(|a, b| a["execution_id"].as_str().cmp(&b["execution_id"].as_str()));
    }
    Ok(RecoveryProofs {
        projects,
        snapshots,
        manifest: json!(manifest),
    })
}

fn verify_proofs(proofs: &RecoveryProofs, auth: Auth<'_>) -> Result<(), String> {
    for (project, snapshot) in &proofs.snapshots {
        verify_snapshot(Path::new(project), snapshot, auth)?;
    }
    Ok(())
}

fn merge_pending(base: Option<&Queue>, mut pending: Queue) -> Result<Queue, String> {
    let generation = base.map_or(0, |q| q.generation);
    if pending.generation
        != generation
            .checked_add(1)
            .ok_or("recovery generation exhausted")?
    {
        return Err("pending recovery requires an adjacent base and pending generation".into());
    }
    if let Some(base) = base {
        for old in &base.executions {
            if let Some(new) = pending.executions.iter_mut().find(|e| e.id == old.id) {
                if old.project != new.project
                    || old.fingerprint != new.fingerprint
                    || old.scopes != new.scopes
                {
                    return Err(
                        "pending execution identity, fingerprint or scopes contradict the base"
                            .into(),
                    );
                }
                for old_sub in &old.subscribers {
                    let new_sub = new
                        .subscribers
                        .iter()
                        .find(|s| s.session == old_sub.session && s.request == old_sub.request)
                        .ok_or("pending snapshot contradicts subscriber identity")?;
                    if old_sub.deadline != new_sub.deadline
                        || (old_sub.cancelled && !new_sub.cancelled)
                        || (old_sub.expired && !new_sub.expired)
                        || (old_sub.acknowledged && !new_sub.acknowledged)
                    {
                        return Err(
                            "pending snapshot contradicts subscriber deadline or monotonic state"
                                .into(),
                        );
                    }
                }
                if old.state == "terminal" {
                    if new.state != "terminal" || old.result != new.result {
                        return Err(
                            "pending snapshot contradicts a known actual terminal result".into(),
                        );
                    }
                } else if crate::hash(old)? != crate::hash(new)? || old.state == "running" {
                    fence_unknown(new, old.result.as_ref());
                }
            } else {
                // An uncommitted ack may have removed evidence. Preserve it;
                // recovery never manufactures an acknowledgement or result.
                let mut preserved: Execution =
                    serde_json::from_value(serde_json::to_value(old).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                if preserved.state != "terminal" {
                    fence_unknown(&mut preserved, None);
                }
                pending.executions.push(preserved);
            }
        }
    }
    for new in &mut pending.executions {
        if base.is_none_or(|q| !q.executions.iter().any(|e| e.id == new.id)) {
            fence_unknown(new, None);
        }
    }
    pending.generation = pending
        .generation
        .checked_add(1)
        .ok_or("recovery generation exhausted")?;
    validate(&pending)?;
    Ok(pending)
}

fn recover_pending(
    root: &Path,
    dir: &Path,
    request: &Value,
    project: &str,
    auth: Auth<'_>,
) -> Result<Value, String> {
    let reason = crate::string(request, "reason")?;
    if reason.trim().is_empty() || reason.len() > 4096 {
        return Err("nonempty bounded pending recovery reason required".into());
    }
    let expected_base = crate::string(request, "queue_sha256")?;
    let expected_pending = crate::string(request, "pending_sha256")?;
    let marker_path = dir.join("recovery.pending");
    let queue_path = dir.join("queue.json");
    let pending_path = dir.join("queue.pending");
    let marker_exists = paths::checked_metadata(root, &marker_path, auth)?.is_some();
    let (marker, merged, proofs) = if marker_exists {
        let marker = snapshot(root, &marker_path, auth)?;
        let intent: Value = serde_json::from_slice(&marker.bytes)
            .map_err(|e| format!("invalid recovery intent: {e}"))?;
        if intent["schema"] != 1
            || intent["project"] != project
            || intent["queue_sha256"] != expected_base
            || intent["pending_sha256"] != expected_pending
            || intent["reason"] != crate::string(request, "reason")?
        {
            return Err("recovery intent differs from this exact proof or snapshot request".into());
        }
        let receipt_id = crate::string(&intent, "receipt_id")?;
        if receipt_id.len() != 64 || !receipt_id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid recovery receipt identity".into());
        }
        let original_pending = snapshot(
            root,
            &dir.join(format!("recovery-{receipt_id}-pending.json")),
            auth,
        )?;
        if original_pending.digest != expected_pending {
            return Err("preserved pending evidence hash changed".into());
        }
        let parsed_pending = decode_snapshot(&original_pending)?;
        let original_base = if expected_base == "absent" {
            None
        } else {
            let original = snapshot(
                root,
                &dir.join(format!("recovery-{receipt_id}-base.json")),
                auth,
            )?;
            if original.digest != expected_base {
                return Err("preserved base evidence hash changed".into());
            }
            Some(decode_snapshot(&original)?)
        };
        let merged = merge_pending(original_base.as_ref(), parsed_pending)?;
        let proofs = pending_proofs(dir, request, project, &merged, auth)?;
        if intent["affected_projects"] != json!(proofs.projects)
            || intent["execution_proofs"] != proofs.manifest
        {
            return Err("recovery intent project set or exact proof identity/hash changed".into());
        }
        if digest(&serde_json::to_vec(&merged).map_err(|e| e.to_string())?)
            != crate::string(&intent, "merged_sha256")?
        {
            return Err("preserved recovery merge differs from intent".into());
        }
        (marker, merged, proofs)
    } else {
        let original_base = if paths::checked_metadata(root, &queue_path, auth)?.is_some() {
            let observed = snapshot(root, &queue_path, auth)?;
            if observed.digest != expected_base {
                return Err("queue_sha256 changed".into());
            }
            Some(observed)
        } else {
            if expected_base != "absent" {
                return Err("missing queue requires explicit queue_sha256=absent".into());
            }
            None
        };
        let original_pending = snapshot(root, &pending_path, auth)?;
        if original_pending.digest != expected_pending {
            return Err("pending_sha256 changed".into());
        }
        let base = original_base.as_ref().map(decode_snapshot).transpose()?;
        let candidate = decode_snapshot(&original_pending)?;
        let merged = merge_pending(base.as_ref(), candidate)?;
        let proofs = pending_proofs(dir, request, project, &merged, auth)?;
        // Hold all observed execution fences before publishing a recovery intent.
        let mut custody = Vec::new();
        for e in &merged.executions {
            if matches!(e.state.as_str(), "running" | "unknown") {
                custody.push(custody_for_recovery(root, dir, &e.id, auth)?);
            }
        }
        let receipt_id = crate::hash(
            &json!({"project":project,"affected_projects":proofs.projects,"queue":expected_base,"pending":expected_pending,"execution_proofs":proofs.manifest,"reason":crate::string(request,"reason")?}),
        )?;
        if let Some(base) = &original_base {
            evidence_file(
                root,
                &dir.join(format!("recovery-{receipt_id}-base.json")),
                &base.bytes,
                auth,
            )?;
        }
        evidence_file(
            root,
            &dir.join(format!("recovery-{receipt_id}-pending.json")),
            &original_pending.bytes,
            auth,
        )?;
        let intent = json!({"schema":1,"project":project,"receipt_id":receipt_id,"queue_sha256":expected_base,
            "queue_identity":original_base.as_ref().map(|s| &s.identity),"pending_identity":original_pending.identity,
            "pending_sha256":expected_pending,"merged_sha256":digest(&serde_json::to_vec(&merged).map_err(|e| e.to_string())?),
            "reason":crate::string(request,"reason")?,"affected_projects":proofs.projects,"execution_proofs":proofs.manifest});
        verify_proofs(&proofs, auth)?;
        if let Some(base) = &original_base {
            verify_snapshot(root, base, auth)?;
        }
        verify_snapshot(root, &original_pending, auth)?;
        let bytes = serde_json::to_vec(&intent).map_err(|e| e.to_string())?;
        evidence_file(
            root,
            &dir.join(format!("recovery-{receipt_id}-intent.json")),
            &bytes,
            auth,
        )?;
        let marker = evidence_file(root, &marker_path, &bytes, auth)?;
        drop(custody);
        (marker, merged, proofs)
    };
    // The marker blocks ordinary dispatch through every destructive boundary.
    // It remains on every failure and can be resumed using the same exact proof.
    let intent: Value = serde_json::from_slice(&marker.bytes).map_err(|e| e.to_string())?;
    let mut custody = Vec::new();
    for e in &merged.executions {
        if matches!(e.state.as_str(), "running" | "unknown") {
            custody.push(custody_for_recovery(root, dir, &e.id, auth)?);
        }
    }
    let merged_bytes = serde_json::to_vec(&merged).map_err(|e| e.to_string())?;
    let merged_hash = digest(&merged_bytes);
    let current = if paths::checked_metadata(root, &queue_path, auth)?.is_some() {
        Some(snapshot(root, &queue_path, auth)?)
    } else {
        None
    };
    if current.as_ref().map_or("absent", |s| s.digest.as_str()) != expected_base
        && current.as_ref().is_none_or(|s| s.digest != merged_hash)
    {
        return Err(
            "queue changed outside the exact base/recovered snapshots; recovery evidence retained"
                .into(),
        );
    }
    if let Some(current) = &current {
        if current.digest == expected_base && intent["queue_identity"] != json!(current.identity) {
            return Err("original queue file identity changed during recovery".into());
        }
    }
    let observed_pending = if paths::checked_metadata(root, &pending_path, auth)?.is_some() {
        Some(snapshot(root, &pending_path, auth)?)
    } else {
        None
    };
    if let Some(pending) = &observed_pending {
        if pending.digest == expected_pending
            && intent["pending_identity"] != json!(pending.identity)
        {
            return Err("original pending file identity changed during recovery".into());
        }
        if pending.digest != expected_pending && pending.digest != merged_hash {
            return Err("pending bytes differ from both preserved intent and complete recovery snapshot; explicit partial-write reconciliation required".into());
        }
    }
    verify_proofs(&proofs, auth)?;
    verify_snapshot(root, &marker, auth)?;
    if let Some(pending) = &observed_pending {
        remove_snapshot(root, pending, auth)?;
    }
    if current.as_ref().is_none_or(|s| s.digest != merged_hash) {
        if let Some(current) = &current {
            verify_snapshot(root, current, auth)?;
        }
        let mut publish = merged;
        publish.generation = publish
            .generation
            .checked_sub(1)
            .ok_or("invalid recovery generation")?;
        save(root, dir, &mut publish, auth)?;
    }
    let committed = snapshot(root, &queue_path, auth)?;
    if committed.digest != merged_hash {
        return Err("recovered publication differs from exact intended bytes".into());
    }
    let receipt_id = crate::string(&intent, "receipt_id")?;
    let completed_path = dir.join(format!("recovery-{receipt_id}-completed.json"));
    evidence_file(
        root,
        &completed_path,
        &serde_json::to_vec(
            &json!({"schema":1,"intent_sha256":marker.digest,"queue_sha256":merged_hash,
        "outcome":"pending reconciled; changed executions remain unknown; no success inferred"}),
        )
        .map_err(|e| e.to_string())?,
        auth,
    )?;
    remove_snapshot(root, &marker, auth)?;
    drop(custody);
    Ok(
        json!({"status":"reconciled","queue_sha256":merged_hash,"recovery_receipt":completed_path,"success_inferred":false}),
    )
}

/// Cancellation is per subscriber; a live follower keeps the producer alive.
pub(crate) fn cancelled(
    root: &Path,
    session: &str,
    request_id: &str,
    auth: Auth<'_>,
) -> Result<bool, String> {
    let dir = directory(root, auth)?;
    // This query keeps the writer's exclusive queue order and bounded wait,
    // but observes its existing diagnostic metadata without publishing a new
    // owner. The caller's bookkeeping context still supplies its 200ms budget.
    let wait = auth.lock_wait.get().min(Duration::from_secs(600));
    let guard = lock_recovery::wait_for_lock_cancel(wait, &|| auth.cancelled(), || {
        lock_recovery::ObservationLock::acquire(
            root,
            &dir.join("queue.lock"),
            "request_queue",
            auth,
        )
    })?;
    let queue = load(root, &dir, auth)?;
    let key = Key {
        session,
        request: request_id,
        wait: 0,
    };
    let (i, _) = locate(&queue, &key).ok_or("request not found for this session")?;
    let e = &queue.executions[i];
    let result = !e
        .subscribers
        .iter()
        .any(|s| active(s, crate::now_ms().unwrap_or(u64::MAX), e.state == "running"));
    guard.release()?;
    Ok(result)
}

/// Immediate callers participate in existing queued admission without waiting
/// while holding a catalog lock. Already-admitted callers skip this check.
pub(crate) fn check_external(root: &Path, scopes: &[Scope], auth: Auth<'_>) -> Result<(), String> {
    if scopes.is_empty() {
        return Ok(());
    }
    for scope in scopes {
        validate_scope(scope)?;
    }
    let dir = root.join("artifacts/maintenance/requests");
    let Some(metadata) = paths::checked_metadata(root, &dir, auth)? else {
        return Ok(());
    };
    lock_recovery::final_plain_path(&dir)?;
    if !metadata.is_dir() {
        return Err("queue directory is not a directory".into());
    }
    // Exactly one attempt: never wait for another queue transaction while an
    // immediate caller retains catalog custody. Sentinel busy does not write.
    let guard =
        lock_recovery::Sentinel::acquire(root, &dir.join("queue.lock"), "request_external", auth)
            .map_err(|error| match error {
            lock_recovery::LockAcquireError::Other(error)
            | lock_recovery::LockAcquireError::Busy(error)
            | lock_recovery::LockAcquireError::Queued(error, _) => error,
        })?;
    let mut queue = load(root, &dir, auth)?;
    expire(&mut queue, crate::now_ms()?);
    let blocker = queue
        .executions
        .iter()
        .find(|e| {
            matches!(e.state.as_str(), "waiting" | "running" | "unknown")
                && conflicts(scopes, &e.scopes)
        })
        .map(|e| (e.id.clone(), e.state.clone()));
    if queue.changed {
        save(root, &dir, &mut queue, auth)?;
    }
    guard.release()?;
    if let Some((execution_id, state)) = blocker {
        return Err(json!({
            "error":"immediate operation conflicts with a queued maintenance request",
            "code":"maintenance_busy", "retryable":true,
            "lock_path":dir.join("queue.lock"), "owner":null,
            "queue_status":"blocked", "execution_id":execution_id,
            "blocking_status":state, "retry_after_ms":200,
        })
        .to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Later scheduler edits can accidentally reduce ancestry to string prefixes
    // or block shared readers; these small checks preserve both exceptions.
    #[test]
    fn ancestry_and_shared_readers() {
        let root = std::env::current_dir().unwrap();
        let scope = |path: &str, exclusive| Scope {
            path: root.join(path),
            exclusive,
        };
        assert!(conflicts(&[scope("a", true)], &[scope("a/b", false)]));
        assert!(!conflicts(&[scope("a", true)], &[scope("ab", true)]));
        assert!(!conflicts(&[scope("a", false)], &[scope("a/b", false)]));
    }

    #[test]
    fn fingerprint_keeps_approval_and_excludes_only_transport_fields() {
        let a = json!({"operation":"apply","token":"a","coordination":{"request_id":"1"},"lock_wait_ms":0});
        let b = json!({"operation":"apply","token":"a","coordination":{"request_id":"2"},"lock_wait_ms":500});
        let c = json!({"operation":"apply","token":"b"});
        assert_eq!(fingerprint(&a, &[]).unwrap(), fingerprint(&b, &[]).unwrap());
        assert_ne!(fingerprint(&a, &[]).unwrap(), fingerprint(&c, &[]).unwrap());
    }

    // Returning early from dispatch integration can omit durable result reuse or
    // accidentally replay an abandoned producer. Exercise the persistence boundary.
    #[test]
    fn durable_result_reuse_and_request_identity() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","token":"approval-a", "coordination":{"session_id":"session","request_id":"one"}});
        let expected = Err("actual producer failure".to_owned());
        assert_eq!(
            run(&root, &request, &scopes, &auth, || expected.clone()),
            expected
        );
        assert_eq!(
            run(&root, &request, &scopes, &auth, || panic!(
                "terminal execution replayed"
            )),
            expected
        );
        let mut changed = request.clone();
        changed["token"] = json!("approval-b");
        assert!(
            run(&root, &changed, &scopes, &auth, || panic!(
                "changed request executed"
            ))
            .unwrap_err()
            .contains("reused")
        );
        let mut status = request.clone();
        status["operation"] = json!("request_status");
        assert_eq!(
            control(&root, &status, &auth).unwrap()["status"],
            "terminal"
        );
        status["operation"] = json!("request_ack");
        assert_eq!(
            control(&root, &status, &auth).unwrap()["acknowledged"],
            true
        );
        assert!(control(&root, &status, &auth).is_err());
    }

    #[test]
    fn abandoned_running_fence_is_unknown_and_never_replayed() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"crash"}});
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let _ = run(&root, &request, &scopes, &auth, || {
                    panic!("controlled producer interruption")
                });
            }))
            .is_err()
        );
        let error = run(&root, &request, &scopes, &auth, || {
            panic!("abandoned execution replayed")
        })
        .unwrap_err();
        assert!(error.contains("unknown"));
        let mut status = request;
        status["operation"] = json!("request_status");
        assert_eq!(control(&root, &status, &auth).unwrap()["status"], "unknown");
        status["operation"] = json!("request_ack");
        assert!(control(&root, &status, &auth).is_err());
    }

    #[test]
    fn immediate_admission_reads_missing_queue_and_respects_existing_custody() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        check_external(&root, &scopes, &auth).unwrap();
        assert!(!root.join("artifacts").exists());
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"external"}});
        run(&root, &request, &scopes, &auth, || {
            let error = check_external(&root, &scopes, &auth).unwrap_err();
            assert_eq!(
                lock_recovery::error_response(&error)["code"],
                "maintenance_busy"
            );
            check_external(
                &root,
                &[Scope {
                    path: root.join("unrelated"),
                    exclusive: true,
                }],
                &auth,
            )?;
            Ok(json!({"actual":"result"}))
        })
        .unwrap();
        check_external(&root, &scopes, &auth).unwrap();
    }

    #[test]
    fn shared_domain_keeps_project_results_private_and_conflicts_common() {
        let fixture = tempfile::tempdir().unwrap();
        let domain = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let project_a = domain.join("project-a");
        let project_b = domain.join("project-b");
        fs::create_dir(&project_a).unwrap();
        fs::create_dir(&project_b).unwrap();
        let scopes = [Scope {
            path: domain.join("shared-payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","_coordination_project":project_a,
            "coordination":{"session_id":"session","request_id":"project-request"}});
        run(&domain, &request, &scopes, &auth, || {
            assert_eq!(
                lock_recovery::error_response(
                    &check_external(&domain, &scopes, &auth).unwrap_err()
                )["code"],
                "maintenance_busy"
            );
            Ok(json!({"private":"project-a-result"}))
        })
        .unwrap();
        let mut other_project = request.clone();
        other_project["_coordination_project"] = json!(project_b);
        assert!(
            run(&domain, &other_project, &scopes, &auth, || panic!(
                "cross-project key reuse executed"
            ))
            .unwrap_err()
            .contains("different project")
        );
        for operation in ["request_status", "request_cancel", "request_ack"] {
            other_project["operation"] = json!(operation);
            assert!(
                control(&domain, &other_project, &auth)
                    .unwrap_err()
                    .contains("does not belong")
            );
        }
        let mut status = request;
        status["operation"] = json!("request_status");
        assert_eq!(
            control(&domain, &status, &auth).unwrap()["result"]["Ok"]["private"],
            "project-a-result"
        );
    }

    #[test]
    fn same_key_running_retry_never_expires_the_producer_subscriber() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"retry"}});
        run(&root, &request, &scopes, &auth, || {
            let mut retry = request.clone();
            retry["coordination"]["wait_ms"] = json!(0);
            let error = run(&root, &retry, &scopes, &auth, || {
                panic!("running retry executed")
            })
            .unwrap_err();
            assert_eq!(
                lock_recovery::error_response(&error)["queue_status"],
                "running"
            );
            // Retain this check so mutex refactors cannot route read queries
            // through the diagnostic writer again.
            let lock = root.join("artifacts/maintenance/requests/queue.lock");
            let bytes = fs::read(&lock).unwrap();
            let id = lock_recovery::identity(&File::open(&lock).unwrap()).unwrap();
            assert!(!cancelled(&root, "session", "retry", &auth)?);
            assert_eq!(fs::read(&lock).unwrap(), bytes);
            assert_eq!(
                lock_recovery::identity(&File::open(&lock).unwrap()).unwrap(),
                id
            );
            Ok(json!({"original":"completed"}))
        })
        .unwrap();
    }

    #[test]
    fn external_unknown_outcome_keeps_custody_protected_until_exact_proof_recovery() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"external-unknown"}});
        let raw = unknown("external producer tree termination is unconfirmed");
        assert_eq!(
            run(&root, &request, &scopes, &auth, || Err(raw.clone())),
            Err(raw.clone())
        );
        assert_eq!(
            run(&root, &request, &scopes, &auth, || panic!(
                "unknown result replayed"
            )),
            Err(raw.clone())
        );
        let mut status_request = request.clone();
        status_request["operation"] = json!("request_status");
        let status = control(&root, &status_request, &auth).unwrap();
        assert_eq!(status["status"], "unknown");
        assert_eq!(status["result"]["Err"], raw);
        status_request["operation"] = json!("request_ack");
        assert!(control(&root, &status_request, &auth).is_err());
        assert_eq!(
            lock_recovery::error_response(&check_external(&root, &scopes, &auth).unwrap_err())["code"],
            "maintenance_busy"
        );
        let mut recovery = proof_request(&root, &request);
        recovery["operation"] = json!("request_recover");
        recovery["execution_id"] = status["execution_id"].clone();
        recovery["recovery_token"] = status["recovery_token"].clone();
        let recovered = control(&root, &recovery, &auth).unwrap();
        assert_eq!(recovered["status"], "terminal");
        assert!(
            recovered["result"]["Err"]
                .as_str()
                .unwrap()
                .contains("interrupted")
        );
        check_external(&root, &scopes, &auth).unwrap();
        let mut ack = request;
        ack["operation"] = json!("request_ack");
        assert_eq!(control(&root, &ack, &auth).unwrap()["acknowledged"], true);
    }

    fn proof_request(root: &Path, request: &Value) -> Value {
        let proof = root.join("stopped-proof.txt");
        fs::write(
            &proof,
            b"fixture: the exact owned producer and its process tree have stopped",
        )
        .unwrap();
        let mut recovery = request.clone();
        recovery["producer_stopped_verified"] = json!(true);
        recovery["reason"] = json!("fixture verified exact stopped producer tree");
        recovery["evidence_ref"] = json!(proof);
        recovery["evidence_sha256"] = json!(digest(&fs::read(&proof).unwrap()));
        recovery
    }

    #[test]
    fn unknown_recovery_requires_exact_proof_token_and_released_custody() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let scopes = [Scope {
            path: root.join("payload"),
            exclusive: true,
        }];
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"recover"}});
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = run(&root, &request, &scopes, &auth, || {
                panic!("controlled interruption")
            });
        }));
        let mut status_request = request.clone();
        status_request["operation"] = json!("request_status");
        let status = control(&root, &status_request, &auth).unwrap();
        let mut recovery = proof_request(&root, &request);
        recovery["operation"] = json!("request_recover");
        recovery["execution_id"] = status["execution_id"].clone();
        recovery["recovery_token"] = status["recovery_token"].clone();
        let mut invalid = recovery.clone();
        invalid["producer_stopped_verified"] = json!(false);
        assert!(control(&root, &invalid, &auth).is_err());
        invalid = recovery.clone();
        invalid["evidence_sha256"] = json!("changed");
        assert!(control(&root, &invalid, &auth).is_err());
        invalid = recovery.clone();
        invalid["recovery_token"] = json!("changed");
        assert!(control(&root, &invalid, &auth).is_err());
        let dir = directory(&root, &auth).unwrap();
        let custody = lock_recovery::Sentinel::acquire(
            &root,
            &dir.join(format!("{}.lock", status["execution_id"].as_str().unwrap())),
            "fixture_recovery",
            &auth,
        )
        .unwrap();
        assert!(
            control(&root, &recovery, &auth)
                .unwrap_err()
                .contains("custody remains held")
        );
        custody.release().unwrap();
        let recovered = control(&root, &recovery, &auth).unwrap();
        assert_eq!(recovered["status"], "terminal");
        assert_eq!(
            recovered["result"]["Err"],
            "interrupted; explicit recovery released custody"
        );
        check_external(&root, &scopes, &auth).unwrap();
        assert!(control(&root, &recovery, &auth).is_err());
    }

    #[test]
    fn complete_first_write_pending_is_preserved_as_unknown_until_explicit_recovery() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let dir = directory(&root, &auth).unwrap();
        let queue = Queue {
            generation: 1,
            changed: false,
            executions: vec![Execution {
                id: "abcd-1".into(),
                project: root.to_str().unwrap().into(),
                fingerprint: "fixture".into(),
                scopes: vec![Scope {
                    path: root.join("payload"),
                    exclusive: true,
                }],
                state: "running".into(),
                result: None,
                subscribers: vec![Subscriber {
                    session: "session".into(),
                    request: "pending".into(),
                    deadline: u64::MAX,
                    cancelled: false,
                    expired: false,
                    acknowledged: false,
                }],
            }],
        };
        let bytes = serde_json::to_vec(&queue).unwrap();
        fs::write(dir.join("queue.pending"), &bytes).unwrap();
        let request = json!({"operation":"request_recover_pending","queue_sha256":"absent","pending_sha256":digest(&bytes),
            "coordination":{"session_id":"session","request_id":"pending"}});
        assert!(control(&root, &request, &auth).is_err());
        let recovery = proof_request(&root, &request);
        let mut changed = recovery.clone();
        changed["pending_sha256"] = json!("changed");
        assert!(control(&root, &changed, &auth).is_err());
        let custody = lock_recovery::Sentinel::acquire(
            &root,
            &dir.join("abcd-1.lock"),
            "fixture_recovery",
            &auth,
        )
        .unwrap();
        assert!(
            control(&root, &recovery, &auth)
                .unwrap_err()
                .contains("custody remains held")
        );
        custody.release().unwrap();
        assert_eq!(
            control(&root, &recovery, &auth).unwrap()["status"],
            "reconciled"
        );
        assert!(!dir.join("queue.pending").exists());
        assert!(!dir.join("recovery.pending").exists());
        let mut status = recovery.clone();
        status["operation"] = json!("request_status");
        let state = control(&root, &status, &auth).unwrap();
        assert_eq!(state["status"], "unknown");
        let mut finish = recovery;
        finish["operation"] = json!("request_recover");
        finish["execution_id"] = state["execution_id"].clone();
        finish["recovery_token"] = state["recovery_token"].clone();
        assert_eq!(
            control(&root, &finish, &auth).unwrap()["result"]["Err"],
            "interrupted; explicit recovery released custody"
        );
    }

    #[test]
    fn admission_mutex_uses_the_original_request_deadline() {
        let fixture = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(fixture.path()).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        auth.lock_wait.set(Duration::from_secs(600));
        let dir = directory(&root, &auth).unwrap();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let thread_root = root.clone();
        let holder = std::thread::spawn(move || {
            let authorize = |_: &Path, _: AccessMode| Ok(());
            let auth = crate::Context::new(&authorize);
            let custody = lock_recovery::Sentinel::acquire(
                &thread_root,
                &dir.join("queue.lock"),
                "fixture_deadline",
                &auth,
            )
            .unwrap();
            ready_tx.send(()).unwrap();
            let _ = release_rx.recv_timeout(Duration::from_secs(2));
            custody.release().unwrap();
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let started = Instant::now();
        let request = json!({"operation":"apply","coordination":{"session_id":"session","request_id":"deadline","wait_ms":20}});
        let result = run(
            &root,
            &request,
            &[Scope {
                path: root.join("payload"),
                exclusive: true,
            }],
            &auth,
            || panic!("contended request executed"),
        );
        let elapsed = started.elapsed();
        release_tx.send(()).unwrap();
        holder.join().unwrap();
        assert!(result.is_err());
        assert!(
            elapsed < Duration::from_secs(1),
            "request wait was restarted or replaced: {elapsed:?}"
        );
    }

    #[test]
    fn mixed_project_pending_requires_exact_project_authority_and_each_execution_proof() {
        let fixture = tempfile::tempdir().unwrap();
        let domain = dunce::canonicalize(fixture.path()).unwrap();
        let a = domain.join("project-a");
        let b = domain.join("project-b");
        fs::create_dir(&a).unwrap();
        fs::create_dir(&b).unwrap();
        let authorize = |_: &Path, _: AccessMode| Ok(());
        let auth = crate::Context::new(&authorize);
        let dir = directory(&domain, &auth).unwrap();
        let execution = |id: &str, owner: &Path| Execution {
            id: id.into(),
            project: owner.to_str().unwrap().into(),
            fingerprint: id.into(),
            scopes: vec![Scope {
                path: owner.join("payload"),
                exclusive: true,
            }],
            state: "waiting".into(),
            result: None,
            subscribers: vec![Subscriber {
                session: "session".into(),
                request: id.into(),
                deadline: u64::MAX,
                cancelled: false,
                expired: false,
                acknowledged: false,
            }],
        };
        let queue = Queue {
            generation: 1,
            changed: false,
            executions: vec![execution("a", &a), execution("b", &b)],
        };
        let bytes = serde_json::to_vec(&queue).unwrap();
        fs::write(dir.join("queue.pending"), &bytes).unwrap();
        let mut request = json!({"operation":"request_recover_pending","_coordination_project":a,
            "queue_sha256":"absent","pending_sha256":digest(&bytes),"reason":"verified all exact fixture producer trees stopped",
            "coordination":{"session_id":"session","request_id":"a"}});
        assert!(control(&domain, &request, &auth).is_err());
        request["affected_projects"] = json!([a, b]);
        assert!(control(&domain, &request, &auth).is_err());
        let mut proof_a = proof_request(&a, &json!({}));
        proof_a["execution_id"] = json!("a");
        proof_a["project"] = json!(a);
        let mut proof_b = proof_request(&b, &json!({}));
        proof_b["execution_id"] = json!("b");
        proof_b["project"] = json!(b);
        request["execution_proofs"] = json!([proof_a, proof_b]);
        let deny_b = |path: &Path, mode: AccessMode| {
            if path == b && mode == AccessMode::Write {
                Err("fixture project-b write denied".to_owned())
            } else {
                Ok(())
            }
        };
        let restricted = crate::Context::new(&deny_b);
        assert!(
            control(&domain, &request, &restricted)
                .unwrap_err()
                .contains("write denied")
        );
        assert_eq!(fs::read(dir.join("queue.pending")).unwrap(), bytes);
        assert!(!dir.join("recovery.pending").exists());
        let mut incomplete = request.clone();
        incomplete["execution_proofs"].as_array_mut().unwrap().pop();
        assert!(control(&domain, &incomplete, &auth).is_err());
        assert_eq!(
            control(&domain, &request, &auth).unwrap()["status"],
            "reconciled"
        );
        let persisted = load(&domain, &dir, &auth).unwrap();
        assert!(
            persisted
                .executions
                .iter()
                .all(|e| e.state == "unknown" && e.result.is_none())
        );
    }
}
