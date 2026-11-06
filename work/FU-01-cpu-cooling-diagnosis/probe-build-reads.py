"""Bounded read-only probe of manifest-selected immutable build inputs."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import datetime
from monitor import Windows


def probe(selection, destination):
    config = json.loads(Path(selection).read_text(encoding='utf-8'))
    root = Path(config['root']).resolve(strict=True)
    destination = Path(destination)
    win = Windows()
    started = time.monotonic()
    total = 0
    results = []
    reason = 'sample_complete'
    try:
        with (destination / 'reads.jsonl').open('x', encoding='utf-8') as log:
            def emit(row):
                log.write(json.dumps(row) + '\n')
                log.flush()
            for entry in config['files']:
                if time.monotonic() - started > 120 or total >= 256 * 1024**2:
                    reason = 'time_or_byte_limit'
                    break
                path = root / entry['path']
                t = time.monotonic()
                row = {'path': entry['path'], 'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
                emit(dict(row, event='begin'))
                try:
                    path.resolve(strict=True).relative_to(root)
                    for parent in [path, *path.parents]:
                        if parent == root:
                            break
                        if parent.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
                            raise ValueError('Refuse reparse point')
                    metadata = path.stat()
                    if not stat.S_ISREG(metadata.st_mode):
                        raise ValueError('Not a regular file')
                    if metadata.st_size > 32 * 1024**2 or total + metadata.st_size > 256 * 1024**2:
                        emit(dict(row, event='skip', reason='size_limit'))
                        continue
                    row['metadata_seconds'] = time.monotonic() - t
                    t = time.monotonic()
                    stream = path.open('rb', buffering=0)
                    row['open_seconds'] = time.monotonic() - t
                    t = time.monotonic()
                    digest = hashlib.sha256()
                    size = 0
                    with stream:
                        while chunk := stream.read(1024 * 1024):
                            digest.update(chunk)
                            size += len(chunk)
                            if size > 32 * 1024**2:
                                raise ValueError('File grew beyond bound')
                    row.update(read_hash_seconds=time.monotonic()-t, bytes=size,
                               hash_matches=digest.hexdigest()==entry['sha256'], system=win.cpu_memory())
                    total += size
                    row['event'] = 'end'
                    emit(row)
                    results.append(row)
                    if not row['hash_matches']:
                        reason = 'hash_mismatch_requires_investigation'
                        break
                    if max(row['metadata_seconds'], row['open_seconds'], row['read_hash_seconds']) >= 2:
                        reason = 'slow_operation'
                        break
                except Exception as error:
                    row.update(event='error', error=repr(error))
                    emit(row)
                    results.append(row)
                    reason = 'read_error'
                    break
    finally:
        win.close()
    summary = {'reason': reason, 'filesChecked': len(results), 'bytesRead': total,
               'elapsedSeconds': time.monotonic()-started,
               'slowest': sorted(results, key=lambda r: r.get('metadata_seconds',0)+r.get('open_seconds',0)+r.get('read_hash_seconds',0), reverse=True)[:5],
               'limitations': 'Buffered OS reads; samples only; read/hash time includes hashing. No physical-sector or cold-cache claim.'}
    (destination / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary))
    return 0 if reason == 'sample_complete' else 2


if __name__ == '__main__':
    sys.exit(probe(sys.argv[1], sys.argv[2]))
