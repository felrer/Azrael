'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const supervisor=require('./linux-native-supervision.cjs');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const child=pid=>({pid,stdout:new EventEmitter()});

test('owned exit waits cooldown and emits one restart only after replacement initialization',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let launches=0,notifications=0;
 const host={proc:child(1),initialized:false,startCodexProcess(){launches++;this.proc=child(2);this.initialized=false;supervisor.watch(this,this.proc);return {success:true};}};
 const subscription=supervisor.onRestart(value=>{if(value===host)notifications++;});
 try {
  const old=host.proc;supervisor.watch(host,old);host.initialized=true;old.stdout.emit('data');await settle();
  assert.equal(notifications,0);
  host.proc=undefined;host.initialized=false;supervisor.exited(host);supervisor.exited(host);
  t.mock.timers.tick(999);assert.equal(launches,0);
  t.mock.timers.tick(1);assert.equal(launches,1);assert.equal(notifications,0);
  old.stdout.emit('data');await settle();assert.equal(notifications,0);
  host.initialized=true;host.proc.stdout.emit('data');await settle();
  host.proc.stdout.emit('data');await settle();assert.equal(notifications,1);
 } finally {subscription.dispose();supervisor.dispose(host);}
});

test('failed restart increases cooldown without replaying requests',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;
 const host={proc:undefined,startCodexProcess(){calls++;return {success:false};}};
 try {
  supervisor.exited(host);t.mock.timers.tick(1000);assert.equal(calls,1);
  t.mock.timers.tick(1999);assert.equal(calls,1);t.mock.timers.tick(1);assert.equal(calls,2);
  t.mock.timers.tick(3999);assert.equal(calls,2);t.mock.timers.tick(1);assert.equal(calls,3);
 } finally {supervisor.dispose(host);}
});

test('disposal cancels scheduled restart and removes host from inventory',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let calls=0;const host={proc:undefined,startCodexProcess(){calls++;return {success:true};}};
 supervisor.exited(host);supervisor.dispose(host);t.mock.timers.tick(300000);
 assert.equal(calls,0);assert.equal(supervisor.snapshot().length,0);
});

test('transformed initial failure schedules retry and thrown attempts retain exponential cooldown',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const ts=require('../artifacts/build/linux/companion/node_modules/typescript');
 const {wrapStartFailure}=require('./inject-linux-supervision.cjs');
 const source='class Host{constructor(){this.calls=0}sendProviderRequest(){}startCodexProcess(){this.calls++;if(this.calls===1)return {success:false};if(this.calls===2)throw Error("transient launch failure");this.proc={pid:99};return {success:true}}}';
 const wrapped=wrapStartFailure(source,ts);
 const Host=require('node:vm').runInNewContext(wrapped+';Host',{require});
 const host=new Host();
 try {
  assert.equal(host.startCodexProcess().success,false);
  t.mock.timers.tick(999);assert.equal(host.calls,1);
  t.mock.timers.tick(1);assert.equal(host.calls,2);
  t.mock.timers.tick(1999);assert.equal(host.calls,2);
  t.mock.timers.tick(1);assert.equal(host.calls,3);assert.equal(host.proc.pid,99);
  t.mock.timers.tick(300000);assert.equal(host.calls,3);
  assert.throws(()=>wrapStartFailure(wrapped,ts),/Already wrapped/);
 } finally {supervisor.dispose(host);}
});

test('disposed initial-failure host remains stopped even if start wrapper schedules again',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const ts=require('../artifacts/build/linux/companion/node_modules/typescript');
 const {wrapStartFailure}=require('./inject-linux-supervision.cjs');
 const source='class Host{constructor(){this.calls=0}sendProviderRequest(){}startCodexProcess(){this.calls++;return {success:false}}}';
 const Host=require('node:vm').runInNewContext(wrapStartFailure(source,ts)+';Host',{require});
 const host=new Host();host.startCodexProcess();supervisor.dispose(host);
 host.startCodexProcess();t.mock.timers.tick(300000);
 assert.equal(host.calls,2);assert.equal(supervisor.snapshot().length,0);
});

test('verified UI initialization clears stale fatal state before broadcasting readiness',()=>{
 const ts=require('../artifacts/build/linux/companion/node_modules/typescript');
 const {clearUiError}=require('./inject-linux-supervision.cjs');
 const source='class Provider{constructor(){this.fatalError=Error("old crash");this.mostRecentErrorLog="old log";this.callbacks={onInitialized:version=>{this.broadcastToAllViews({version})}}}broadcastToAllViews(message){if(this.fatalError||this.mostRecentErrorLog)throw Error("stale fatal rebroadcast");this.message=message}}';
 const patched=clearUiError(source,ts);
 const Provider=require('node:vm').runInNewContext(patched+';Provider',{require});
 const provider=new Provider();
 assert.ok(provider.fatalError);
 provider.callbacks.onInitialized('0.160.1');
 assert.equal(provider.fatalError,null);assert.equal(provider.mostRecentErrorLog,null);
 assert.equal(provider.message.version,'0.160.1');
 assert.throws(()=>clearUiError(patched,ts),/already patched/);
});
