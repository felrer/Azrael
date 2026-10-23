import os, json, re
from pathlib import Path

root=Path(__file__).resolve().parents[2]
out=root/'artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1'
catalog=json.loads((out/'producer-catalog.json').read_text(encoding='utf-8'))
def rel(p):
    try: return Path(p).resolve().relative_to(root).as_posix()
    except ValueError: return None
def app_version(v):
    m=re.match(r'^2026\.0\.(\d+)(?:$|[-+])',str(v or ''))
    return '2026.0.'+m[1] if m else None
candidates=set()
for container in [root/'artifacts',root/'artifacts/build',root/'artifacts/verification',root/'artifacts/inputs',root/'artifacts/versions']:
    if container.is_dir():
        candidates.update(p for p in container.iterdir() if p.is_dir() and not p.is_symlink())
for record in catalog:
    for member in record['members']:
        p=Path(member['path'])
        while p!=root and root in p.parents:
            candidates.add(p);p=p.parent
snapshots={}
errors=[]
for p in candidates:
    cfg=p/'scripts/azrael-app-release.json'
    try:
        if cfg.is_file():
            d=json.loads(cfg.read_text(encoding='utf-8-sig'))
            v=app_version(d.get('version'))
            if v and rel(p):snapshots[rel(p)]={'versions':[v],'evidence':rel(cfg),'kind':'frozen-release-config'}
    except (OSError,ValueError) as e:errors.append({'path':str(cfg),'error':str(e)})
claims={p:{'versions':set(d['versions']),'evidence':[d['evidence']],'groups':[]} for p,d in snapshots.items()}
records=[]
for record in catalog:
    versions=set()
    v=app_version(record.get('version'))
    if v:versions.add(v)
    for member in record['members']:
        p=rel(member['path'])
        if not p:continue
        matching=[(s,d) for s,d in snapshots.items() if p==s or p.startswith(s+'/')]
        if matching:versions.update(max(matching,key=lambda x:len(x[0]))[1]['versions'])
    if not versions:continue
    records.append({'id':record['id'],'versions':sorted(versions),'members':record['members'],'references':record.get('references',[]),'state':record['state']})
    for member in record['members']:
        p=rel(member['path'])
        if not p or not p.startswith('artifacts/') or member.get('generated') is False:continue
        claim=claims.setdefault(p,{'versions':set(),'evidence':[],'groups':[]})
        claim['versions'].update(versions);claim['groups'].append(record['id']);claim['evidence'].append('producer-catalog:'+record['id'])
for p,d in claims.items():d['versions']=sorted(d['versions'])
result={'scope':'Windows local project metadata audit; no deletion', 'threshold':'2026.0.10','claims':claims,'snapshots':snapshots,'classified_records':records,'preparation_errors':errors,'allocation_probe_threshold_bytes':1048576}
(out/'classification-input.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'snapshots':len(snapshots),'claims':len(claims),'classified_records':len(records),'snapshot_versions':{p:d['versions'] for p,d in snapshots.items()},'errors':len(errors)},ensure_ascii=True))
