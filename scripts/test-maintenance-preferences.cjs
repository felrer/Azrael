"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {createMaintenancePreferencesHost,validateWrite}=require("./maintenance-preferences-host.cjs");
const snapshot={schema:1,revision:7,groups:true,locks:false,deletion:true,effective:{groups:false,locks:false,deletion:false},status:"draining",pending:true};
test("runtime state root and CAS fields reach the asynchronous native command",async()=>{
  const calls=[],codexHome=path.resolve("isolated-preference-state");let input;
  const host=createMaintenancePreferencesHost({codexHome,env:{AZRAEL_STATE_ROOT:"wrong"}},{resolveCommand(root,{env}){assert.equal(env.AZRAEL_STATE_ROOT,codexHome);return{executable:process.execPath,args:["maintenance"]};},execFile(executable,args,options,callback){calls.push({args,options});queueMicrotask(()=>callback(null,JSON.stringify(args.at(-1)==="capabilities"?{preferences:true}:snapshot)));return{on(){},stdin:{on(){},end(value){input=value;}}};}});
  assert.deepEqual(await host.request("read"),snapshot);
  const payload={expected_revision:7,groups:true,locks:false,deletion:true};
  assert.deepEqual(await host.request("write",payload),snapshot);assert.deepEqual(JSON.parse(input),payload);
  assert.deepEqual(calls.at(-1).args,["maintenance","preferences","write"]);assert.equal(calls.at(-1).options.env.AZRAEL_STATE_ROOT,codexHome);assert.equal(calls.at(-1).options.windowsHide,true);assert.equal(calls.at(-1).options.timeout,15000);
  await assert.rejects(host.request("delete"),/Unsupported/);await assert.rejects(host.request("read",{}),/payload/);
  assert.throws(()=>validateWrite({...payload,unexpected:true}),/Invalid/);
});
test("older native owners fail clearly without a preference write",async()=>{
  let calls=0;const host=createMaintenancePreferencesHost({codexHome:path.resolve("isolated-preference-state")},{resolveCommand:()=>({executable:process.execPath,args:[]}),execFile(e,a,o,cb){calls++;queueMicrotask(()=>cb(null,'{}'));return{stdin:{on(){},end(){}}};}});
  await assert.rejects(host.request("write",{expected_revision:0,groups:false,locks:false,deletion:false}),/does not support preferences/);assert.equal(calls,1);
});
test("personalization and embedded host transforms remain wired through the asset pipeline",()=>{
  const root=path.resolve(__dirname,".."),ts=require(require.resolve("typescript",{paths:[path.join(root,"extensions/azrael-ex")]}));
  const {transformAsset,getAssetTransformRules}=require("./namespace-azrael-host.cjs");
  for(const asset of require("./inject-maintenance-preferences.cjs").MAINTENANCE_PREFERENCES_ASSETS){
    const filename=path.join(root,"artifacts/upstream-ui/26.1007.21434",asset),source=fs.readFileSync(filename,"utf8");
    const result=transformAsset(source,asset,filename,ts);
    assert.ok(result.text.includes("/*azrael-maintenance-preferences-v1*/"));
    assert.ok(JSON.stringify(getAssetTransformRules(asset)).includes("inject-maintenance-preferences"));
    assert.equal(ts.createSourceFile(asset,result.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length,0);
  }
  const modules=require("./check-instruction-modules.cjs").instructionModules;
  assert.ok(modules.includes("maintenance-preferences-host.cjs"));assert.ok(modules.includes("maintenance-owner-config.cjs"));
});
