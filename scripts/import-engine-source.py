"""Import the current engine worktree as a byte-preserving, verified source snapshot.

Only Git tracked and nonignored untracked paths are source. Unknown ignored
resources and submodules fail closed instead of producing an incomplete import.
Failures retain the partial destination for inspection; no files are deleted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys

PROJECT = Path(__file__).resolve().parent.parent
EXCLUDED = (".ruff_cache", "codex-rs/target", "scripts/.venv",
            "sdk/python/.ruff_cache", "sdk/python/.venv", "sdk/python/__pycache__",
            "sdk/python/src/openai_codex/generated/__pycache__")
IGNORE_SUFFIX = (b"\n# Azrael: retain imported tracked IDE sources\n!/.vscode/\n"
                 b"!/.vscode/extensions.json\n!/.vscode/launch.json\n!/.vscode/settings.json\n")
PRESERVED_IGNORE = ".gitignore.upstream"
QUEUE_MIGRATION = "codex-rs/state/queue_migrations/0003_accepted_user_inputs.sql"
QUEUE_ATTRIBUTES = "codex-rs/state/queue_migrations/.gitattributes"
QUEUE_ATTRIBUTE_BYTES = b"0003_accepted_user_inputs.sql -text\n"
REPLAY_PATH = "codex-rs/tui/src/chatwidget/replay.rs"
PRESERVED_REPLAY = REPLAY_PATH + ".upstream"
REPLAY_FIX_REASON = "Carry Turn.root_resume_wait through replay to fix E0027/E0063"
AZRAEL_IDENTITY = "You are working in Azrael, the application and agent harness for this workspace."
CODEX_IDENTITY_INTROS = (
    "You are Codex, an agent based on GPT-6.",
    "You are Codex, an agent based on GPT-5.",
    "You are Codex, a coding agent based on GPT-5.",
    "You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.",
    "You are GPT-5.1 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
    "You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
    "You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI.",
)
IDENTITY_TEMPLATE_PATHS = {
    "codex-rs/models-manager/models.json",
    "codex-rs/models-manager/prompt.md",
    "codex-rs/protocol/src/prompts/base_instructions/default.md",
    *{"codex-rs/core/" + name for name in (
        "gpt-5.1-codex-max_prompt.md", "gpt-5.2-codex_prompt.md",
        "gpt_5_1_prompt.md", "gpt_5_2_prompt.md", "gpt_5_codex_prompt.md")},
}
IDENTITY_LIB_PATH = "codex-rs/prompts/src/lib.rs"
IDENTITY_SESSION_PATH = "codex-rs/core/src/session/mod.rs"
TOOL_POLICY_FIX_PATH = "codex-rs/ext/extension-api/src/tool_policy.rs"
TOOL_POLICY_FIX_PATHS = {TOOL_POLICY_FIX_PATH}
IDENTITY_FIX_PATHS = IDENTITY_TEMPLATE_PATHS | {IDENTITY_LIB_PATH, IDENTITY_SESSION_PATH}
IDENTITY_FIX_REASON = "Render Azrael harness identity without changing stored instructions or model/provider metadata"
IDENTITY_SESSION_OLD = "        let instructions = self.get_base_instructions().await;"
IDENTITY_SESSION_NEW = """        let mut instructions = self.get_base_instructions().await;
        instructions.text = codex_prompts::with_azrael_harness_identity(&instructions.text);"""
IDENTITY_RUST = r'''
/// Render harness identity on a request copy, preserving model/provider metadata elsewhere.
pub fn with_azrael_harness_identity(instructions: &str) -> String {
    const IDENTITY: &str =
        "You are working in Azrael, the application and agent harness for this workspace.";
    const LEGACY_INTROS: &[&str] = &[
''' + "".join("        " + json.dumps(intro) + ",\n" for intro in CODEX_IDENTITY_INTROS) + r'''    ];
    let mut rendered = instructions.to_owned();
    for &intro in LEGACY_INTROS {
        rendered = rendered.replace(intro, IDENTITY);
    }
    if !rendered.contains(IDENTITY) {
        rendered = format!("{IDENTITY}\n\n{rendered}");
    }
    rendered
}

#[cfg(test)]
mod azrael_identity_tests {
    use super::with_azrael_harness_identity;

    #[test]
    fn renders_saved_identity_without_mutating_source() {
        let saved = "You are Codex, an agent based on GPT-6. Keep provider instructions.";
        let rendered = with_azrael_harness_identity(saved);
        assert!(rendered.starts_with("You are working in Azrael,"));
        assert!(rendered.ends_with("Keep provider instructions."));
        assert_eq!(
            saved,
            "You are Codex, an agent based on GPT-6. Keep provider instructions."
        );
        assert_eq!(with_azrael_harness_identity(&rendered), rendered);
    }

    #[test]
    fn preserves_other_provider_identity_and_product_names() {
        let source = "You are Claude. Use the Codex API and GPT-6 model when requested.";
        let rendered = with_azrael_harness_identity(source);
        assert!(rendered.starts_with("You are working in Azrael,"));
        assert!(rendered.ends_with(source));
        assert_eq!(with_azrael_harness_identity(&rendered), rendered);
    }
}
'''
ROOT_WAIT_OLD = "codex-rs/state/migrations/0056_root_resume_wait_timestamps.sql"
ROOT_WAIT_NEW = "codex-rs/state/migrations/0060_root_resume_wait_timestamps.sql"
STATE_REPAIR_PATH = "codex-rs/state/src/migrations.rs"
STATE_SQLITE_PATH = "codex-rs/state/src/sqlite.rs"
STATE_TESTS_PATH = "codex-rs/state/src/migrations_tests.rs"
STATE_FIX_PATHS = {ROOT_WAIT_OLD, STATE_REPAIR_PATH, STATE_SQLITE_PATH, STATE_TESTS_PATH}
STATE_FIX_REASON = "Resolve duplicate state migration 56 and repair only checksum-matched legacy root wait bookkeeping"
STATE_REPAIR_RUST = '''/// Called while the state startup transaction holds the SQLite writer lock.
/// Only the successful, byte-identical legacy root-wait migration may move.
pub(crate) async fn repair_legacy_root_wait_migration_version(
    connection: &mut sqlx::SqliteConnection,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    let Some(root_wait) = migrator.migrations.iter().find(|migration| {
        migration.version == 60 && migration.description == "root resume wait timestamps"
    }) else {
        return Ok(());
    };
    let exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(&mut *connection)
    .await?
    .is_some();
    if !exists {
        return Ok(());
    }
    let legacy = sqlx::query_as::<_, (bool, Vec<u8>)>(
        "SELECT success, checksum FROM _sqlx_migrations WHERE version = 56",
    )
    .fetch_optional(&mut *connection)
    .await?;
    let Some((true, checksum)) = legacy else {
        return Ok(());
    };
    if checksum.as_slice() != root_wait.checksum.as_ref() {
        return Ok(());
    }
    let occupied =
        sqlx::query_scalar::<_, i64>("SELECT 1 FROM _sqlx_migrations WHERE version = 60")
            .fetch_optional(&mut *connection)
            .await?
            .is_some();
    anyhow::ensure!(
        !occupied,
        "legacy root-wait migration conflicts with existing version 60"
    );
    sqlx::query("UPDATE _sqlx_migrations SET version = 60 WHERE version = 56 AND success = TRUE AND checksum = ?")
        .bind(root_wait.checksum.as_ref())
        .execute(&mut *connection)
        .await?;
    Ok(())
}
'''
STATE_SQLITE_OLD = '''            if matches!(spec.kind, DbKind::State) {
                repair_legacy_recency_migration_version(&pool, migrator).await?;
            }
            migrator.run(&pool).await.map_err(anyhow::Error::from)'''
STATE_SQLITE_NEW = '''            if matches!(spec.kind, DbKind::State) {
                repair_legacy_recency_migration_version(&pool, migrator).await?;
                // SQLite's SQLx migration lock is a no-op. Keep repair and
                // migration inspection/application under one writer lock.
                let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
                crate::migrations::repair_legacy_root_wait_migration_version(
                    &mut transaction,
                    migrator,
                )
                .await?;
                migrator.run_direct(None, &mut *transaction, false).await?;
                transaction.commit().await?;
                Ok(())
            } else {
                migrator.run(&pool).await.map_err(anyhow::Error::from)
            }'''
STATE_TESTS_RUST = '''async fn root_wait_fixture() -> (crate::SqliteConfig, sqlx::SqlitePool, impl Drop) {
    let home = crate::runtime::test_support::unique_temp_dir();
    tokio::fs::create_dir_all(&home).await.unwrap();
    let cleanup = scopeguard::guard(home.clone(), |home| {
        let _ = std::fs::remove_dir_all(home);
    });
    let sqlite = crate::SqliteConfig::new_for_testing(home.as_path().abs());
    let pool = sqlite
        .open_read_write_pool(&sqlite.state_db_path())
        .await
        .unwrap();
    (sqlite, pool, cleanup)
}

async fn root_wait_history(
    pool: &sqlx::SqlitePool,
) -> Vec<(i64, String, bool, Vec<u8>, String, i64)> {
    sqlx::query_as("SELECT version, description, success, checksum, CAST(installed_on AS TEXT), execution_time FROM _sqlx_migrations ORDER BY version")
        .fetch_all(pool).await.unwrap()
}

async fn root_wait_legacy_fixture(pool: &sqlx::SqlitePool) {
    let root_wait = STATE_MIGRATOR
        .migrations
        .iter()
        .find(|m| m.version == 60)
        .unwrap();
    let mut migrations = migrator_through(/*version*/ 55).migrations.into_owned();
    migrations.push(Migration::new(
        /*version*/ 56,
        root_wait.description.clone(),
        root_wait.migration_type,
        root_wait.sql.clone(),
        root_wait.no_tx,
    ));
    Migrator::with_migrations(migrations)
        .run(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn root_wait_fresh_state_has_unique_migrations_and_both_schemas() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    let versions = STATE_MIGRATOR
        .migrations
        .iter()
        .map(|m| m.version)
        .collect::<Vec<_>>();
    assert_eq!(
        versions.len(),
        versions
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
    );
    let opened = sqlite
        .open_state_db(
            &super::runtime_state_migrator(),
            /*telemetry_override*/ None,
        )
        .await
        .unwrap();
    let columns = sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info('threads') WHERE name IN ('creator_user_id', 'creator_account_id') ORDER BY name")
        .fetch_all(&opened).await.unwrap();
    assert_eq!(columns, vec!["creator_account_id", "creator_user_id"]);
    let wait_columns = sqlx::query_scalar::<_, String>("SELECT name FROM pragma_table_info('root_resume_reservations') WHERE name IN ('wait_started_at_ms', 'wait_ended_at_ms') ORDER BY name")
        .fetch_all(&opened).await.unwrap();
    assert_eq!(wait_columns, vec!["wait_ended_at_ms", "wait_started_at_ms"]);
    let applied = root_wait_history(&opened).await;
    assert_eq!(
        applied
            .iter()
            .filter(|row| row.0 == 56 || row.0 == 60)
            .map(|row| row.0)
            .collect::<Vec<_>>(),
        vec![56, 60]
    );
    opened.close().await;
    pool.close().await;
}

#[tokio::test]
async fn root_wait_legacy_56_is_reindexed_without_reapplying_sql_and_is_idempotent() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    root_wait_legacy_fixture(&pool).await;
    let before = root_wait_history(&pool).await;
    let mut expected = before.iter().find(|row| row.0 == 56).unwrap().clone();
    expected.0 = 60;
    let opened = sqlite
        .open_state_db(
            &super::runtime_state_migrator(),
            /*telemetry_override*/ None,
        )
        .await
        .unwrap();
    let after = root_wait_history(&opened).await;
    assert_eq!(after.iter().find(|row| row.0 == 60).unwrap(), &expected);
    opened.close().await;
    let reopened = sqlite
        .open_state_db(
            &super::runtime_state_migrator(),
            /*telemetry_override*/ None,
        )
        .await
        .unwrap();
    assert_eq!(root_wait_history(&reopened).await, after);
    reopened.close().await;
    pool.close().await;
}

#[tokio::test]
async fn root_wait_genuine_creator_56_remains_unchanged() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    migrator_through(/*version*/ 56).run(&pool).await.unwrap();
    let before = root_wait_history(&pool).await;
    let expected = before.iter().find(|row| row.0 == 56).unwrap();
    let opened = sqlite
        .open_state_db(
            &super::runtime_state_migrator(),
            /*telemetry_override*/ None,
        )
        .await
        .unwrap();
    let after = root_wait_history(&opened).await;
    assert_eq!(after.iter().find(|row| row.0 == 56).unwrap(), expected);
    opened.close().await;
    pool.close().await;
}

#[tokio::test]
async fn root_wait_unknown_or_unsuccessful_56_history_is_not_changed() {
    for success in [true, false] {
        let (sqlite, pool, _cleanup) = root_wait_fixture().await;
        migrator_through(/*version*/ 55).run(&pool).await.unwrap();
        let checksum = if success {
            vec![7_u8; 48]
        } else {
            STATE_MIGRATOR
                .migrations
                .iter()
                .find(|m| m.version == 60)
                .unwrap()
                .checksum
                .to_vec()
        };
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (56, 'unrecognized', ?, ?, 9)")
            .bind(success).bind(checksum).execute(&pool).await.unwrap();
        let before = root_wait_history(&pool).await;
        let result = sqlite
            .open_state_db(
                &super::runtime_state_migrator(),
                /*telemetry_override*/ None,
            )
            .await;
        assert!(result.is_err());
        assert_eq!(root_wait_history(&pool).await, before);
        pool.close().await;
    }
}

#[tokio::test]
async fn root_wait_conflicting_60_rolls_back_all_history_changes() {
    for checksum in [
        vec![9_u8; 48],
        STATE_MIGRATOR
            .migrations
            .iter()
            .find(|m| m.version == 60)
            .unwrap()
            .checksum
            .to_vec(),
    ] {
        let (sqlite, pool, _cleanup) = root_wait_fixture().await;
        root_wait_legacy_fixture(&pool).await;
        sqlx::query("INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (60, 'existing target', TRUE, ?, 17)")
            .bind(checksum).execute(&pool).await.unwrap();
        let before = root_wait_history(&pool).await;
        let result = sqlite
            .open_state_db(
                &super::runtime_state_migrator(),
                /*telemetry_override*/ None,
            )
            .await;
        assert!(
            format!("{:#}", result.unwrap_err()).contains("conflicts with existing version 60")
        );
        assert_eq!(root_wait_history(&pool).await, before);
        pool.close().await;
    }
}

#[tokio::test]
async fn root_wait_concurrent_legacy_starts_repair_and_migrate_once() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    root_wait_legacy_fixture(&pool).await;
    let first_migrator = super::runtime_state_migrator();
    let second_migrator = super::runtime_state_migrator();
    let (first, second) = tokio::join!(
        sqlite.open_state_db(&first_migrator, /*telemetry_override*/ None),
        sqlite.open_state_db(&second_migrator, /*telemetry_override*/ None),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(
        root_wait_history(&first).await,
        root_wait_history(&second).await
    );
    first.close().await;
    second.close().await;
    pool.close().await;
}

#[tokio::test]
async fn root_wait_concurrent_fresh_starts_apply_each_migration_once() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    let first_migrator = super::runtime_state_migrator();
    let second_migrator = super::runtime_state_migrator();
    let (first, second) = tokio::join!(
        sqlite.open_state_db(&first_migrator, /*telemetry_override*/ None),
        sqlite.open_state_db(&second_migrator, /*telemetry_override*/ None),
    );
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(
        root_wait_history(&first).await.len(),
        STATE_MIGRATOR.migrations.len()
    );
    first.close().await;
    second.close().await;
    pool.close().await;
}

#[tokio::test]
async fn root_wait_state_startup_future_is_send() {
    let (sqlite, pool, _cleanup) = root_wait_fixture().await;
    let opened = tokio::spawn(async move {
        let migrator = super::runtime_state_migrator();
        sqlite
            .open_state_db(&migrator, /*telemetry_override*/ None)
            .await
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        root_wait_history(&opened).await.len(),
        STATE_MIGRATOR.migrations.len()
    );
    opened.close().await;
    pool.close().await;
}
'''


def filesystem_path(path):
    """Use Win32 extended paths for IO without changing inventory identities."""
    path = Path(path)
    if os.name != "nt":
        return path
    value = os.path.abspath(path)
    if value.startswith("\\\\?\\"):
        return Path(value)
    if value.startswith("\\\\"):
        return Path("\\\\?\\UNC\\" + value[2:])
    return Path("\\\\?\\" + value)


def canonical_path(path):
    """Resolve symlinks using extended IO, then restore the ordinary identity."""
    value = str(filesystem_path(path).resolve())
    if os.name == "nt":
        if value.startswith("\\\\?\\UNC\\"):
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\"):
            value = value[4:]
    return Path(value)


def git(root, *args):
    return subprocess.check_output(
        ["git", "-c", "core.longpaths=true", "-C", str(root), *args])


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True).encode("utf-8")


def safe_path(root, name):
    root = canonical_path(root)
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or ".git" in relative.parts:
        raise ValueError(f"Unsafe source path: {name}")
    path = root / name
    if not canonical_path(path).is_relative_to(root):
        raise ValueError(f"Path escapes its root: {name}")
    return filesystem_path(path)


def describe(path, git_mode=None):
    path = filesystem_path(path)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return {"kind": "missing", "gitMode": git_mode}
    if stat.S_ISLNK(info.st_mode):
        data = os.fsencode(os.readlink(path))
        kind = "symlink"
    elif stat.S_ISREG(info.st_mode):
        data = path.read_bytes()
        kind = "git-symlink-placeholder" if git_mode == "120000" else "file"
    else:
        raise ValueError(f"Unsupported source entry: {path}")
    return {"kind": kind, "gitMode": git_mode, "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "permissions": stat.S_IMODE(info.st_mode)}


def snapshot(root):
    root = canonical_path(root)
    modes = {}
    for item in git(root, "ls-files", "--stage", "-z").split(b"\0"):
        if not item:
            continue
        metadata, raw = item.split(b"\t", 1)
        mode, _, stage = metadata.decode().split()
        name = os.fsdecode(raw)
        if stage != "0" or mode == "160000":
            raise ValueError(f"Unmerged entry or submodule requires explicit import: {name}")
        modes[name] = mode
    ignored = sorted(os.fsdecode(item).rstrip("/") for item in
                     git(root, "ls-files", "--others", "--ignored",
                         "--exclude-standard", "--directory", "-z").split(b"\0") if item)
    for name in ignored:
        if not any(name == prefix or name.startswith(prefix + "/") for prefix in EXCLUDED):
            raise ValueError(f"Ignored resource requires explicit inclusion decision: {name}")
    names = sorted(set(modes) | {os.fsdecode(item) for item in
                   git(root, "ls-files", "--others", "--exclude-standard", "-z").split(b"\0") if item})
    reserved = ("SOURCE.json", PRESERVED_IGNORE, QUEUE_ATTRIBUTES, PRESERVED_REPLAY,
                *(path + ".upstream" for path in STATE_FIX_PATHS | IDENTITY_FIX_PATHS | TOOL_POLICY_FIX_PATHS))
    if any(name in names for name in reserved):
        raise ValueError("Source already owns reserved import metadata path")
    files = {name: describe(safe_path(root, name), modes.get(name)) for name in names}
    # Nested repositories can hide source from the parent Git inventory.
    io_root = filesystem_path(root)
    for directory, children, entries in os.walk(io_root):
        relative = Path(directory).relative_to(io_root).as_posix()
        if relative != "." and (".git" in children or ".git" in entries):
            raise ValueError(f"Nested Git repository requires explicit import: {relative}")
        children[:] = [name for name in children if name != ".git" and
                       not any((Path(directory) / name).relative_to(io_root).as_posix() == prefix
                               for prefix in EXCLUDED)]
    return {"head": git(root, "rev-parse", "HEAD").decode().strip(),
            "upstreamUrl": git(root, "remote", "get-url", "origin").decode().strip(),
            "baseTag": git(root, "describe", "--tags", "--match", "rust-v*",
                           "--abbrev=0").decode().strip(),
            "files": files, "excludedIgnoredPaths": ignored}


def release_tag_commit(root, tag):
    """Resolve only an exact release tag, retaining its ref object for race checks."""
    if not isinstance(tag, str) or not tag.startswith("rust-v"):
        raise ValueError("Malformed upstream integration release tag")
    ref = "refs/tags/" + tag
    git(root, "check-ref-format", ref)
    ref_object = git(root, "show-ref", "--verify", "--hash", ref).decode().strip()
    commit = git(root, "rev-parse", "--verify", ref + "^{commit}").decode().strip()
    return commit, ref_object


def upstream_integration(root, before, target_tag):
    """Bind a reviewed applied delta to the inventory; this is not HEAD ancestry.

    The delta digest hashes canonical JSON of the exact recursive Git tree
    inventories (NUL-delimited ls-tree bytes encoded as hex). Git object IDs,
    modes and paths avoid checkout filters and diff configuration dependencies.
    This declaration does not establish conflict-free or runtime acceptance.
    """
    base_commit, base_ref = release_tag_commit(root, before["baseTag"])
    target_commit, target_ref = release_tag_commit(root, target_tag)
    git(root, "merge-base", "--is-ancestor", base_commit, before["head"])
    trees = {key: git(root, "ls-tree", "-r", "--full-tree", "-z", commit).hex()
             for key, commit in (("baseTreeHex", base_commit), ("targetTreeHex", target_commit))}
    record = {"schema": 1, "baseTag": before["baseTag"], "baseCommit": base_commit,
              "targetTag": target_tag, "targetCommit": target_commit,
              "upstreamDeltaSha256": hashlib.sha256(canonical(trees)).hexdigest(),
              "integratedInventorySha256": hashlib.sha256(canonical(before["files"])).hexdigest()}
    return record, (base_ref, target_ref)


def ensure_upstream_unchanged(source, before, pinned):
    if upstream_integration(source, before, pinned[0]["targetTag"]) != pinned:
        raise ValueError("Upstream integration tags changed; partial destination retained")


def validate_upstream_integration(receipt, digest):
    if "upstreamIntegration" not in receipt:
        return
    record = receipt["upstreamIntegration"]
    keys = {"schema", "baseTag", "baseCommit", "targetTag", "targetCommit",
            "upstreamDeltaSha256", "integratedInventorySha256"}
    if not isinstance(record, dict) or set(record) != keys or type(record.get("schema")) is not int or record["schema"] != 1:
        raise ValueError("Malformed upstream integration metadata")
    for key in ("baseTag", "targetTag"):
        tag = record[key]
        # Git's ref rules, validated without requiring a source repository.
        if (not isinstance(tag, str) or not tag.startswith("rust-v") or
                any(ord(char) < 33 or ord(char) == 127 or char in "~^:?*[\\" for char in tag) or
                ".." in tag or "@{" in tag or any(not part or part.startswith(".") or part.endswith(".lock") for part in tag.split("/")) or tag.endswith(".")):
            raise ValueError("Malformed upstream integration release tag")
    for key, length in (("baseCommit", 40), ("targetCommit", 40),
                        ("upstreamDeltaSha256", 64), ("integratedInventorySha256", 64)):
        value = record[key]
        if not isinstance(value, str) or len(value) != length or any(char not in "0123456789abcdef" for char in value):
            raise ValueError(f"Malformed upstream integration {key}")
    if record["baseTag"] != receipt.get("baseTag") or record["integratedInventorySha256"] != digest:
        raise ValueError("Upstream integration inventory or base tag differs")


def adaptation_record(original):
    return {"originalPath": ".gitignore", "preservedPath": PRESERVED_IGNORE,
            "originalSha256": hashlib.sha256(original).hexdigest(), "originalSize": len(original),
            "adaptedSha256": hashlib.sha256(original + IGNORE_SUFFIX).hexdigest(),
            "adaptedSize": len(original + IGNORE_SUFFIX)}


def apply_distribution_adaptation(destination, files):
    entry = files.get(".gitignore")
    if entry is None or entry["kind"] == "missing":
        return None
    if entry["kind"] != "file":
        raise ValueError("Distribution adaptation requires a regular original .gitignore")
    original_path = safe_path(destination, ".gitignore")
    if describe(original_path, entry["gitMode"]) != entry:
        raise ValueError("Original .gitignore differs before distribution adaptation")
    original = original_path.read_bytes()
    preserved = safe_path(destination, PRESERVED_IGNORE)
    with preserved.open("xb") as output:
        output.write(original)
    shutil.copystat(original_path, preserved, follow_symlinks=False)
    original_path.write_bytes(original + IGNORE_SUFFIX)
    return adaptation_record(original)


def distribution_files_record():
    return {QUEUE_ATTRIBUTES: {"sha256": hashlib.sha256(QUEUE_ATTRIBUTE_BYTES).hexdigest(),
                               "size": len(QUEUE_ATTRIBUTE_BYTES)}}


def apply_distribution_files(destination, files):
    migration = files.get(QUEUE_MIGRATION)
    if migration is None or migration["kind"] == "missing":
        return None
    if QUEUE_ATTRIBUTES in files:
        raise ValueError("Original source owns the reserved queue attribute overlay")
    with safe_path(destination, QUEUE_ATTRIBUTES).open("xb") as output:
        output.write(QUEUE_ATTRIBUTE_BYTES)
    return distribution_files_record()


def replay_fix_bytes(original):
    """Apply only the two uniquely anchored Turn field insertions, preserving EOL."""
    for newline in (b"\n", b"\r\n"):
        anchors = []
        for indent, closing in ((b"                ", b"            } = turn;"),
                                (b"                            ", b"                        },")):
            old = indent + b"completed_at," + newline + indent + b"duration_ms," + newline + closing
            new = old.replace(indent + b"duration_ms," + newline,
                              indent + b"duration_ms," + newline + indent + b"root_resume_wait," + newline)
            anchors.append((old, new))
        if all(original.count(new) == 1 and original.count(old) == 0 for old, new in anchors):
            return original
        if all(original.count(old) == 1 and original.count(new) == 0 for old, new in anchors):
            fixed = original
            for old, new in anchors:
                fixed = fixed.replace(old, new, 1)
            return fixed
    raise ValueError("Replay compile-fix anchors are missing, partial or ambiguous")


def known_source_fix(original_path, original):
    if original_path == TOOL_POLICY_FIX_PATH:
        newline = b"\r\n" if b"\r\n" in original else b"\n"
        anchor = b'                "run_size_macro",' + newline
        tools = ("list_windows", "select_window", "inspect", "press_key", "list_task_macros", "save_task_macro", "run_task_macro")
        if original.count(anchor) != 1 or any(('"' + tool + '"').encode() in original for tool in tools):
            raise ValueError("Window control policy anchor is missing or already adapted")
        addition = b"".join(('                "' + tool + '",').encode() + newline for tool in tools)
        return original_path, original.replace(anchor, anchor + addition, 1), "Expose installed window-control inspection, keyboard and task macro tools through the extension policy"
    if original_path in IDENTITY_FIX_PATHS:
        newline = b"\r\n" if b"\r\n" in original else b"\n"
        if original_path in IDENTITY_TEMPLATE_PATHS:
            adapted = original
            for intro in CODEX_IDENTITY_INTROS:
                adapted = adapted.replace(intro.encode(), AZRAEL_IDENTITY.encode())
            if adapted == original:
                raise ValueError("Harness identity template has no known introduction")
        elif original_path == IDENTITY_LIB_PATH:
            if b"fn with_azrael_harness_identity" in original:
                raise ValueError("Harness identity helper already exists")
            adapted = original + IDENTITY_RUST.encode().replace(b"\n", newline)
        else:
            old = IDENTITY_SESSION_OLD.encode().replace(b"\n", newline)
            new = IDENTITY_SESSION_NEW.encode().replace(b"\n", newline)
            if original.count(old) != 1 or b"with_azrael_harness_identity" in original:
                raise ValueError("Harness identity session anchor is missing or ambiguous")
            adapted = original.replace(old, new, 1)
        return original_path, adapted, IDENTITY_FIX_REASON
    if original_path == REPLAY_PATH:
        return original_path, replay_fix_bytes(original), REPLAY_FIX_REASON
    if original_path == ROOT_WAIT_OLD:
        expected = (b"ALTER TABLE root_resume_reservations ADD COLUMN wait_started_at_ms INTEGER;\n"
                    b"ALTER TABLE root_resume_reservations ADD COLUMN wait_ended_at_ms INTEGER;\n")
        if original.replace(b"\r\n", b"\n") != expected:
            raise ValueError("Root-wait SQL is not the known two-column migration")
        return ROOT_WAIT_NEW, original, STATE_FIX_REASON
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    if original_path == STATE_REPAIR_PATH:
        marker = b"#[cfg(test)]"
        insertion = STATE_REPAIR_RUST.encode().replace(b"\n", newline) + newline
        if original.count(marker) != 1 or b"fn repair_legacy_root_wait_migration_version" in original:
            raise ValueError("State migration repair anchor is missing or already changed")
        return original_path, original.replace(marker, insertion + marker, 1), STATE_FIX_REASON
    if original_path == STATE_SQLITE_PATH:
        old = STATE_SQLITE_OLD.encode().replace(b"\n", newline)
        new = STATE_SQLITE_NEW.encode().replace(b"\n", newline)
        if original.count(old) != 1 or original.count(new):
            raise ValueError("State startup migration anchor is missing or ambiguous")
        return original_path, original.replace(old, new, 1), STATE_FIX_REASON
    if original_path == STATE_TESTS_PATH:
        if b"async fn root_wait_fixture" in original:
            raise ValueError("Root-wait migration tests already exist")
        return original_path, original + newline + STATE_TESTS_RUST.encode().replace(b"\n", newline), STATE_FIX_REASON
    raise ValueError("Unsupported source-fix path")


def source_fixes_record(original, original_path=REPLAY_PATH):
    adapted_path, adapted, reason = known_source_fix(original_path, original)
    if adapted == original:
        if adapted_path == original_path:
            raise ValueError("Source fix is not required for these original bytes")
    return {original_path: {"originalPath": original_path, "adaptedPath": adapted_path,
                         "preservedPath": original_path + ".upstream", "reason": reason,
                         "originalSha256": hashlib.sha256(original).hexdigest(), "originalSize": len(original),
                         "adaptedSha256": hashlib.sha256(adapted).hexdigest(), "adaptedSize": len(adapted)}}


def apply_source_fixes(destination, files):
    entry = files.get(REPLAY_PATH)
    if entry is None or entry["kind"] == "missing":
        return None
    if entry["kind"] != "file" or PRESERVED_REPLAY in files:
        raise ValueError("Replay source fix requires its regular original source")
    path = safe_path(destination, REPLAY_PATH)
    if describe(path, entry["gitMode"]) != entry:
        raise ValueError("Original replay source differs before compile correction")
    original = path.read_bytes()
    adapted = replay_fix_bytes(original)
    if adapted == original:
        return None
    preserved = safe_path(destination, PRESERVED_REPLAY)
    with preserved.open("xb") as output:
        output.write(original)
    shutil.copystat(path, preserved, follow_symlinks=False)
    path.write_bytes(adapted)
    return source_fixes_record(original)


def apply_state_source_fixes(destination, files):
    migration = files.get(ROOT_WAIT_OLD)
    if migration is None or migration["kind"] == "missing":
        return None
    plans = []
    records = {}
    for original_path in sorted(STATE_FIX_PATHS):
        entry = files.get(original_path)
        if not entry or entry["kind"] != "file" or original_path + ".upstream" in files:
            raise ValueError("State migration correction requires all four regular original files")
        path = safe_path(destination, original_path)
        if describe(path, entry["gitMode"]) != entry:
            raise ValueError(f"Original state source differs before correction: {original_path}")
        original = path.read_bytes()
        adapted_path, adapted, _ = known_source_fix(original_path, original)
        preserved = safe_path(destination, original_path + ".upstream")
        if preserved.exists() or adapted_path != original_path and safe_path(destination, adapted_path).exists():
            raise ValueError("State migration correction would overwrite an existing file")
        plans.append((path, preserved, safe_path(destination, adapted_path), original, adapted))
        records.update(source_fixes_record(original, original_path))
    for path, preserved, adapted_path, original, adapted in plans:
        with preserved.open("xb") as output:
            output.write(original)
        shutil.copystat(path, preserved, follow_symlinks=False)
        if adapted_path != path:
            path.rename(adapted_path)
        else:
            path.write_bytes(adapted)
    return records


def apply_identity_source_fixes(destination, files):
    records = {}
    plans = []
    for original_path in sorted((IDENTITY_FIX_PATHS | TOOL_POLICY_FIX_PATHS) & files.keys()):
        entry = files[original_path]
        if entry["kind"] == "missing":
            continue
        if entry["kind"] != "file" or original_path + ".upstream" in files:
            raise ValueError("Harness identity adaptation requires regular original files")
        path = safe_path(destination, original_path)
        if describe(path, entry["gitMode"]) != entry:
            raise ValueError(f"Original identity source differs: {original_path}")
        original = path.read_bytes()
        _, adapted, _ = known_source_fix(original_path, original)
        preserved = safe_path(destination, original_path + ".upstream")
        if preserved.exists():
            raise ValueError("Harness identity adaptation would overwrite preserved source")
        plans.append((path, preserved, original, adapted))
        records.update(source_fixes_record(original, original_path))
    for path, preserved, original, adapted in plans:
        with preserved.open("xb") as output:
            output.write(original)
        shutil.copystat(path, preserved, follow_symlinks=False)
        path.write_bytes(adapted)
    return records or None


def verify_destination(destination, files, has_receipt=False, allow_build_caches=False, adaptation=None, distribution_files=None, source_fixes=None):
    destination = filesystem_path(destination)
    actual = set()
    for directory, children, entries in os.walk(destination, followlinks=False):
        if allow_build_caches:
            children[:] = [name for name in children if (Path(directory) / name).is_symlink() or
                           (Path(directory) / name).relative_to(destination).as_posix() not in EXCLUDED]
        for name in entries + [name for name in children if (Path(directory) / name).is_symlink()]:
            actual.add((Path(directory) / name).relative_to(destination).as_posix())
    expected = {name for name, entry in files.items() if entry["kind"] != "missing"}
    if source_fixes is not None:
        if not isinstance(source_fixes, dict) or not source_fixes or not set(source_fixes).issubset({REPLAY_PATH} | STATE_FIX_PATHS | IDENTITY_FIX_PATHS | TOOL_POLICY_FIX_PATHS):
            raise ValueError("Malformed source fixes: only the fixed replay/state/identity/tool-policy corrections are supported")
        state_keys = set(source_fixes) & STATE_FIX_PATHS
        if state_keys and state_keys != STATE_FIX_PATHS:
            raise ValueError("State source corrections must include the complete fixed migration recipe")
        for original_path, fix in source_fixes.items():
            entry = files.get(original_path)
            if not entry or entry["kind"] != "file" or original_path + ".upstream" in files:
                raise ValueError("Source correction has no regular original inventory entry")
            preserved = safe_path(destination, original_path + ".upstream")
            if preserved.is_symlink():
                raise ValueError("Preserved source must be a regular file")
            original = preserved.read_bytes()
            if fix != source_fixes_record(original, original_path)[original_path]:
                raise ValueError("Replay/state/identity source-fix metadata differs")
            adapted_path, adapted_bytes, _ = known_source_fix(original_path, original)
            adapted = safe_path(destination, adapted_path)
            if adapted.is_symlink() or adapted.read_bytes() != adapted_bytes:
                raise ValueError("Adapted source differs from the fixed compile correction")
            expected.discard(original_path)
            expected.update((adapted_path, original_path + ".upstream"))
    if distribution_files is not None:
        migration = files.get(QUEUE_MIGRATION)
        if distribution_files != distribution_files_record() or not migration or migration["kind"] == "missing" or QUEUE_ATTRIBUTES in files:
            raise ValueError("Malformed distribution files: only the fixed queue attribute overlay is supported")
        overlay = safe_path(destination, QUEUE_ATTRIBUTES)
        if overlay.is_symlink() or overlay.read_bytes() != QUEUE_ATTRIBUTE_BYTES:
            raise ValueError("Queue distribution attribute overlay differs")
        expected.add(QUEUE_ATTRIBUTES)
    if adaptation is not None:
        if not isinstance(adaptation, dict) or adaptation.get("originalPath") != ".gitignore" or adaptation.get("preservedPath") != PRESERVED_IGNORE:
            raise ValueError("Malformed distribution adaptation paths")
        entry = files.get(".gitignore")
        if not entry or entry["kind"] != "file" or PRESERVED_IGNORE in files:
            raise ValueError("Distribution adaptation has no regular original .gitignore")
        preserved = safe_path(destination, PRESERVED_IGNORE)
        if preserved.is_symlink():
            raise ValueError("Preserved original .gitignore must be a regular file")
        original = preserved.read_bytes()
        if adaptation != adaptation_record(original):
            raise ValueError("Distribution adaptation metadata differs")
        adapted = safe_path(destination, ".gitignore")
        if adapted.is_symlink() or adapted.read_bytes() != original + IGNORE_SUFFIX:
            raise ValueError("Adapted .gitignore differs from the fixed distribution suffix")
        expected.add(PRESERVED_IGNORE)
    if has_receipt:
        actual.discard("SOURCE.json")
    if actual != expected:
        raise ValueError(f"Destination coverage differs: extra={sorted(actual - expected)}, missing={sorted(expected - actual)}")
    for name, entry in files.items():
        stored_name = PRESERVED_IGNORE if name == ".gitignore" and adaptation is not None else name
        if source_fixes is not None and name in source_fixes:
            stored_name = name + ".upstream"
        if describe(safe_path(destination, stored_name), entry["gitMode"]) != entry:
            raise ValueError(f"Copied source differs: {name}")


def validate_receipt(destination, receipt, allow_build_caches=False):
    """Validate an imported inventory without consulting a surrounding Git repo."""
    if not isinstance(receipt, dict) or type(receipt.get("schema")) is not int or receipt["schema"] != 1:
        raise ValueError("Unsupported imported source receipt schema")
    entries = receipt.get("files")
    if not isinstance(entries, dict) or not entries:
        raise ValueError("Imported source receipt has no file inventory")
    queue = entries.get(QUEUE_MIGRATION)
    if isinstance(queue, dict) and queue.get("kind") != "missing" and receipt.get("distributionFiles") is None:
        raise ValueError("Missing required queue distribution attribute overlay metadata")
    if any(key.startswith("distribution") and key not in ("distributionAdaptation", "distributionFiles") for key in receipt):
        raise ValueError("Unexpected distribution metadata")
    for name, entry in entries.items():
        if not isinstance(name, str) or not name or "\\" in name or ":" in name or PurePosixPath(name).as_posix() != name:
            raise ValueError("Imported source receipt has a malformed path")
        safe_path(destination, name)
        if name in ("SOURCE.json", PRESERVED_IGNORE, QUEUE_ATTRIBUTES, PRESERVED_REPLAY, *(path + ".upstream" for path in STATE_FIX_PATHS | IDENTITY_FIX_PATHS | TOOL_POLICY_FIX_PATHS)) or any(name == prefix or name.startswith(prefix + "/") for prefix in EXCLUDED):
            raise ValueError(f"Imported inventory claims metadata or build cache: {name}")
        if not isinstance(entry, dict) or entry.get("kind") not in ("missing", "file", "symlink", "git-symlink-placeholder"):
            raise ValueError(f"Malformed imported inventory entry: {name}")
        if entry.get("gitMode") not in (None, "100644", "100755", "120000"):
            raise ValueError(f"Malformed imported Git mode: {name}")
        if entry["kind"] != "missing":
            digest = entry.get("sha256")
            if not isinstance(digest, str) or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
                raise ValueError(f"Malformed imported hash: {name}")
            if type(entry.get("size")) is not int or entry["size"] < 0 or type(entry.get("permissions")) is not int:
                raise ValueError(f"Malformed imported file metadata: {name}")
    head = receipt.get("head")
    if not isinstance(head, str) or len(head) != 40 or any(char not in "0123456789abcdef" for char in head):
        raise ValueError("Malformed imported source HEAD")
    digest = hashlib.sha256(canonical(entries)).hexdigest()
    if receipt.get("inventorySha256") != digest:
        raise ValueError("Source receipt inventory digest differs")
    validate_upstream_integration(receipt, digest)
    missing = [name for name, entry in entries.items() if entry["kind"] == "missing"]
    expected = {"missingTrackedPaths": missing, "fileCount": len(entries) - len(missing),
                "inventoryCount": len(entries), "byteCount": sum(entry.get("size", 0) for entry in entries.values()),
                "coverageVerified": True}
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ValueError("Source receipt coverage totals differ")
    verify_destination(destination, entries, has_receipt=True, allow_build_caches=allow_build_caches,
                       adaptation=receipt.get("distributionAdaptation"), distribution_files=receipt.get("distributionFiles"),
                       source_fixes=receipt.get("sourceFixes"))
    return digest


def ensure_unchanged(source, before, phase):
    after = snapshot(source)
    if after != before:
        paths = sorted(name for name in set(before["files"]) | set(after["files"])
                       if before["files"].get(name) != after["files"].get(name))
        metadata = [key for key in before if key != "files" and before[key] != after[key]]
        raise ValueError(f"Source changed during {phase}; changed paths={paths}; "
                         f"changed metadata={metadata}; partial destination retained")


def check_source(source, destination, snapshot_only=False):
    source, destination = canonical_path(source), canonical_path(destination)
    receipt = json.loads(safe_path(destination, "SOURCE.json").read_text(encoding="utf-8"))
    if snapshot_only:
        before = {key: receipt[key] for key in ("head", "upstreamUrl", "baseTag", "files", "excludedIgnoredPaths")}
    else:
        before = snapshot(source)
        for key, value in before.items():
            if receipt.get(key) != value:
                raise ValueError(f"Imported source receipt differs from latest source: {key}")
    digest = validate_receipt(destination, receipt, allow_build_caches=True)
    if not snapshot_only:
        pinned = None
        if "upstreamIntegration" in receipt:
            pinned = upstream_integration(source, before, receipt["upstreamIntegration"]["targetTag"])
            if pinned[0] != receipt["upstreamIntegration"]:
                raise ValueError("Upstream integration differs from source Git tags or delta")
        ensure_unchanged(source, before, "check")
        if pinned is not None:
            ensure_upstream_unchanged(source, before, pinned)
    print(json.dumps({"coverageVerified": True, "head": before["head"],
                      "inventorySha256": digest, "fileCount": receipt["fileCount"],
                      "byteCount": receipt["byteCount"],
                      "verificationScope": "immutable-snapshot" if snapshot_only else "latest-source"}, indent=2))


def import_source(source, destination, allow_source_advance=False, upstream_tag=None):
    source, destination = canonical_path(source), canonical_path(destination)
    if source == destination or source.is_relative_to(destination) or destination.is_relative_to(source):
        raise ValueError("Source and destination must not overlap")
    if not filesystem_path(source).is_dir() or canonical_path(git(source, "rev-parse", "--show-toplevel").decode().strip()) != source:
        raise ValueError("Source must be a Git worktree root")
    io_destination = filesystem_path(destination)
    if io_destination.exists() and (not io_destination.is_dir() or any(io_destination.iterdir())):
        raise ValueError("Destination must be absent or empty")
    captured_utc = datetime.now(timezone.utc).isoformat()
    before = snapshot(source)
    pinned = upstream_integration(source, before, upstream_tag) if upstream_tag is not None else None
    io_destination.mkdir(parents=True, exist_ok=True)
    for name, entry in before["files"].items():
        if entry["kind"] == "missing":
            continue
        origin, target = safe_path(source, name), safe_path(destination, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            raise ValueError(f"Destination changed concurrently: {name}")
        if entry["kind"] == "symlink":
            os.symlink(os.readlink(origin), target)
        else:
            # Exclusive creation protects other writers; copy bytes without Git filters.
            with origin.open("rb") as reader, target.open("xb") as writer:
                shutil.copyfileobj(reader, writer)
            shutil.copystat(origin, target, follow_symlinks=False)
    if not allow_source_advance:
        ensure_unchanged(source, before, "import")
    verify_destination(destination, before["files"])
    if not allow_source_advance:
        ensure_unchanged(source, before, "verification")
    after = snapshot(source) if allow_source_advance else before
    changed_paths = sorted(name for name in set(before["files"]) | set(after["files"])
                           if before["files"].get(name) != after["files"].get(name))
    entries = before["files"]
    missing = [name for name, entry in entries.items() if entry["kind"] == "missing"]
    record = {"schema": 1, **before, "inventorySha256": hashlib.sha256(canonical(entries)).hexdigest(),
              "missingTrackedPaths": missing, "fileCount": len(entries) - len(missing),
              "inventoryCount": len(entries), "byteCount": sum(entry.get("size", 0) for entry in entries.values()),
              "copyPolicy": "current filesystem bytes; Git symlink placeholders retained with mode metadata",
              "coverageVerified": True, "snapshotCapturedUtc": captured_utc,
              "acceptancePolicy": "immutable-snapshot" if allow_source_advance else "latest-source",
              "sourceAdvancedAfterSnapshot": after != before,
              "sourceAdvanceChangedPaths": changed_paths,
              "sourceAdvanceChangedMetadata": [key for key in before if key != "files" and before[key] != after[key]]}
    if pinned is not None:
        record["upstreamIntegration"] = pinned[0]
    adaptation = apply_distribution_adaptation(destination, entries)
    if adaptation is not None:
        record["distributionAdaptation"] = adaptation
    distribution_files = apply_distribution_files(destination, entries)
    if distribution_files is not None:
        record["distributionFiles"] = distribution_files
    source_fixes = apply_source_fixes(destination, entries)
    state_fixes = apply_state_source_fixes(destination, entries)
    if state_fixes:
        source_fixes = {**(source_fixes or {}), **state_fixes}
    identity_fixes = apply_identity_source_fixes(destination, entries)
    if identity_fixes:
        source_fixes = {**(source_fixes or {}), **identity_fixes}
    if source_fixes is not None:
        record["sourceFixes"] = source_fixes
    verify_destination(destination, entries, adaptation=adaptation, distribution_files=distribution_files, source_fixes=source_fixes)
    if pinned is not None:
        ensure_upstream_unchanged(source, before, pinned)
    with safe_path(destination, "SOURCE.json").open("x", encoding="utf-8", newline="\n") as output:
        json.dump(record, output, indent=2, sort_keys=True)
        output.write("\n")
    sql = {name: {"sha256": entry["sha256"],
                  "distributionPath": (source_fixes or {}).get(name, {}).get("adaptedPath", name),
                  "sha384": hashlib.sha384(safe_path(destination, (source_fixes or {}).get(name, {}).get("adaptedPath", name)).read_bytes()).hexdigest(),
                  "containsCRLF": b"\r\n" in safe_path(destination, (source_fixes or {}).get(name, {}).get("adaptedPath", name)).read_bytes()}
           for name, entry in entries.items() if entry["kind"] != "missing" and name.endswith(".sql") and
           ("/migrations/" in name or "/thread_history_migrations/" in name)}
    print(json.dumps({"head": record["head"], "inventorySha256": record["inventorySha256"],
                      "fileCount": record["fileCount"], "byteCount": record["byteCount"],
                      "missingTrackedPaths": missing, "coverageVerified": True,
                      "snapshotCapturedUtc": captured_utc,
                      "acceptancePolicy": record["acceptancePolicy"],
                      "sourceAdvancedAfterSnapshot": record["sourceAdvancedAfterSnapshot"],
                      "sourceAdvanceChangedPaths": changed_paths,
                      "retainedLegalPaths": [name for name in entries if Path(name).name in ("LICENSE", "NOTICE")],
                      "migrationBytes": sql}, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Explicit source checkout; required except for --check --snapshot-only")
    parser.add_argument("--destination", type=Path, default=PROJECT / "engine")
    parser.add_argument("--check", action="store_true", help="Verify an existing import against latest source without copying")
    parser.add_argument("--snapshot-only", action="store_true", help="With --check, verify only the immutable recorded snapshot")
    parser.add_argument("--allow-source-advance", action="store_true", help="Accept verified before-inventory bytes even if original source later advances")
    parser.add_argument("--upstream-tag", help="Declare a reviewed applied upstream release delta, distinct from HEAD ancestry and runtime acceptance")
    args = parser.parse_args()
    if args.snapshot_only and not args.check:
        parser.error("--snapshot-only requires --check")
    if args.upstream_tag is not None and args.check:
        parser.error("--upstream-tag is only used when creating an import")
    if args.source is None and not (args.check and args.snapshot_only):
        parser.error("--source is required except for --check --snapshot-only")
    if args.check:
        check_source(args.source or args.destination, args.destination, snapshot_only=args.snapshot_only)
    else:
        import_source(args.source, args.destination, allow_source_advance=args.allow_source_advance, upstream_tag=args.upstream_tag)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"Import failed: {error}", file=sys.stderr)
        sys.exit(1)
