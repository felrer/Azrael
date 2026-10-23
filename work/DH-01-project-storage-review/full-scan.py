import os,json,time,sys,ctypes,collections,re
from pathlib import Path
from ctypes import wintypes as W

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/tasks/DH-01-project-storage-review/runs/full-storage-v1'
THRESHOLD=1048576
K=ctypes.WinDLL('kernel32',use_last_error=True)
class Info(ctypes.Structure):
    _fields_=[(x,W.DWORD) for x in ['attributes','ctime_low','ctime_high','atime_low','atime_high','mtime_low','mtime_high','volume','size_high','size_low','links','id_high','id_low']]
class Standard(ctypes.Structure):
    _fields_=[('allocated',ctypes.c_longlong),('eof',ctypes.c_longlong),('links',W.DWORD),('delete',ctypes.c_ubyte),('directory',ctypes.c_ubyte)]
class Compression(ctypes.Structure):
    _fields_=[('allocated',ctypes.c_longlong),('format',W.WORD),('unit',ctypes.c_ubyte),('chunk',ctypes.c_ubyte),('cluster',ctypes.c_ubyte),('reserved',ctypes.c_ubyte*3)]
K.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,ctypes.c_void_p,W.DWORD,W.DWORD,W.HANDLE];K.CreateFileW.restype=W.HANDLE
K.GetFileInformationByHandle.argtypes=[W.HANDLE,ctypes.POINTER(Info)];K.GetFileInformationByHandle.restype=W.BOOL
K.GetFileInformationByHandleEx.argtypes=[W.HANDLE,ctypes.c_int,ctypes.c_void_p,W.DWORD];K.GetFileInformationByHandleEx.restype=W.BOOL
K.CloseHandle.argtypes=[W.HANDLE];K.CloseHandle.restype=W.BOOL
def extended(p):return '\\\\?\\'+str(p)
def probe(p,size):
    h=K.CreateFileW(str(p),0x80,7,None,3,0x200000,None)
    if h==ctypes.c_void_p(-1).value:raise ctypes.WinError(ctypes.get_last_error())
    try:
        i,s=Info(),Standard()
        if not K.GetFileInformationByHandle(h,ctypes.byref(i)):raise ctypes.WinError(ctypes.get_last_error())
        if not K.GetFileInformationByHandleEx(h,1,ctypes.byref(s),ctypes.sizeof(s)):raise ctypes.WinError(ctypes.get_last_error())
        if i.attributes&0x400:raise OSError('Path became a reparse point')
        if s.eof!=size:raise OSError('File size changed during metadata query')
        allocated=s.allocated
        if i.attributes&0xA00:
            c=Compression()
            if not K.GetFileInformationByHandleEx(h,8,ctypes.byref(c),ctypes.sizeof(c)):raise ctypes.WinError(ctypes.get_last_error())
            allocated=c.allocated
        return allocated,(i.volume,i.id_high,i.id_low),i.links
    finally:K.CloseHandle(h)

if '--preflight' in sys.argv:
    p=ROOT/'engine/SOURCE.json';s=p.stat();alloc,identity,links=probe(extended(p),s.st_size)
    print(json.dumps({'metadata_probe':str(p),'logical':s.st_size,'allocated':alloc,'identity':identity,'links':links,'struct_sizes':[ctypes.sizeof(Info),ctypes.sizeof(Standard),ctypes.sizeof(Compression)]}));sys.exit(0)

scope=json.loads((OUT/'classification-input.json').read_text(encoding='utf-8'))
claims=scope['claims']
preserve=set(claims)
catalog=json.loads((OUT/'producer-catalog.json').read_text(encoding='utf-8'))
for record in catalog:
    for m in record['members']:
        try:preserve.add(Path(m['path']).relative_to(ROOT).as_posix())
        except ValueError:pass
# Stats: logical, files, cargo cache, other cache, node_modules, measured allocation,
# unmeasured rounded allocation ceiling, measured logical, directories.
N=9
rows={};errors=[];links=[];alloc_errors=[];hardlinks={};cache_roots=[];discovered=[]
global_files=0;global_bytes=0;measured_files=0;start=time.time();last_progress=start
spc,bps,freec,totalc=W.DWORD(),W.DWORD(),W.DWORD(),W.DWORD()
if not K.GetDiskFreeSpaceW(str(ROOT.drive+'\\'),ctypes.byref(spc),ctypes.byref(bps),ctypes.byref(freec),ctypes.byref(totalc)):raise ctypes.WinError(ctypes.get_last_error())
cluster=spc.value*bps.value
run_rel=OUT.relative_to(ROOT).as_posix()
def write_progress(current):
    global last_progress
    now=time.time()
    if now-last_progress<30:return
    p={'elapsed_seconds':round(now-start,1),'files':global_files,'logical_GiB':round(global_bytes/2**30,2),'measured_large_files':measured_files,'current':current,'errors':len(errors)}
    (OUT/'progress.json').write_text(json.dumps(p),encoding='utf-8');print(json.dumps(p),flush=True);last_progress=now
