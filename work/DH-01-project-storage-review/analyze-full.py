import json,re,collections,os
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1'
d=json.loads((OUT/'full-sizes.json').read_text(encoding='utf-8'))
scope=json.loads((OUT/'classification-input.json').read_text(encoding='utf-8'))
catalog=json.loads((OUT/'producer-catalog.json').read_text(encoding='utf-8'))
links=json.loads((OUT/'hardlinks.json').read_text(encoding='utf-8'))
rows=d['rows'];N=len(d['totals'])
rejected_cache_roots=[]
for c in d['cache_roots']:
    p=c['path']
    if c['kind']=='other' and p.rsplit('/',1)[-1]=='cache' and '/src/' in p:
        s=rows.get(p)
        if not s:continue
        amount=s[3];rejected_cache_roots.append({'path':p,'bytes':amount,'reason':'Source directory named cache is not a generated cache.'})
        for q,t in rows.items():
            if q=='.' or p==q or p.startswith(q+'/'):t[3]-=amount
        d['totals'][3]-=amount
claims={p:{'versions':set(c['versions']),'evidence':list(c['evidence']),'groups':list(c['groups'])} for p,c in scope['claims'].items()}
supplement=json.loads((OUT/'supplemental-versions.json').read_text(encoding='utf-8'))
known_snapshots={p:set(c['versions']) for p,c in scope['snapshots'].items()}
for s in supplement:
    known_snapshots[s['path']]={s['version']}
    c=claims.setdefault(s['path'],{'versions':set(),'evidence':[],'groups':[]})
    c['versions'].add(s['version']);c['evidence'].append(s['evidence'])
def version(v):
    m=re.search(r'(?<!\d)2026[.-]0[.-](\d+)(?!\d)',str(v or ''))
    return '2026.0.'+m[1] if m else None
def rel(p):
    try:return Path(p).relative_to(ROOT).as_posix()
    except ValueError:return None
for s in d['discovered_snapshots']:
    p=s['path'];v=version(s['version'])
    if not p.startswith('artifacts/') or not v:continue
    # A test fixture's embedded configuration does not change its owning run version.
    if any(p.startswith(parent+'/') for parent in claims):continue
    if not ((ROOT/p/'engine/SOURCE.json').is_file() or (ROOT/p/'.git').exists()):continue
    c=claims.setdefault(p,{'versions':set(),'evidence':[],'groups':[]})
    c['versions'].add(v);c['evidence'].append(s['evidence'])
group_versions={}
for r in catalog:
    versions=set()
    for m in r['members']:
        p=rel(m['path'])
        if not p:continue
        nearest=[s for s in known_snapshots if p==s or p.startswith(s+'/')]
        if nearest:versions.update(known_snapshots[max(nearest,key=len)])
    v=version(r.get('version')) or version(r['id']) or version(r.get('owner'))
    if v:versions.add(v)
    group_versions[r['id']]=versions
    if not versions:continue
    for m in r['members']:
        p=rel(m['path'])
        if not p or not p.startswith('artifacts/') or m.get('generated') is False:continue
        c=claims.setdefault(p,{'versions':set(),'evidence':[],'groups':[]})
        c['versions'].update(versions);c['evidence'].append('producer:'+r['id']);c['groups'].append(r['id'])
labels={p:c for p,c in claims.items() if p in rows and c['versions']}
def nearest_label(p,include_self=True):
    if not include_self:p=p.rsplit('/',1)[0] if '/' in p else ''
    while p:
        if p in labels:return p
        p=p.rsplit('/',1)[0] if '/' in p else ''
    return None
def isold(vs):return bool(vs) and all(int(v.rsplit('.',1)[1])<=10 for v in vs)
parts={p:list(rows[p]) for p in labels}
for p in labels:
    parent=nearest_label(p,False)
    if parent:
        for i,n in enumerate(rows[p]):parts[parent][i]-=n
old=[0]*N;new=[0]*N;mixed=[0]*N
byversion=collections.defaultdict(lambda:[0]*N)
oldparts=[]
for p,stats in parts.items():
    vs=labels[p]['versions']
    key=','.join(sorted(vs));total=old if isold(vs) else new if all(int(v.rsplit('.',1)[1])>10 for v in vs) else mixed
    for i,n in enumerate(stats):total[i]+=n;byversion[key][i]+=n
    if isold(vs):oldparts.append({'path':p,'versions':sorted(vs),'stats':stats,'groups':sorted(set(labels[p]['groups'])),'evidence':list(dict.fromkeys(labels[p]['evidence']))})
old_adjustment=0;old_linked_unfreed=0;old_linked_freed=0;old_link_entries=0
for link in links.values():
    selected=[p for p in link['paths'] if (lab:=nearest_label(p)) and isold(labels[lab]['versions'])]
    if not selected:continue
    count=len(selected);old_link_entries+=count;allocated=link['allocated']
    reclaim=allocated if count==link['links'] and not link.get('changed') else 0
    old_adjustment+=count*allocated-reclaim
    if reclaim:old_linked_freed+=reclaim
    else:old_linked_unfreed+=allocated
