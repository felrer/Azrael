const fs=require('node:fs'),path=require('node:path');
const root=process.cwd(),life=require(path.join(root,'scripts/artifact-lifecycle.cjs'));
const ids=['run:DN-01:formal-custody-handoff-20261024-r3','run:DN-01:grouped-relocation-20261024-r4'];
const registrations=[];
for(const id of ids){
  const current=life.catalog(root).find(g=>g.id===id);
  if(!current || current.producer || current.references.length)throw Error('Unexpected cleanup evidence producer/reference');
  const result=life.recordLifecycle(root,{...current,expected_revision:current.revision,state:'complete',membership_complete:true});
  const registration=life.registerRequest(root,id);delete registration.operation;
  registrations.push({id,revision:result.revision,registration});
}
console.log(JSON.stringify({registrations}));
