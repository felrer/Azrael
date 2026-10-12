#!/usr/bin/env python3
"""Import native Codex history into an independent Azrael home, never sharing writes."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

HISTORY_TABLES = ('thread_turns', 'thread_items', 'thread_realtime_items',
                  'thread_history_projection_state')


def connect(path, readonly=False):
    return sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=60) if readonly else sqlite3.connect(path, timeout=60)


def snapshot(source, destination):
    with connect(source, True) as src, connect(destination) as dst:
        src.backup(dst, pages=4096, sleep=0.1)
    destination.chmod(0o600)


def columns(db, table, schema='main'):
    return [r[1] for r in db.execute(f'PRAGMA {schema}.table_info("{table}")')]


def merge(db, table, where='1'):
    common = [c for c in columns(db, table) if c in columns(db, table, 'incoming')]
    if not common:
        return
    names = ','.join('"'+c+'"' for c in common)
    db.execute(f'INSERT OR IGNORE INTO "{table}" ({names}) SELECT {names} FROM incoming."{table}" WHERE {where}')


def active_engine(target):
    # Existing Azrael engines may own open rollout writers. Only add new threads then.
    for proc in Path('/proc').glob('[0-9]*'):
        try:
            if (proc/'comm').read_text().strip() != 'codex':
                continue
            env = (proc/'environ').read_bytes().split(b'\0')
            if ('CODEX_HOME='+str(target)).encode() in env:
                return True
        except FileNotFoundError:
            continue
        except PermissionError:
            return True
    return False


def run(source, target, templates):
    source, target, templates = source.resolve(), target.resolve(), templates.resolve()
    if source == target or source in target.parents or target in source.parents:
        raise ValueError('History homes must be separate')
    if not (source/'state_5.sqlite').is_file():
        return dict(schema=1, imported=0, refreshed=0, sourceMissing=True)
    target.mkdir(parents=True, exist_ok=True)
    with (target/'.local-history.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix='.local-history-', dir=target) as raw:
            stage = Path(raw)
            snapshot(source/'state_5.sqlite', stage/'state.sqlite')
            for name in ('state_5.sqlite', 'thread_history_1.sqlite'):
                if not (target/name).exists():
                    snapshot(templates/name, stage/name)
                    (stage/name).replace(target/name)
            with connect(target/'state_5.sqlite') as db, connect(stage/'state.sqlite', True) as src:
                db.execute('CREATE TABLE IF NOT EXISTS azrael_local_history_imports (id TEXT PRIMARY KEY, source_stamp TEXT NOT NULL, target_size INTEGER NOT NULL, target_mtime INTEGER NOT NULL, updated_at_ms INTEGER)')
                if columns(db, 'azrael_local_history_pending') and sum(r[5] > 0 for r in db.execute('PRAGMA table_info(azrael_local_history_pending)')) == 1:
                    db.execute('ALTER TABLE azrael_local_history_pending RENAME TO azrael_local_history_pending_legacy')
                db.execute('CREATE TABLE IF NOT EXISTS azrael_local_history_pending (id TEXT NOT NULL, target_size INTEGER NOT NULL, target_mtime INTEGER NOT NULL, PRIMARY KEY(id,target_size,target_mtime))')
                if columns(db, 'azrael_local_history_pending_legacy'):
                    db.execute('INSERT OR IGNORE INTO azrael_local_history_pending SELECT * FROM azrael_local_history_pending_legacy')
                    db.execute('DROP TABLE azrael_local_history_pending_legacy')
                db.commit()
                db.row_factory = sqlite3.Row
                src.row_factory = sqlite3.Row
                existing = {r['id']: dict(r) for r in db.execute('SELECT id,updated_at_ms,rollout_path FROM threads')}
                owned = {r['id']: dict(r) for r in db.execute('SELECT * FROM azrael_local_history_imports')}
                pending = {}
                for record in db.execute('SELECT * FROM azrael_local_history_pending'):
                    pending.setdefault(record['id'], []).append(dict(record))
                running = active_engine(target)
                selected, missing, preserved = [], 0, 0
                referenced = set()
                for row in src.execute('SELECT * FROM threads'):
                    row = dict(row)
                    original = Path(row['rollout_path'])
                    referenced.add(original)
                    try:
                        relative = original.relative_to(source)
                        if relative.parts[0] not in ('sessions', 'archived_sessions', 'agents') or original.is_symlink():
                            raise ValueError('Unsupported rollout subtree')
                        info = original.stat()
                    except (ValueError, FileNotFoundError):
                        missing += 1
                        continue
                    if original.resolve() != original or not original.is_file():
                        raise ValueError('Rollout must be a regular source-owned file')
                    destination = target/relative
                    stamp = json.dumps([info.st_size, info.st_mtime_ns, row], sort_keys=True, separators=(',', ':'))
                    old, record = existing.get(row['id']), owned.get(row['id'])
                    if old:
                        if not record or running or record['source_stamp'] == stamp:
                            preserved += 1
                            continue
                        try:
                            current = destination.stat()
                            safe = (old['rollout_path'] == str(destination) and not destination.is_symlink()
                                    and any(current.st_size == item['target_size'] and current.st_mtime_ns == item['target_mtime']
                                            for item in (record, *pending.get(row['id'], [])))
                                    and old['updated_at_ms'] == record['updated_at_ms'])
                        except FileNotFoundError:
                            safe = False
                        if not safe:
                            preserved += 1
                            continue
                    elif destination.exists():
                        if destination.is_symlink():
                            raise ValueError('Refusing a linked destination')
                        # Only our recorded file generation can belong to an interrupted import.
                        current = destination.stat()
                        if not destination.is_file() or not any(
                                current.st_size == item['target_size'] and current.st_mtime_ns == item['target_mtime']
                                for item in pending.get(row['id'], [])):
                            preserved += 1
                            continue
                    selected.append((row, original, destination, stamp, bool(old)))
                orphans = []
                for subtree in ('sessions', 'archived_sessions', 'agents'):
                    for original in (source/subtree).rglob('*.jsonl'):
                        destination = target/original.relative_to(source)
                        pending_id = 'orphan:'+str(original.relative_to(source))
                        eligible = not destination.exists()
                        if not eligible and pending_id in pending and not destination.is_symlink():
                            current = destination.stat()
                            eligible = any(current.st_size == item['target_size'] and current.st_mtime_ns == item['target_mtime'] for item in pending[pending_id])
                        if original not in referenced and eligible:
                            if original.is_symlink() or original.resolve() != original:
                                raise ValueError('Linked source rollout')
                            orphans.append((original, destination))
                if not selected and not orphans:
                    return dict(schema=1, imported=0, refreshed=0, preserved=preserved, missingRollouts=missing, engineActive=running)
                # Snapshot projections before growing source rollouts are copied: offsets cannot get ahead.
                history = source/'thread_history_1.sqlite'
                if history.exists():
                    snapshot(history, stage/'history.sqlite')
                backup = target/'local-history-backup'
                backup.mkdir(mode=0o700, exist_ok=True)
                if not (backup/'state_5.sqlite').exists():
                    snapshot(target/'state_5.sqlite', backup/'state_5.sqlite')
                sizes = {}
                for number, (row, original, destination, stamp, refresh) in enumerate(selected):
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if destination.parent.resolve() != destination.parent:
                        raise ValueError('Linked target subtree')
                    copied = stage/f'rollout-{number}.jsonl'
                    subprocess.run(['cp', '--reflink=auto', '--', str(original), str(copied)], check=True)
                    copied.chmod(0o600)
                    # The engine uses the filename UUID for reverted rollout projection keys.
                    projection_id = original.stem[-36:]
                    if (stage/'history.sqlite').exists():
                        with connect(stage/'history.sqlite', True) as hist:
                            offset = hist.execute('SELECT next_rollout_byte_offset FROM thread_history_projection_state WHERE thread_id=?', (projection_id,)).fetchone()
                            if offset and offset[0] > copied.stat().st_size:
                                raise ValueError('Projection exceeds copied rollout; retry snapshot')
                    info = copied.stat()
                    db.execute('INSERT OR IGNORE INTO azrael_local_history_pending VALUES (?,?,?)',
                               (row['id'], info.st_size, info.st_mtime_ns))
                    db.commit()
                    copied.replace(destination)
                    sizes[row['id']] = destination.stat()
                    print(json.dumps(dict(phase='copy', complete=number+1, total=len(selected))), flush=True)
                for number, (original, destination) in enumerate(orphans):
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if destination.parent.resolve() != destination.parent:
                        raise ValueError('Linked target subtree')
                    copied = stage/f'orphan-{number}.jsonl'
                    subprocess.run(['cp', '--reflink=auto', '--', str(original), str(copied)], check=True)
                    copied.chmod(0o600)
                    info = copied.stat()
                    db.execute('INSERT OR IGNORE INTO azrael_local_history_pending VALUES (?,?,?)',
                               ('orphan:'+str(original.relative_to(source)), info.st_size, info.st_mtime_ns))
                    db.commit()
                    copied.replace(destination)
                if (stage/'history.sqlite').exists():
                    with connect(target/'thread_history_1.sqlite') as hist:
                        hist.execute('ATTACH DATABASE ? AS incoming', ((stage/'history.sqlite').as_uri()+'?mode=ro',))
                        hist.execute('CREATE TEMP TABLE imported_ids (id TEXT PRIMARY KEY)')
                        ids = {(r['id'],) for r, *_ in selected} | {(p.stem[-36:],) for _, p, *_ in selected} | {(p.stem[-36:],) for p, _ in orphans}
                        hist.executemany('INSERT INTO imported_ids VALUES (?)', sorted(ids))
                        for table in HISTORY_TABLES:
                            hist.execute(f'DELETE FROM "{table}" WHERE thread_id IN (SELECT id FROM imported_ids)')
                            merge(hist, table, 'thread_id IN (SELECT id FROM imported_ids)')
                db.execute('ATTACH DATABASE ? AS incoming', ((stage/'state.sqlite').as_uri()+'?mode=ro',))
                for table in ('projects', 'project_roots', 'project_idempotency_keys', 'thread_sections'):
                    merge(db, table)
                common = [c for c in columns(db, 'threads') if c in columns(db, 'threads', 'incoming')]
                names = ','.join('"'+c+'"' for c in common)
                for row, original, destination, stamp, refresh in selected:
                    row['rollout_path'] = str(destination)
                    if refresh:
                        assignments = ','.join('"'+c+'"=?' for c in common if c != 'id')
                        db.execute(f'UPDATE threads SET {assignments} WHERE id=?', [row[c] for c in common if c != 'id']+[row['id']])
                    else:
                        db.execute(f'INSERT INTO threads ({names}) VALUES ({",".join("?" for _ in common)})', [row[c] for c in common])
                    info = sizes[row['id']]
                    db.execute('INSERT OR REPLACE INTO azrael_local_history_imports VALUES (?,?,?,?,?)',
                               (row['id'], stamp, info.st_size, info.st_mtime_ns, row['updated_at_ms']))
                    db.execute('DELETE FROM azrael_local_history_pending WHERE id=?', (row['id'],))
                db.execute('CREATE TEMP TABLE imported_ids (id TEXT PRIMARY KEY)')
                db.executemany('INSERT INTO imported_ids VALUES (?)', [(r['id'],) for r, *_ in selected])
                for table in ('thread_dynamic_tools', 'thread_spawn_edges', 'thread_attachments'):
                    key = 'child_thread_id' if table == 'thread_spawn_edges' else 'thread_id'
                    merge(db, table, f'{key} IN (SELECT id FROM imported_ids)')
                for original, _ in orphans:
                    db.execute('DELETE FROM azrael_local_history_pending WHERE id=?', ('orphan:'+str(original.relative_to(source)),))
                result = dict(schema=1, imported=sum(not r[-1] for r in selected), refreshed=sum(r[-1] for r in selected),
                              preserved=preserved, missingRollouts=missing, engineActive=running,
                              unindexedRollouts=len(orphans),
                              bytesCopied=sum(s.st_size for s in sizes.values())+sum(p.stat().st_size for _, p in orphans), at=int(time.time()))
            receipt = target/'local-history-import.json'
            temporary = stage/'receipt.json'
            temporary.write_text(json.dumps(result, indent=2)+'\n')
            temporary.chmod(0o600)
            temporary.replace(receipt)
            return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--templates', type=Path, default=Path(__file__).resolve().parent/'local-history-templates')
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.source, args.target, args.templates)), flush=True)
    except (OSError, ValueError, sqlite3.Error, subprocess.CalledProcessError) as error:
        print(json.dumps(dict(error=type(error).__name__)), flush=True)
        raise SystemExit(1)
