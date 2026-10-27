import os,json,time,stat
from pathlib import Path
base=Path(__file__).parent
registered={os.path.normcase(os.path.normpath(x['path'])):x for x in json.loads((base/'registered.json').read_text())}
rows=[]; large=[]; errors=[]; skipped=[]
def walk(p,depth=0):
    key=os.path.normcase(os.path.normpath(p))
    if key in registered:
        r=registered[key]; n=r['bytes'] or 0
        rows.append(dict(path=p,bytes=n,registered=True,group=r['group']))
        return n
    total=0
    try:
        with os.scandir(p) as entries:
            for e in entries:
                try:
                    s=e.stat(follow_symlinks=False)
                    if s.st_file_attributes & 0x400:
                        skipped.append(e.path);continue
                    if stat.S_ISDIR(s.st_mode): total+=walk(e.path,depth+1)
                    else:
                        total+=s.st_size
                        if s.st_size>=1024**3: large.append(dict(path=e.path,bytes=s.st_size))
                except OSError as ex: errors.append(dict(path=e.path,error=str(ex)))
    except OSError as ex: errors.append(dict(path=p,error=str(ex)))
    if depth<=4 or total>=5*1024**3: rows.append(dict(path=p,bytes=total))
    return total
start=time.time()
roots=['C:/Users','C:/Temp','C:/tmp','C:/NVIDIA','C:/ProgramData','C:/Eden-Talos-Research','D:/','E:/']
for p in roots:
    if os.path.exists(p):
        n=walk(p);print(json.dumps(dict(root=p,GiB=round(n/1024**3,2)),ensure_ascii=True),flush=True)
out=dict(seconds=time.time()-start,roots=roots,rows=rows,large_files=large,errors=errors,skipped=skipped)
(base/'scan.json').write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
print(json.dumps(dict(seconds=out['seconds'],rows=len(rows),errors=len(errors),skipped=len(skipped))))
