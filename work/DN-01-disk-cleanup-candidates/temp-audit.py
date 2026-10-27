import os,json,stat,datetime
from pathlib import Path
root=Path('C:/Temp'); out=[]
for p in sorted(root.glob('azrael-*')):
    if not p.is_dir(): continue
    row={'path':str(p),'bytes':0,'files':0,'readonly_files':0,'links':[],'errors':[],'latest_mtime':0,'evidence':{}}
    def walk(q):
        try:
            with os.scandir(q) as it:
                for e in it:
                    try:
                        s=e.stat(follow_symlinks=False)
                        row['latest_mtime']=max(row['latest_mtime'],s.st_mtime)
                        if s.st_file_attributes & 0x400: row['links'].append(e.path);continue
                        if stat.S_ISDIR(s.st_mode):walk(e.path)
                        else:
                            row['bytes']+=s.st_size;row['files']+=1
                            if s.st_file_attributes & 1:row['readonly_files']+=1
                    except OSError as ex:row['errors'].append({'path':e.path,'error':str(ex)})
        except OSError as ex:row['errors'].append({'path':str(q),'error':str(ex)})
    walk(p)
    for name in ['host-result.json','run-result.json']:
        f=p/name
        if f.exists():
            try:
                j=json.loads(f.read_text(encoding='utf-8-sig'))
                row['evidence'][name]={k:j[k] for k in ['passed','finishedAt','exitCode','loginPerformed','modelRequestPerformed'] if k in j}
                if 'engine' in j:row['evidence'][name]['engineHome']=j['engine'].get('codexHome')
                if 'companion' in j:row['evidence'][name]['version']=j['companion'].get('version')
            except Exception as ex:row['evidence'][name]={'parse_error':str(ex)}
    row['state_top_files']=[x.name for x in (p/'state').iterdir()] if (p/'state').is_dir() else []
    row['latest_mtime']=datetime.datetime.fromtimestamp(row['latest_mtime'],datetime.timezone.utc).isoformat()
    out.append(row)
dest=Path(__file__).with_name('temp-audit.json');dest.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
for r in out:print(json.dumps({k:r[k] for k in ['path','bytes','files','readonly_files','links','errors','latest_mtime','evidence','state_top_files']},ensure_ascii=True))
print('TOTAL',sum(x['bytes'] for x in out))