def walk(folder,rel,kind=None,git=False):
    global global_files,global_bytes,measured_files
    stats=[0]*N;stats[8]=1
    name=rel.rsplit('/',1)[-1]
    if name=='.git':git=True
    if not git and kind is None:
        if (name=='target' or name.startswith('target-') or name.endswith('rust-target')) and any(os.path.exists(os.path.join(folder,x)) for x in ['.rustc_info.json','debug','release','x86_64-pc-windows-msvc']):
            kind='cargo';cache_roots.append({'path':rel,'kind':kind});preserve.add(rel)
        elif name in ['cache','.cache','.sccache','.ruff_cache','.turbo','.parcel-cache','.pnpm-store','__pycache__']:
            kind='other';cache_roots.append({'path':rel,'kind':kind});preserve.add(rel)
        elif name=='node_modules':kind='dependency';cache_roots.append({'path':rel,'kind':kind});preserve.add(rel)
    try:
        with os.scandir(folder) as entries:
            for e in entries:
                child=e.name if not rel else rel+'/'+e.name
                if child==run_rel:continue
                try:
                    st=e.stat(follow_symlinks=False)
                    if getattr(st,'st_file_attributes',0)&0x400 or e.is_symlink():links.append(child);continue
                    if e.is_dir(follow_symlinks=False):
                        sub=walk(e.path,child,kind,git)
                        for i in range(N):stats[i]+=sub[i]
                    elif e.is_file(follow_symlinks=False):
                        size=st.st_size;global_files+=1;global_bytes+=size;stats[0]+=size;stats[1]+=1
                        if kind=='cargo':stats[2]+=size
                        elif kind=='other':stats[3]+=size
                        elif kind=='dependency':stats[4]+=size
                        if size>=THRESHOLD:
                            try:
                                allocated,identity,nlinks=probe(e.path,size)
                                stats[5]+=allocated;stats[7]+=size;measured_files+=1
                                if nlinks>1:
                                    key=':'.join(map(str,identity))
                                    entry=hardlinks.setdefault(key,{'links':nlinks,'allocated':allocated,'logical':size,'paths':[]})
                                    entry['paths'].append(child)
                                    if entry['links']!=nlinks or entry['allocated']!=allocated:entry['changed']=True
                            except OSError as err:
                                alloc_errors.append({'path':child,'error':str(err),'logical':size});stats[6]+=((size+cluster-1)//cluster)*cluster
                        else:stats[6]+=((size+cluster-1)//cluster)*cluster
                        if e.name=='azrael-app-release.json' and name=='scripts':
                            try:
                                d=json.loads(Path(e.path).read_text(encoding='utf-8-sig'));v=d.get('version','')
                                if re.match(r'^2026\.0\.\d+(?:$|[-+])',v):
                                    snap=rel.rsplit('/',1)[0];preserve.add(snap);discovered.append({'path':snap,'version':v,'evidence':child})
                            except (OSError,ValueError):pass
                    if global_files%2048==0:write_progress(child)
                except OSError as err:errors.append({'path':child,'error':str(err)})
    except OSError as err:errors.append({'path':rel,'error':str(err)})
    if rel.count('/')<5 or rel in preserve or not rel:rows[rel or '.']=stats
    return stats

totals=walk(extended(ROOT),'')
duplicate_alloc=sum((len(d['paths'])-1)*d['allocated'] for d in hardlinks.values())
result={'started_epoch':start,'elapsed_seconds':time.time()-start,'root':str(ROOT),'measurement':'All accessible project file logical bytes, registered roots included; extended Windows paths; reparse points excluded; no payload hashing; live non-atomic scan. Data allocation measured for files >=1MiB, remaining per-path allocation ceiling uses volume cluster rounding.','own_report_root_excluded':run_rel,'cluster_bytes':cluster,'stats_fields':['logical_bytes','files','cargo_cache_bytes','other_cache_bytes','node_modules_bytes','measured_allocation_per_path','unmeasured_allocation_ceiling','measured_logical_bytes','directories'],'totals':totals,'measured_large_files':measured_files,'measured_unique_allocation':totals[5]-duplicate_alloc,'hardlink_duplicates_allocation':duplicate_alloc,'rows':rows,'cache_roots':cache_roots,'discovered_snapshots':discovered,'links':links,'errors':errors,'allocation_errors':alloc_errors}
(OUT/'hardlinks.json').write_text(json.dumps(hardlinks,ensure_ascii=False),encoding='utf-8')
(OUT/'full-sizes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'complete':True,'elapsed_seconds':round(result['elapsed_seconds'],1),'files':totals[1],'logical_GiB':round(totals[0]/2**30,3),'cache_GiB':round((totals[2]+totals[3])/2**30,3),'node_modules_GiB':round(totals[4]/2**30,3),'measured_unique_alloc_GiB':round(result['measured_unique_allocation']/2**30,3),'unmeasured_alloc_ceiling_GiB':round(totals[6]/2**30,3),'errors':len(errors),'allocation_errors':len(alloc_errors),'links':len(links)},ensure_ascii=True),flush=True)