allocated_lower=max(0,old[5]-old_adjustment)
artifact=rows.get('artifacts',[0]*N)
classified=[old[i]+new[i]+mixed[i] for i in range(N)]
unknown=[artifact[i]-classified[i] for i in range(N)]
references=[]
for r in catalog:
    for ref in r.get('references',[]):
        if isold(group_versions.get(ref['id'],set())) and not isold(group_versions.get(r['id'],set())):
            references.append({'consumer':r['id'],'consumer_versions':sorted(group_versions.get(r['id'],set())),'old_dependency':ref['id'],'reason':ref.get('reason')})
result={'measurement':d['measurement'],'threshold':'2026.0.10','total_stats':d['totals'],'cache_bytes':d['totals'][2]+d['totals'][3],'cache_percent':100*(d['totals'][2]+d['totals'][3])/d['totals'][0],'node_modules_bytes':d['totals'][4],'total_file_allocation_interval':[d['measured_unique_allocation'],d['measured_unique_allocation']+d['totals'][6]],'old_version_stats':old,'new_version_stats':new,'mixed_version_stats':mixed,'unclassified_artifact_stats':unknown,'by_version':dict(byversion),'old_version_logical_bytes':old[0],'old_version_cache_overlap_bytes':old[2]+old[3],'remaining_cache_after_old_removal_bytes':d['totals'][2]+d['totals'][3]-old[2]-old[3],'old_data_reclaim_allocation_interval':[allocated_lower,allocated_lower+old[6]],'old_small_or_unmeasured_allocation_ceiling':old[6],'old_large_hardlink_adjustment':old_adjustment,'old_large_hardlink_entries':old_link_entries,'old_hardlink_groups_still_linked_bytes':old_linked_unfreed,'old_hardlink_groups_fully_removed_bytes':old_linked_freed,'old_partitions':sorted(oldparts,key=lambda x:-x['stats'][0]),'old_dependencies_from_other_consumers':references,'top_level':{p:s for p,s in rows.items() if '/' not in p},'cache_roots':sorted([{'path':c['path'],'kind':c['kind'],'stats':rows.get(c['path'])} for c in d['cache_roots'] if c['path'] in rows],key=lambda x:-x['stats'][0]),'classification_labels':{p:{**c,'versions':sorted(c['versions'])} for p,c in labels.items()},'unmeasured_claim_roots':[p for p in claims if p not in rows], 'errors_count':len(d['errors']),'allocation_errors_count':len(d['allocation_errors']),'links_excluded':len(d['links']),'elapsed_seconds':d['elapsed_seconds'],'caveats':['No deletion. Physical interval covers file data allocations, not directory/MFT metadata; small files below 1MiB are bounded rather than individually measured.','Live metadata traversal is not an atomic filesystem snapshot; files, names, links and allocation can change.','Version 0.4.0 and engine 0.162.0 are not app release versions. Unclassified artifacts are excluded from the old-version removal estimate.','User considers old logs and artifacts unnecessary; current process, installation, cross-version dependencies and locks still require resolution before deletion.']}
result['cache_source_exclusions']=rejected_cache_roots
assert all(n>=0 for stats in parts.values() for n in stats), 'Negative version partition: classification overlap error'
assert 0<=result['cache_bytes']<=d['totals'][0]
assert 0<=old[2]+old[3]<=result['cache_bytes']
assert allocated_lower<=allocated_lower+old[6]
assert sum(s[0] for p,s in result['top_level'].items() if p!='.')<=d['totals'][0], 'Top-level directory double count'
(OUT/'analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
g=lambda x:round(x/2**30,3)
print(json.dumps({'total_GiB':g(d['totals'][0]),'cache_GiB':g(result['cache_bytes']),'cache_percent':round(result['cache_percent'],2),'cargo_GiB':g(d['totals'][2]),'other_cache_GiB':g(d['totals'][3]),'node_modules_GiB':g(d['totals'][4]),'file_allocation_interval_GiB':list(map(g,result['total_file_allocation_interval'])),'old_logical_GiB':g(old[0]),'old_reclaim_allocation_interval_GiB':list(map(g,result['old_data_reclaim_allocation_interval'])),'old_cache_overlap_GiB':g(result['old_version_cache_overlap_bytes']),'unknown_artifact_GiB':g(unknown[0]),'by_version_GiB':{v:g(s[0]) for v,s in byversion.items()},'largest_old_partitions':[[x['path'],g(x['stats'][0])] for x in result['old_partitions'][:18]],'largest_caches':[[x['path'],g(x['stats'][0])] for x in result['cache_roots'][:10]],'errors':result['errors_count'],'allocation_errors':result['allocation_errors_count']},ensure_ascii=True))
