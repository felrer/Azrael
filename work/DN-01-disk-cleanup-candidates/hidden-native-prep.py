"""Task-owned source preparation only; production source owners remain unchanged."""
import argparse, hashlib, importlib.util, json, os, runpy, shutil, subprocess, sys, tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def module(name, filename):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/filename)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj
imp=module('dn_importer','import-engine-source.py')
release=module('dn_release','build-engine-source-release.py')
prov=module('dn_provenance','engine-provenance.py')
def digest(data):return hashlib.sha256(data).hexdigest()
def baseline(archive,destination,recovery,report):
    destination=Path(destination); source_sha='12a1dbfc1725df7d4e87de4e336e0b8dab217aecbe7d26b624d1e264356b00b6'
    canonical_sha='028f02a89b108c40b56c857f13ddc481608be2508336b0941318c2c3d5271c21'
    with tarfile.open(archive,'r:') as tar:
        raw=tar.extractfile('SOURCE.json').read()
        if digest(raw)!=source_sha:raise ValueError('Original raw receipt anchor differs')
        receipt=json.loads(raw)
        if digest(imp.canonical(receipt))!=canonical_sha:raise ValueError('Original canonical receipt anchor differs')
        names={name for name,e in receipt['files'].items() if e['kind']!='missing'}
        names.add('SOURCE.json');names.update(receipt.get('distributionFiles',{}))
        if receipt.get('distributionAdaptation'):names.add(receipt['distributionAdaptation']['preservedPath'])
        for name,fix in receipt.get('sourceFixes',{}).items():
            names.discard(name);names.update([fix['adaptedPath'],fix['preservedPath']])
        for name in sorted(names):
            target=imp.safe_path(destination,name);target.parent.mkdir(parents=True,exist_ok=True)
            entry=tar.getmember(name)
            if entry.isfile():data=tar.extractfile(entry).read()
            elif entry.issym() and receipt['files'].get(name,{}).get('kind')=='git-symlink-placeholder':
                data=entry.linkname.encode('utf-8')
            else:raise ValueError('Unsupported archive member: '+name)
            with target.open('xb') as out:out.write(data)
    anchors=json.loads(Path(recovery).read_text(encoding='utf-8-sig'))
    for anchor in anchors:
        name=anchor['path']
        if receipt['files'][name]['sha256']!=anchor['sha256']:raise ValueError('Original recovery receipt mismatch: '+name)
        data=subprocess.check_output(['git','show',anchor['commit']+':engine/'+name],cwd=ROOT)
        if digest(data)!=anchor['sha256'] or len(data)!=anchor['size']:raise ValueError('Original blob mismatch: '+name)
        target=imp.safe_path(destination,name)
        if not target.is_file() or target.is_symlink():raise ValueError('Recovery target is not an extracted regular file: '+name)
        target.write_bytes(data)
    imp.validate_receipt(destination,receipt)
    Path(report).write_text(json.dumps({'rawReceiptSha256':source_sha,'canonicalReceiptSha256':canonical_sha,'selectedFileCount':len(names),'recovery':anchors},indent=2),encoding='utf-8')
    print(json.dumps({'baseline':str(destination),'selectedFileCount':len(names),'rawReceiptSha256':source_sha}))
def copy(source,destination,report):
    source=Path(source);destination=Path(destination)
    if destination.exists():raise ValueError('Frozen destination must be new')
    before=prov.snapshot(source)
    receipt,entries=release.inventory(source)
    destination.mkdir()
    for entry in entries:
        origin=imp.safe_path(source,entry['path']);target=imp.safe_path(destination,entry['path'])
        target.parent.mkdir(parents=True,exist_ok=True)
        with origin.open('rb') as reader,target.open('xb') as writer:shutil.copyfileobj(reader,writer)
        shutil.copystat(origin,target,follow_symlinks=False)
        if target.stat().st_size!=entry['size'] or release.sha(target)!=entry['sha256']:raise ValueError('Copied source mismatch: '+entry['path'])
    after=prov.snapshot(source)
    frozen=prov.snapshot(destination)
    if before!=after or before!=frozen:raise ValueError('Source changed during immutable copy')
    if release.inventory(imp.filesystem_path(source))[1]!=entries or release.inventory(imp.filesystem_path(destination))[1]!=entries:raise ValueError('Inventory changed during immutable copy')
    result={'source':str(source),'frozen':str(destination),'snapshot':frozen,'fileCount':len(entries),'bytes':sum(e['size'] for e in entries),'inputBeforeEqualsAfter':True,'frozenEqualsInput':True}
    Path(report).write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result))
# Preserve the supported scripts, including their validation and exact delta guards.
# Only process visibility changes inside this task-owned runner.
if os.name=='nt':
    ParentPopen=subprocess.Popen
    class HiddenPopen(ParentPopen):
        def __init__(self,*args,**kwargs):
            kwargs['creationflags']=kwargs.get('creationflags',0)|subprocess.CREATE_NO_WINDOW
            super().__init__(*args,**kwargs)
    subprocess.Popen=HiddenPopen
if __name__=='__main__':
    mode,*args=sys.argv[1:]
    if mode=='baseline':baseline(*args)
    elif mode=='copy':copy(*args)
    elif mode=='script':
        filename,*script_args=args;sys.argv=[filename,*script_args];runpy.run_path(filename,run_name='__main__')
    else:raise ValueError('Unknown preparation mode')

