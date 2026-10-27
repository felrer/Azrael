"""Check one fixed cleanup request against fresh, read-only process/handle snapshots."""
import json, sys, time
from pathlib import Path

base = Path(__file__).parent
request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
members = request['group']['members']
processes = json.loads((base / 'devin-native-all-processes.json').read_text(encoding='utf-8-sig'))
handles = json.loads((base / 'devin-native-handles.json').read_text(encoding='utf-8-sig'))

def norm(value):
    return value.replace('/', '\\').removeprefix('\\\\?\\').casefold().rstrip('\\')

roots = [(member['id'], norm(member['path'])) for member in members]
hits = []
for process in processes:
    command = (process.get('CommandLine') or '').casefold()
    for identity, root in roots:
        if root in norm(command) or root.rsplit('\\', 1)[-1] in command:
            hits.append({'id': identity, 'kind': 'command_line', 'pid': process['ProcessId'], 'name': process['Name']})
for handle in handles['matches']:
    actual = norm(handle['path'])
    for identity, root in roots:
        if actual == root or actual.startswith(root + '\\'):
            hits.append({'id': identity, 'kind': 'file_handle', 'pid': handle['pid'], 'name': handle['name'], 'path': handle['path']})
result = {
    'checked_at_epoch': time.time(), 'group': request['group']['id'],
    'members': len(members), 'process_count': len(processes),
    'selected_processes': handles['selected_processes'],
    'file_handles_checked': handles['file_handles_checked'],
    'query_or_duplicate_failures': handles['query_or_duplicate_failures'],
    'inaccessible_processes': handles['inaccessible_processes'], 'hits': hits,
}
print(json.dumps(result, ensure_ascii=True))
