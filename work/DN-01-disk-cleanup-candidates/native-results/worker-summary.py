import json, collections, time
from pathlib import Path
b=Path('work/DN-01-disk-cleanup-candidates')
plans=[json.loads((b/f).read_text(encoding='utf-8-sig')) for f in ['cleanup-selection.json','cleanup-selection-laio.json']]
groups=[g for p in plans for g in p['groups']]
fallback=json.loads((b/'native-cleanup-results.json').read_text(encoding='utf-8-sig'))
fallback={x['group']:x['result'] for x in fallback}
summary={'scope':str(plans[0]['root']),'status':'PARTIAL','created_epoch':time.time(),'planned_groups':len(groups),'planned_members':sum(g['count'] for g in groups),'groups':[],'native_operation_running':False,'stop_reason':'ordinary native deletion failed; group partial, remaining evidence preserved; no retry or bypass'}
for g in groups:
    stem=b/'native-results'/g['id']
    af=Path(str(stem)+'-apply.json'); rf=Path(str(stem)+'-review.json')
    a=json.loads(af.read_text(encoding='utf-8-sig')) if af.exists() else fallback.get(g['id'])
    row={'id':g['id'],'planned':g['count'],'status':'not_attempted','deleted':0,'logical_bytes_deleted':0}
    if a:
        results=a.get('results',[])
        sizes={i['id']:i.get('logical_bytes',0) for i in json.loads(rf.read_text(encoding='utf-8-sig'))['items']} if rf.exists() else {}
        good=[i for i in results if i.get('status')=='deleted' and i.get('remaining') is False and not i.get('deletion',{}).get('error')]
        row.update(status=a.get('groups',[{}])[0].get('status'),deleted=len(good),logical_bytes_deleted=sum(sizes.get(i['id'],0) for i in good),states=dict(collections.Counter(i.get('status') for i in results)),aborted=a.get('aborted'),remaining=[{'id':i['id'],'status':i.get('status'),'error':i.get('error'),'remaining':i.get('remaining')} for i in results if i not in good])
    summary['groups'].append(row)
summary.update(deleted_members=sum(x['deleted'] for x in summary['groups']),logical_bytes_deleted=sum(x['logical_bytes_deleted'] for x in summary['groups']),complete_groups=sum(x['status']=='deleted' for x in summary['groups']),partial_groups=sum(x['status']=='partial' for x in summary['groups']),unattempted_groups=sum(x['status']=='not_attempted' for x in summary['groups']))
summary['planned_members_remaining']=summary['planned_members']-summary['deleted_members']
summary['limitations']=['Logical bytes are receipt measurements; physical reclaimed space is not measured.','Handle snapshots cannot prove absence of every possible consumer; query/duplicate failures retained in each references receipt.','First failed item error is empty in native result; root exists with Directory attribute.','9 excluded antigravity ACL-denied paths and other unknown/active/postboot material not selected or changed.','No products tests/builds run; this is operational cleanup only.']
(b/'native-results'/'worker-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in summary.items() if k!='groups'},ensure_ascii=True))

