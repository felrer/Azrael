"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {TURN_ASSET,azraelTaskTimeRows,injectTaskWorkTime}=require('./inject-task-work-time.cjs');
const base=path.join(__dirname,'../artifacts/upstream-ui/26.1007.21434');
const read=asset=>fs.readFileSync(path.join(base,asset),'utf8');

test('native list stays pristine and both user message paths insert the summary below the first user',()=>{
 const rowAsset='webview/assets/virtualized-turn-list-c0fd56eabf08.js';assert.equal(injectTaskWorkTime(read(rowAsset),rowAsset).text, read(rowAsset));

 for(const anchor of ['userMessageHeader:r}),ye&&e.readReceipt','content:(0,$.jsx)(fa,{isReadOnly:De,item:t,'])assert.throws(()=>injectTaskWorkTime(read(TURN_ASSET).replace(anchor,'changed'),TURN_ASSET));
});

test('projection retains entry count keys order and annotates exact first user only',()=>{
 const group={id:'a',firstTurnId:'a',eligible:true};
 const entries=[{turnKey:'gap',turnId:'a',type:'gap'},{turnKey:'assistant',turnId:'a',transcriptBlock:{type:'assistant-message'}},{turnKey:'user',turnId:'a',transcriptBlock:{type:'user-message',item:{}}},{turnKey:'second',turnId:'a',transcriptBlock:{type:'user-message',item:{}}},{turnKey:'b',turnId:'b'}];
 const rows=azraelTaskTimeRows(entries,[group]);assert.equal(rows.length,entries.length);assert.deepEqual(rows.map(x=>x.turnKey),entries.map(x=>x.turnKey));assert.equal(rows[2].azraelTimeGroup,group);assert.equal(rows.filter(x=>x.azraelTimeGroup).length,1);assert.equal(rows[0],entries[0]);
 assert.deepEqual(azraelTaskTimeRows(entries.slice(4),[group]),entries.slice(4));assert.deepEqual(azraelTaskTimeRows(entries,[{...group,eligible:false}]),entries);
});
