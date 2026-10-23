import os,json,time,ctypes,collections
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1'
# Reuse the tested Win32 metadata definitions from the completed audit tool.
tool=Path(__file__).with_name('full-scan.py').read_text(encoding='utf-8')
prefix=tool.split("\nif '--preflight' in sys.argv:",1)
if len(prefix)!=2:raise RuntimeError('Metadata helper boundary changed')
ns={'__file__':str(Path(__file__).with_name('full-scan.py'))}
exec(compile(prefix[0],str(Path(__file__).with_name('full-scan.py')),'exec'),ns)
probe,extended=ns['probe'],ns['extended']
analysis=json.loads((OUT/'analysis.json').read_text(encoding='utf-8'))
full=json.loads((OUT/'full-sizes.json').read_text(encoding='utf-8'))
labels=analysis['classification_labels']
def old(vs):return bool(vs) and all(int(v.rsplit('.',1)[1])<=10 for v in vs)
oldlabels={p for p,c in labels.items() if old(c['versions'])}
roots=sorted(p for p in oldlabels if not any(p.startswith(q+'/') for q in oldlabels if q!=p))
LOW=16384;HIGH=1048576;cluster=full['cluster_bytes']
start=time.time();last=start;files=0;logical=0;queried=0;query_logical=0;query_perpath=0;query_round=0;single_reclaim=0
hardlinks={};errors=[];query_errors=[];stack=[(extended(ROOT/p),p) for p in roots]
while stack:
    folder,rel=stack.pop()
    if rel in labels and not old(labels[rel]['versions']):continue
    try:
        with os.scandir(folder) as entries:
            for e in entries:
                child=rel+'/'+e.name
                if child in labels and not old(labels[child]['versions']):continue
                try:
                    st=e.stat(follow_symlinks=False)
                    if getattr(st,'st_file_attributes',0)&0x400 or e.is_symlink():continue
                    if e.is_dir(follow_symlinks=False):stack.append((e.path,child))
                    elif e.is_file(follow_symlinks=False):
                        size=st.st_size;files+=1;logical+=size
                        if LOW<=size<HIGH:
                            try:
                                allocated,identity,nlinks=probe(e.path,size)
                                queried+=1;query_logical+=size;query_perpath+=allocated;query_round+=((size+cluster-1)//cluster)*cluster
                                if nlinks==1:single_reclaim+=allocated
                                else:
                                    key=':'.join(map(str,identity));link=hardlinks.setdefault(key,{'links':nlinks,'allocated':allocated,'count':0,'sample':child})
                                    link['count']+=1
                                    if link['links']!=nlinks or link['allocated']!=allocated:link['changed']=True
                            except OSError as err:query_errors.append({'path':child,'error':str(err)})
                except OSError as err:errors.append({'path':child,'error':str(err)})
                now=time.time()
                if now-last>=30:
                    p={'elapsed_seconds':round(now-start,1),'files':files,'logical_GiB':round(logical/2**30,2),'metadata_probes':queried,'current':rel,'errors':len(errors),'allocation_errors':len(query_errors)}
                    print(json.dumps(p),flush=True);(OUT/'refine-progress.json').write_text(json.dumps(p),encoding='utf-8');last=now
    except OSError as err:errors.append({'path':rel,'error':str(err)})
linked_reclaim=sum(x['allocated'] for x in hardlinks.values() if x['count']==x['links'] and not x.get('changed'))
mid_reclaim=single_reclaim+linked_reclaim
oldstats=analysis['old_version_stats'];base=analysis['old_data_reclaim_allocation_interval'][0]
remaining_upper=oldstats[6]-query_round
consistent=logical==oldstats[0] and files==oldstats[1] and not errors and not query_errors and remaining_upper>=0
result={'elapsed_seconds':time.time()-start,'scope':'Only confirmed old-version files 16KiB <= size < 1MiB receive additional Win32 allocation and link-count queries; prior >=1MiB probes reused. Smaller files remain bounded. No payload reads/deletion.','roots':roots,'observed_files':files,'observed_logical_bytes':logical,'expected_files':oldstats[1],'expected_logical_bytes':oldstats[0],'consistent':consistent,'metadata_probes':queried,'queried_logical_bytes':query_logical,'queried_allocation_per_path':query_perpath,'queried_allocation_reclaim':mid_reclaim,'unmeasured_allocation_ceiling':remaining_upper,'refined_old_file_data_reclaim_interval':[base+mid_reclaim,base+mid_reclaim+remaining_upper] if consistent else None,'errors':errors,'allocation_errors':query_errors,'hardlink_groups':hardlinks,'small_remaining_threshold_bytes':LOW}
(OUT/'refined-old-allocation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'complete':True,'elapsed_seconds':round(result['elapsed_seconds'],1),'consistent':consistent,'files':files,'metadata_probes':queried,'refined_old_reclaim_interval_GiB':None if not consistent else [round(x/2**30,3) for x in result['refined_old_file_data_reclaim_interval']],'remaining_uncertainty_GiB':round(remaining_upper/2**30,3),'errors':len(errors),'allocation_errors':len(query_errors)}),flush=True)
