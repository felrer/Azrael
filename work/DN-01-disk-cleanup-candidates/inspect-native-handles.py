"""Read-only handle inspection; never closes handles in another process."""
import ctypes as C,json,os,time
from ctypes import wintypes as W
from pathlib import Path
b=Path(__file__).parent
k=C.WinDLL('kernel32',use_last_error=True); n=C.WinDLL('ntdll')
class Entry(C.Structure):
 _fields_=[('Object',C.c_void_p),('pid',C.c_size_t),('handle',C.c_size_t),('access',W.ULONG),('backtrace',W.USHORT),('type',W.USHORT),('attributes',W.ULONG),('reserved',W.ULONG)]
k.CreateFileW.argtypes=[W.LPCWSTR,W.DWORD,W.DWORD,C.c_void_p,W.DWORD,W.DWORD,W.HANDLE];k.CreateFileW.restype=W.HANDLE
k.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];k.OpenProcess.restype=W.HANDLE
k.GetCurrentProcess.restype=W.HANDLE
k.DuplicateHandle.argtypes=[W.HANDLE,W.HANDLE,W.HANDLE,C.POINTER(W.HANDLE),W.DWORD,W.BOOL,W.DWORD]
k.CloseHandle.argtypes=[W.HANDLE]
k.GetFileType.argtypes=[W.HANDLE];k.GetFileType.restype=W.DWORD
k.GetFinalPathNameByHandleW.argtypes=[W.HANDLE,W.LPWSTR,W.DWORD,W.DWORD]
root='C:\\Users\\felre\\.azrael-ex\\tmp\\devin-native'
h=k.CreateFileW(root,0x80,7,None,3,0x02000000,None)
if h==C.c_void_p(-1).value:raise C.WinError(C.get_last_error())
size=1024*1024
while True:
 buf=C.create_string_buffer(size); needed=W.ULONG()
 status=n.NtQuerySystemInformation(64,buf,size,C.byref(needed))
 if status==0:break
 if status not in (-1073741820,-1073741821):raise RuntimeError(hex(status & 0xffffffff))
 size=max(size*2,needed.value+65536)
count=C.c_size_t.from_buffer(buf).value
arr=(Entry*count).from_buffer(buf,2*C.sizeof(C.c_size_t))
typ=next(e.type for e in arr if e.pid==os.getpid() and e.handle==h)
ps=json.loads((b/'devin-native-all-processes.json').read_text(encoding='utf-8-sig'))
selected={p['ProcessId']:p for p in ps if p.get('ExecutablePath') and (p['ExecutablePath'].lower().startswith('c:\\users\\felre\\') or p['Name'].lower() in ['node.exe','bun.exe','cargo.exe','rustup.exe','powershell.exe','pwsh.exe','code.exe','dart.exe','dartaotruntime.exe','flutter_tester.exe'])}
matches=[]; inaccessible=[]; procs={}; checked=0; failures=0; started=time.time()
for e in arr:
 if e.type!=typ or e.pid not in selected or e.pid==os.getpid():continue
 if e.pid not in procs:
  procs[e.pid]=k.OpenProcess(0x40,False,e.pid)
  if not procs[e.pid]:inaccessible.append(dict(pid=e.pid,name=selected[e.pid]['Name'],error=C.get_last_error()))
 ph=procs[e.pid]
 if not ph:continue
 dup=W.HANDLE()
 if not k.DuplicateHandle(ph,W.HANDLE(e.handle),k.GetCurrentProcess(),C.byref(dup),0,False,2):failures+=1;continue
 try:
  # Pipes are not pathname resources and may block a pathname query.
  if k.GetFileType(dup)!=1:continue
  name=C.create_unicode_buffer(32768);length=k.GetFinalPathNameByHandleW(dup,name,len(name),0);checked+=1
  if not length:failures+=1;continue
  path=name.value
  if 'users\\felre\\.azrael-ex\\tmp\\devin-native' in path.lower():matches.append(dict(pid=e.pid,name=selected[e.pid]['Name'],path=path))
 finally:k.CloseHandle(dup)
for ph in procs.values():
 if ph:k.CloseHandle(ph)
k.CloseHandle(h)
out=dict(seconds=time.time()-started,process_snapshot='devin-native-all-processes.json',system_handles=count,file_handles_checked=checked,query_or_duplicate_failures=failures,selected_processes=len(selected),inaccessible_processes=inaccessible,matches=matches)
(b/'devin-native-handles.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(seconds=out['seconds'],checked=checked,failures=failures,selected=len(selected),inaccessible=len(inaccessible),matches=matches),ensure_ascii=True))
