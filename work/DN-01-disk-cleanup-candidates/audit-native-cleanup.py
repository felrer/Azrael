"""Audit native cleanup receipts against the fixed approved selection; no payload scan."""
import json
from collections import Counter
from pathlib import Path

base = Path(__file__).parent

def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

plans = [read(base / name) for name in ('cleanup-selection.json', 'cleanup-selection-laio.json')]
groups = [group for plan in plans for group in plan['groups']]
first = read(base / 'native-cleanup-results.json')
first_results = {entry['group']: entry['result'] for entry in first}
approved = {}
observed = {}
statuses = Counter()
problems = []
group_summaries = []
logical_bytes = 0
unknown_bytes = []
historical_non_deleted = []
accepted_deferred_ids = []

for group in groups:
    request = read(Path(group['file']))
    members = {member['id']: member for member in request['group']['members']}
    for identity, member in members.items():
        if identity in approved:
            problems.append({'group': group['id'], 'error': 'duplicate approved identity', 'id': identity})
        approved[identity] = member
    result_path = base / 'native-results' / (group['id'] + '-apply.json')
    result = read(result_path) if result_path.is_file() else first_results.get(group['id'])
    if result is None:
        problems.append({'group': group['id'], 'error': 'missing apply receipt'})
        continue
    review_path = base / 'native-results' / (group['id'] + '-review.json')
    review = read(review_path) if review_path.is_file() else {}
    measurements = {item['id']: item.get('logical_bytes') for item in review.get('items', [])}
    results = result.get('results', [])
    defer_path = (base / 'core009-defer-apply.json' if group['id'] == 'dn-legacy-codex-core-test-binary-support-009'
                  else base / 'native-results' / (group['id'] + '-defer-apply.json'))
    accepted_defer = False
    if defer_path.is_file():
        deferred_result = read(defer_path)
        deferred = deferred_result.get('results', [])
        deferred_by_id = {item.get('id'): item for item in deferred}
        retained_ids = {item.get('id') for item in results if not (item.get('status') == 'deleted' and item.get('remaining') is False)}
        accepted_defer = (
            group['id'] == 'dn-legacy-codex-core-test-binary-support-009'
            and set(deferred_by_id) == retained_ids
            and len(deferred) == len(retained_ids)
            and not deferred_result.get('aborted')
            and all(item.get('status') == 'deferred' and item.get('decision') == 'defer'
                    and item.get('reason') and item.get('revisit_condition') for item in deferred)
            and any(item.get('id') == group['id'] and item.get('status') == 'deferred'
                    for item in deferred_result.get('groups', []))
        )
        if accepted_defer:
            historical_non_deleted.extend(
                {'group': group['id'], 'id': item.get('id'), 'status': item.get('status'), 'remaining': item.get('remaining'), 'error': item.get('error')}
                for item in results if item.get('id') in retained_ids
            )
            results = [deferred_by_id.get(item.get('id'), item) for item in results]
            accepted_deferred_ids.extend(sorted(retained_ids))
        else:
            problems.append({'group': group['id'], 'error': 'invalid or unauthorized defer receipt'})
    result_ids = [item.get('id') for item in results]
    if set(result_ids) != set(members) or len(result_ids) != len(members):
        problems.append({'group': group['id'], 'error': 'receipt membership mismatch', 'expected': len(members), 'actual': len(results)})
    group_statuses = result.get('groups', [])
    if result.get('aborted') or not (accepted_defer or any(item.get('id') == group['id'] and item.get('status') == 'deleted' for item in group_statuses)):
        problems.append({'group': group['id'], 'error': 'group not fully deleted', 'statuses': group_statuses, 'aborted': result.get('aborted')})
    local = Counter()
    for item in results:
        identity = item.get('id')
        if identity in observed:
            problems.append({'group': group['id'], 'id': identity, 'error': 'duplicate result identity'})
        observed[identity] = item
        status = item.get('status', 'unknown')
        statuses[status] += 1
        local[status] += 1
        if status == 'deleted' and item.get('remaining') is False and not item.get('deletion', {}).get('error'):
            measured = measurements.get(identity)
            if isinstance(measured, int):
                logical_bytes += measured
            else:
                unknown_bytes.append(identity)
        elif status == 'deferred' and identity in accepted_deferred_ids:
            pass
        else:
            problems.append({'group': group['id'], 'id': identity, 'status': status, 'remaining': item.get('remaining'), 'error': item.get('error') or item.get('deletion', {}).get('error')})
    group_summaries.append({'id': group['id'], 'counts': dict(local), 'receipt': str(result_path) if result_path.is_file() else 'native-cleanup-results.json'})

unexpected = sorted(set(observed) - set(approved))
missing = sorted(set(approved) - set(observed))
protected = [
    Path('C:/Users/felre/.azrael-ex/tmp/devin-native') / name
    for name in ('.tmp4tuHRu', '.tmphCit04', '.tmpLk5peO', 'adb.log')
]
protected_presence = [{'path': str(path), 'present': path.exists()} for path in protected]
report = {
    'approved_groups': len(groups), 'approved_members': len(approved),
    'observed_members': len(observed), 'statuses': dict(statuses),
    'logical_deleted_bytes': logical_bytes, 'logical_deleted_gib': logical_bytes / 2**30,
    'unknown_byte_measurements': unknown_bytes, 'unexpected_identities': unexpected,
    'missing_identities': missing, 'problems': problems,
    'accepted_deferred_ids': accepted_deferred_ids,
    'historical_non_deleted': historical_non_deleted,
    'protected_presence': protected_presence, 'groups': group_summaries,
    'payload_rescanned': False,
}
output = base / 'native-acceptance-audit.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({key: value for key, value in report.items() if key not in ('groups', 'missing_identities', 'unknown_byte_measurements', 'problems', 'accepted_deferred_ids', 'historical_non_deleted')}, ensure_ascii=True))
print(json.dumps({'problems': len(problems), 'missing': len(missing), 'unknown_measurements': len(unknown_bytes), 'report': str(output)}, ensure_ascii=True))
raise SystemExit(0 if not (problems or missing or unexpected or unknown_bytes) else 1)
