import os, json, time, collections, heapq
from pathlib import Path

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
snapshot = json.loads((out / 'registered-snapshot.json').read_text(encoding='utf-8'))
registered = {os.path.normcase(os.path.abspath(x['path'])): x for x in snapshot['items']}
sizes = collections.defaultdict(int)
exts = collections.defaultdict(int)
skipped, errors, links, largest = [], [], [], []
start = time.time()
stack = [str(root)]
files = 0
while stack:
    folder = stack.pop()
    try:
        with os.scandir(folder) as entries:
            for e in entries:
                rel = os.path.relpath(e.path, root).replace('\\', '/')
                key = os.path.normcase(os.path.abspath(e.path))
                if key in registered:
                    x = registered[key]
                    skipped.append({'path': rel, 'cached_bytes': x['bytes'], 'id': x['id']})
                    continue
                try:
                    st = e.stat(follow_symlinks=False)
                    if getattr(st, 'st_file_attributes', 0) & 0x400 or e.is_symlink():
                        links.append(rel)
                        continue
                    if e.is_dir(follow_symlinks=False):
                        stack.append(e.path)
                    elif e.is_file(follow_symlinks=False):
                        files += 1
                        parts = rel.split('/')
                        sizes['.'] += st.st_size
                        for n in range(1, min(len(parts), 6)):
                            sizes['/'.join(parts[:n])] += st.st_size
                        if 'target' in parts:
                            exts[os.path.splitext(e.name)[1].lower()] += st.st_size
                        v = (st.st_size, rel)
                        if len(largest) < 25: heapq.heappush(largest, v)
                        elif v > largest[0]: heapq.heapreplace(largest, v)
                except OSError as err:
                    errors.append({'path': rel, 'error': str(err)})
    except OSError as err:
        errors.append({'path': folder, 'error': str(err)})
result = {'started_epoch': start, 'elapsed_seconds': time.time()-start,
          'measurement': 'unregistered logical file bytes; registered paths excluded; no links followed; live non-atomic scan; hardlinks counted per path',
          'files': files, 'sizes': dict(sorted(sizes.items(), key=lambda x:-x[1])),
          'target_extensions': dict(sorted(exts.items(), key=lambda x:-x[1])),
          'large_files': sorted(largest, reverse=True), 'registered_skipped': skipped,
          'links': links, 'errors': errors}
(out / 'sizes.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'elapsed_seconds': result['elapsed_seconds'], 'files': files,
                  'unregistered_GiB': sizes['.']/2**30, 'skipped_registered': len(skipped),
                  'errors': len(errors), 'links': len(links),
                  'top': list(result['sizes'].items())[:30]}, ensure_ascii=False))
