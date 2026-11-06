"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createWorkbenchServer, roleModels } = require("../serve-instruction-workbench.cjs");

test("development transport isolates actions by origin, host and per-session token", async () => {
  const calls = [];
  const workbench = { snapshot: async projectId => ({ projectId, packages: [] }), detail: async key => ({ key }), profileOptions: async () => ({ providers: [{ id: "connected" }], models: [] }), composerResources: async () => ({ core: { id: "core" }, resources: [] }),
    action: async (action, payload) => { calls.push({ action, payload }); return { accepted: true }; }, close: async () => {} };
  const app = createWorkbenchServer({ workbench, token: "test-session-token", render: () => '<!doctype html><style>body{margin:0}</style><script>void 0</script>' });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { "X-Azrael-Token": app.token, "Content-Type": "application/json" };
  try {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    const html = await page.text();
    const nonce = /<script nonce="([^"]+)">/.exec(html)[1];
    assert.ok(page.headers.get("content-security-policy").includes(`script-src 'nonce-${nonce}'`));
    assert.ok(html.includes(`<style nonce="${nonce}">`));
    assert.equal((await fetch(`${base}/api/state`)).status, 403);
    assert.equal((await fetch(`${base}/api/state`, { headers: { ...headers, Origin: "https://untrusted.example" } })).status, 403);
    const state = await (await fetch(`${base}/api/state?project=project-a`, { headers })).json();
    assert.equal(state.projectId, "project-a");
    assert.equal((await fetch(`${base}/api/profile-options`)).status, 403);
    assert.deepEqual(await (await fetch(`${base}/api/profile-options`, { headers })).json(), { providers: [{ id: "connected" }], models: [] });
    assert.equal((await fetch(`${base}/api/resources`)).status, 403);
    assert.equal((await (await fetch(`${base}/api/resources`, { headers })).json()).core.id, "core");
    const action = await fetch(`${base}/api/action`, { method: "POST", headers, body: JSON.stringify({ action: "refresh", payload: {} }) });
    assert.equal(action.status, 200);
    assert.deepEqual(calls, [{ action: "refresh", payload: {} }]);
    assert.equal((await fetch(`${base}/api/action`, { method: "POST", headers, body: JSON.stringify({ action: "publish", payload: {} }) })).status, 400);
    assert.equal((await fetch(`${base}/api/action`, { method: "POST", headers, body: "{" })).status, 400);
    const status = await new Promise((resolve, reject) => {
      const request = http.get(base + "/", { headers: { Host: "attacker.example" } }, response => { response.resume(); response.on("end", () => resolve(response.statusCode)); }); request.on("error", reject);
    });
    assert.equal(status, 403);
    assert.equal(calls.length, 1);
  } finally { await app.close(); }
});

test("role-profile transport retains security guards and provider-qualified cached catalog identity", async () => {
  const calls = [], workbench = { profileOptions: async () => ({ providers:[{id:"account-one",modelProvider:"openai"},{id:"account-two",modelProvider:"openai"},{id:"managed",modelProvider:"azrael-managed"}],models:[{model:"m",providerIds:["account-one","account-two"]},{model:"managed/source/m",providerIds:["managed"]},{model:"unmapped",providerIds:["missing"]}]}),close:async()=>{} };
  assert.deepEqual((await roleModels(workbench)).map(m=>[m.model,m.modelProvider]),[["m","openai"],["managed/source/m","azrael-managed"]]);
  const roleProfiles={snapshot:async()=>({version:1,profiles:[]}),action:async(action,payload)=>{calls.push({action,payload});return {version:1,profiles:[]};}};
  const app=createWorkbenchServer({workbench,roleProfiles,token:"role-token",render:()=>""});
  await new Promise(resolve=>app.server.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${app.server.address().port}/api/role-profiles`,headers={"X-Azrael-Token":app.token,"Content-Type":"application/json"};
  try {
    assert.equal((await fetch(base)).status,403);
    assert.equal((await fetch(base,{headers:{...headers,Origin:"https://untrusted.example"}})).status,403);
    const snapshot=await (await fetch(base,{headers})).json();assert.equal(snapshot.models[0].modelProvider,"openai");
    const post=body=>fetch(base,{method:"POST",headers,body:JSON.stringify(body)});
    assert.equal((await post({action:"saveDirect",payload:{direct:{rootProfileId:"root",subagentProfileIds:[]}}})).status,200);
    assert.equal(calls.length,1);
    assert.equal(calls[0].action,"saveDirect");
    assert.equal((await post({action:"saveTeamProfile",payload:{teamId:"team",profile:{id:"azrael-root",allowedRoles:["root"]}}})).status,200);
    assert.equal(calls.at(-1).action,"saveTeamProfile");
    assert.equal((await post({action:"captureRequest",payload:{}})).status,400);
    assert.equal((await post({action:"saveDirect",payload:[]})).status,400);
    assert.equal((await fetch(base,{method:"POST",headers:{"X-Azrael-Token":app.token},body:"{}"})).status,415);
    assert.equal((await fetch(base,{method:"POST",headers,body:"{"})).status,400);
  }finally{await app.close();}
});
