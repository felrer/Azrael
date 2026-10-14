"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { InstructionPublisher } = require("../instruction-publisher.cjs");
const { InstructionLibrary, packageDigest, canonicalDigest } = require("../instruction-library.cjs");
const yazl = require(require.resolve("yazl",{paths:[path.join(__dirname,"../../extensions/azrael-ex")]}));
const fixtureRoot = path.resolve(process.env.INSTRUCTION_PUBLISHER_FIXTURES || `artifacts/verification/instruction-publisher-${process.pid}`);
const sha = (data, algorithm = "sha256") => crypto.createHash(algorithm).update(data).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
function pkg(id,sharing = "public",content = `${id} original`) {
  const entry = {id,name:id,kind:"context",sharing,files:[{path:"guide.md",encoding:"utf8",content}]};
  return {...entry,digest:packageDigest(entry)};
}
const plan = (packages,extra = {}) => { const body = {schemaVersion:1,revision:1,sharing:packages[0]?.sharing || "public",packages,...extra}; return {...body,digest:canonicalDigest(body)}; };
const conn = (repository = "owner/public",sharing = "public") => ({repository,sharing,branch:"main",token:"fixture-token-never-export"});
class Github {
  constructor() { this.calls = []; this.repos = new Map(); this.sequence = 0; this.failUpload = false; this.failCreateAfterAccept = false; this.conflict = false; this.redirect = false; this.corrupt = false; this.loseRefResponse = false; }
  repo(name) {
    if (!this.repos.has(name)) {
      const base = sha(name,"sha1"), tree = sha(`${name}:tree`,"sha1");
      this.repos.set(name,{name,private:name.includes("private"),writable:true,ref:base,commits:new Map([[base,{sha:base,tree:{sha:tree},parents:[]}]]),trees:new Map([[tree,new Map()]]),blobs:new Map(),releases:[],assets:new Map()});
    }
    return this.repos.get(name);
  }
  request = async (value,options) => {
    const url = new URL(value), method = options.method || "GET", payload = options.body && options.headers["Content-Type"] === "application/json" ? JSON.parse(options.body) : options.body;
    this.calls.push({url:value,method,headers:options.headers,body:options.body});
    const response = (status,data,headers = {}) => ({status,headers,body:Buffer.isBuffer(data) ? data : encode(data)});
    if (url.hostname === "release-assets.githubusercontent.com") {
      assert.equal(options.headers.Authorization,undefined);
      const asset = [...this.repos.values()].flatMap(r => [...r.assets.values()]).find(a => a.id === Number(url.pathname.slice(1)));
      return response(200,asset.data);
    }
    const match = /^\/repos\/([^/]+\/[^/]+)(.*)$/.exec(url.pathname);
    assert.ok(match,`Unexpected fixture route ${url.pathname}`);
    const r = this.repo(match[1]), route = decodeURIComponent(match[2]);
    if (this.denied) return response(this.denied,{});
    if (!route) return response(200,{full_name:r.name,private:r.private,visibility:r.private ? "private" : "public",permissions:{push:r.writable}});
    if (route === "/git/ref/heads/main") return response(200,{object:{sha:r.ref}});
    if (route.startsWith("/git/ref/tags/")) return response(404,{});
    if (route.startsWith("/compare/")) {
      const [base,head] = route.slice(9).split("..."); let current = head;
      while (current && current !== base) current = r.commits.get(current)?.parents[0];
      return response(200,{status:current === base ? "ahead" : "diverged",merge_base_commit:{sha:current || "unknown"}});
    }
    if (route === "/git/refs/heads/main" && method === "PATCH") {
      assert.equal(payload.force,false);
      if (this.conflict) { r.ref = sha("concurrent-branch","sha1"); return response(422,{}); }
      if (r.commits.get(payload.sha).parents[0] !== r.ref) return response(422,{});
      r.ref = payload.sha;
      if (this.loseRefResponse) {
        this.loseRefResponse = false;
        if (this.advanceAfterLost) { const child = sha("advanced-source","sha1"); r.commits.set(child,{sha:child,parents:[r.ref],tree:r.commits.get(r.ref).tree}); r.ref = child; }
        throw new Error("lost response");
      }
      return response(200,{object:{sha:r.ref}});
    }
    if (route === "/git/blobs" && method === "POST") {
      const data = Buffer.from(payload.content,"base64"), id = sha(data,"sha1"); r.blobs.set(id,data); return response(201,{sha:id});
    }
    if (route.startsWith("/git/blobs/")) { const data = r.blobs.get(route.slice(11)); return response(200,{encoding:"base64",size:data.length,content:data.toString("base64")}); }
    if (route === "/git/trees" && method === "POST") {
      const tree = new Map(r.trees.get(payload.base_tree));
      for (const item of payload.tree) { if (item.sha === null) tree.delete(item.path); else tree.set(item.path,item); }
      const id = sha(JSON.stringify([...tree]),"sha1"); r.trees.set(id,tree); return response(201,{sha:id});
    }
    if (route.startsWith("/git/trees/")) {
      let id = route.slice(11); if (r.commits.has(id)) id = r.commits.get(id).tree.sha;
      return response(200,{truncated:false,tree:[...r.trees.get(id).values()]});
    }
    if (route === "/git/commits" && method === "POST") {
      const id = sha(JSON.stringify(payload),"sha1"); r.commits.set(id,{sha:id,tree:{sha:payload.tree},parents:payload.parents}); return response(201,{sha:id});
    }
    if (route.startsWith("/git/commits/")) return response(200,r.commits.get(route.slice(13)));
    if (route.startsWith("/releases/assets/")) {
      const asset = r.assets.get(Number(route.slice(17)));
      if (this.redirect) return response(302,Buffer.alloc(0),{location:`https://release-assets.githubusercontent.com/${asset.id}`});
      return response(200,this.corrupt && asset.name.endsWith(".zip") ? Buffer.from("corrupt") : asset.data);
    }
    if (url.hostname === "uploads.github.com") {
      if (this.failUpload) { this.failUpload = false; return response(503,{}); }
      const releaseId = Number(/^\/releases\/(\d+)\/assets$/.exec(route)[1]), name = url.searchParams.get("name");
      const asset = {id:++this.sequence,name,size:payload.length,data:Buffer.from(payload)};
      r.assets.set(asset.id,asset); r.releases.find(x => x.id === releaseId).assets.push({id:asset.id,name,size:asset.size}); return response(201,{id:asset.id,name,size:asset.size});
    }
    if (route === "/releases" && method === "POST") {
      const release = {...payload,id:++this.sequence,assets:[]}; r.releases.push(release);
      if (this.failCreateAfterAccept) { this.failCreateAfterAccept = false; throw new Error("response lost"); }
      return response(201,release);
    }
    if (route.startsWith("/releases/tags/")) { const release = r.releases.find(x => x.tag_name === route.slice(15)); return response(release ? 200 : 404,release || {}); }
    if (/^\/releases\/\d+$/.test(route) && method === "PATCH") { const release = r.releases.find(x => x.id === Number(route.slice(10))); Object.assign(release,payload); return response(200,release); }
    if (route === "/releases") return response(200,r.releases);
    assert.fail(`Unhandled fixture route ${method} ${route}`);
  };
}
function setup(name,github = new Github()) { return {github,publisher:new InstructionPublisher({stateRoot:path.join(fixtureRoot,name),request:github.request})}; }
test("approved selection excludes local metadata and preserves unselected remote snapshots",async () => {
  const {publisher,github} = setup("selection"), c = conn();
  const first = pkg("first"), second = pkg("second");
  await publisher.publish(plan([first,second]),c,{version:"1.0.0"});
  const selected = {...pkg("first","public","updated"),path:"C:/private/source",registry:{token:"secret"},installedDigest:"private-installed",publications:[{repository:"private/source"}]};
  const outgoing = plan([selected]);
  await publisher.publish(outgoing,c,{version:"1.1.0"});
  const downloaded = await publisher.download(c,"1.1.0");
  assert.equal(downloaded.packages.length,3);
  assert.equal(downloaded.packages.find(p => p.id === "second").files[0].content,"second original");
  assert.equal(downloaded.packages.find(p => p.id === "first" && p.current).files[0].content,"updated");
  const payloads = Buffer.concat(github.calls.filter(call => call.body).map(call => call.body)).toString();
  for (const secret of ["C:/private/source","private-installed","private/source","fixture-token-never-export"]) assert.ok(!payloads.includes(secret));
  await assert.rejects(publisher.publish(plan([pkg("excluded","local")],{sharing:"public"}),c,{version:"2.0.0"}),/excluded/);
  assert.deepEqual(await publisher.listReleases(c),[{version:"1.1.0",notes:github.repo(c.repository).releases[1].body},{version:"1.0.0",notes:github.repo(c.repository).releases[0].body}]);
});
test("historical pinned dependency survives current resource update",async () => {
  const {publisher} = setup("pins"), c = conn(), old = pkg("resource"), updated = pkg("resource","public","new version");
  const profile = {...pkg("recipe"),kind:"task-profile",profile:{model:"review-model",provider:"test",reasoningEffort:"high",dependencies:[{id:old.id,digest:old.digest}],harness:{promptProfile:"review",toolProfile:"read"}}};
  profile.digest = packageDigest(profile); profile.profile.token = "never-export"; profile.profile.harness.secret = "never-export";
  await publisher.publish(plan([old,profile]),c,{version:"1.0.0"});
  await publisher.publish(plan([updated]),c,{version:"1.1.0"});
  const remote = await publisher.download(c,"1.1.0");
  assert.equal(remote.packages.find(p => p.id === "resource" && p.current).digest,updated.digest);
  assert.ok(remote.packages.some(p => p.digest === old.digest && !p.current));
  assert.equal(remote.packages.find(p => p.id === "recipe").profile.dependencies[0].digest,old.digest);
  assert.equal(remote.packages.find(p => p.id === "recipe").profile.token,undefined);
  assert.equal(remote.packages.find(p => p.id === "recipe").profile.harness.secret,undefined);
});
test("same version is independent across public and private repositories",async () => {
  const {publisher} = setup("repositories");
  const a = await publisher.publish(plan([pkg("public-entry")]),conn(),{version:"1.0.0"});
  const b = await publisher.publish(plan([pkg("private-entry","collaborators")]),conn("owner/private","collaborators"),{version:"1.0.0"});
  assert.notEqual(a.repository,b.repository);
  assert.equal((await publisher.download(conn(),"1.0.0")).packages[0].id,"public-entry");
  assert.equal((await publisher.download(conn("owner/private","collaborators"),"1.0.0")).packages[0].id,"private-entry");
});
test("read, write and visibility failures stop before mutation",async () => {
  const {publisher,github} = setup("access"), c = conn();
  github.denied = 403; await assert.rejects(publisher.checkConnection(c),/403/); github.denied = undefined;
  github.repo(c.repository).writable = false;
  assert.equal((await publisher.checkConnection(c)).writable,false);
  await assert.rejects(publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"}),/write permission/);
  github.repo(c.repository).writable = true; github.repo(c.repository).private = true;
  await assert.rejects(publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"}),/visibility/);
  assert.ok(github.calls.every(call => call.method === "GET"));
});
test("concurrent branch conflict never forces or creates a release",async () => {
  const {publisher,github} = setup("conflict"), c = conn(); github.conflict = true;
  await assert.rejects(publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"}),error => error.phase === "prepared" && error.status === 422);
  assert.equal(github.repo(c.repository).releases.length,0);
  assert.equal(github.repo(c.repository).ref,sha("concurrent-branch","sha1"));
});
test("release upload failure retains source milestone and frozen recovery",async () => {
  const {publisher,github} = setup("recovery"), c = conn(); github.failUpload = true;
  const approved = plan([pkg("a")]); let failure;
  try { await publisher.publish(approved,c,{version:"1.0.0"}); } catch (error) { failure = error; }
  assert.equal(failure.phase,"source-committed");
  assert.equal(failure.commit,github.repo(c.repository).ref); assert.equal(failure.digest,approved.digest);
  const source = github.repo(c.repository).ref; approved.packages[0].files[0].content = "later unapproved edits";
  const journal = JSON.parse(await fs.readFile(path.join(fixtureRoot,"recovery",`${failure.operationId}.json`)));
  assert.equal(journal.commit,source); assert.ok(!JSON.stringify(journal).includes(c.token));
  await assert.rejects(publisher.publish(plan(approved.packages),c,{version:"1.0.0"}),/digest|unfinished/);
  const result = await publisher.recover(c,failure.operationId);
  assert.equal(result.commit,source); assert.equal(result.phase,"published");
  assert.equal(github.repo(c.repository).releases.length,1);
  assert.equal((await publisher.download(c,"1.0.0")).packages[0].files[0].content,"a original");
  assert.equal(github.calls.filter(x => x.method === "POST" && x.url.endsWith("/git/commits")).length,1);
  await assert.rejects(publisher.publish(plan([pkg("a","public","different")]),c,{version:"1.0.0"}),/already exists/);
});
test("lost release creation response is inspected before recovery creates anything",async () => {
  const {publisher,github} = setup("ambiguous-release"), c = conn(); github.failCreateAfterAccept = true;
  let error; try { await publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"}); } catch (e) { error = e; }
  assert.equal(error.phase,"source-committed");
  await publisher.recover(c,error.operationId);
  assert.equal(github.repo(c.repository).releases.length,1);
});
test("lost ref response reports accepted source and recovers without another commit",async () => {
  const {publisher,github} = setup("ambiguous-ref"), c = conn(); github.loseRefResponse = true; github.advanceAfterLost = true;
  let error; try { await publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"}); } catch (e) { error = e; }
  assert.equal(error.phase,"source-committed"); await publisher.recover(c,error.operationId);
  assert.equal(github.calls.filter(x => x.method === "POST" && x.url.endsWith("/git/commits")).length,1);
});
test("private asset API redirects strip authorization and archive tampering is rejected",async () => {
  const {publisher,github} = setup("redirects"), c = conn("owner/private","collaborators");
  await publisher.publish(plan([pkg("a","collaborators")]),c,{version:"1.0.0"}); github.redirect = true;
  assert.equal((await publisher.download(c,"1.0.0")).packages[0].id,"a");
  const api = github.calls.filter(x => x.url.includes("/releases/assets/")); assert.ok(api.every(x => x.headers.Authorization === `Bearer ${c.token}` && x.headers.Accept === "application/octet-stream"));
  const redirected = github.calls.filter(x => x.url.startsWith("https://release-assets.githubusercontent.com")); assert.ok(redirected.length >= 2 && redirected.every(x => !x.headers.Authorization));
  github.redirect = false; github.corrupt = true;
  await assert.rejects(publisher.download(c,"1.0.0"),/integrity/);
});
test("public profile cannot depend on private or local resources",async () => {
  const {publisher,github} = setup("boundaries"), privateDependency = pkg("private","collaborators");
  const profile = {...pkg("profile"),kind:"task-profile",profile:{model:"m",dependencies:[{id:privateDependency.id,digest:privateDependency.digest}]}};
  profile.digest = packageDigest(profile);
  await assert.rejects(publisher.publish(plan([profile,privateDependency],{sharing:"public"}),conn(),{version:"1.0.0"}),/excluded/);
  await assert.rejects(publisher.publish(plan([profile,pkg("private","local")],{sharing:"collaborators"}),conn("owner/private","collaborators"),{version:"1.0.0"}),/excluded/);
  assert.equal(github.calls.length,0);
});
test("unsafe paths and immutable snapshot edits are rejected",async () => {
  const {publisher} = setup("paths"), c = conn(), original = pkg("a");
  for (const unsafe of ["../escape","C:/escape","CON","foo\\bar","name.","/absolute"]) await assert.rejects(publisher.publish(plan([{...original,files:[{path:unsafe,encoding:"utf8",content:"bad"}]}]),c,{version:"1.0.0"}),/Unsafe/);
  await publisher.publish(plan([original]),c,{version:"1.0.0"});
  const changed = {...original,files:[{path:"guide.md",encoding:"utf8",content:"changed without changing digest"}]};
  await assert.rejects(publisher.publish(plan([changed]),c,{version:"1.1.0"}),/digest|Immutable/);
});
test("restart discovers sanitized operations and preserves the sealed approved plan",async () => {
  const {publisher,github} = setup("restart"), c = conn(); github.failUpload = true;
  const approved = plan([{...pkg("a"),version:1,validationErrors:[]}]); let failure;
  try { await publisher.publish(approved,c,{version:"1.0.0"}); } catch (e) { failure = e; }
  const restarted = new InstructionPublisher({stateRoot:path.join(fixtureRoot,"restart"),request:github.request});
  assert.deepEqual(await restarted.listOperations(),[{id:failure.operationId,phase:"source-committed",repository:c.repository,version:"1.0.0",sharing:c.sharing}]);
  assert.deepEqual(await restarted.readOperationPlan(failure.operationId),approved);
  const sourceReceipt = await restarted.readOperationReceipt(failure.operationId);
  assert.equal(sourceReceipt.phase,"source-committed"); assert.equal(sourceReceipt.commit,failure.commit); assert.equal(sourceReceipt.destination,c.repository);
  assert.ok(!JSON.stringify(sourceReceipt).includes(c.token));
  await restarted.recover(c,failure.operationId);
  assert.equal((await restarted.listOperations())[0].phase,"published");
  assert.equal((await restarted.readOperationReceipt(failure.operationId)).phase,"published");
});
test("approved plan bytes remain frozen while async repository checks run",async () => {
  const github = new Github(), approved = plan([pkg("a")]);
  let resume, entered;
  const gate = new Promise(resolve => { resume = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  let first = true;
  const publisher = new InstructionPublisher({stateRoot:path.join(fixtureRoot,"frozen"),request:async (...args) => { if (first) { first = false; entered(); await gate; } return github.request(...args); }});
  const running = publisher.publish(approved,conn(),{version:"1.0.0"});
  await reached; approved.packages[0].files[0].content = "later edit"; resume();
  const receipt = await running;
  assert.equal((await publisher.download(conn(),"1.0.0")).packages[0].files[0].content,"a original");
  assert.equal((await publisher.readOperationPlan(receipt.operationId)).packages[0].files[0].content,"a original");
});
test("unexpected redirect hosts and write redirects are rejected",async () => {
  const {publisher,github} = setup("host-boundary"), c = conn("owner/private","collaborators");
  await publisher.publish(plan([pkg("a","collaborators")]),c,{version:"1.0.0"});
  const base = github.request;
  publisher.request = async (url,options) => url.includes("/releases/assets/") ? {status:302,headers:{location:"https://untrusted.example/asset"},body:Buffer.alloc(0)} : base(url,options);
  await assert.rejects(publisher.download(c,"1.0.0"),/origin/);
  const writer = new InstructionPublisher({stateRoot:path.join(fixtureRoot,"write-redirect"),request:async (url,options) => options.method === "POST" ? {status:307,headers:{location:"https://uploads.github.com/redirect"},body:Buffer.alloc(0)} : base(url,options)});
  await assert.rejects(writer.publish(plan([pkg("a","collaborators")]),c,{version:"1.1.0"}),error => error.reason === "Unexpected resource redirect");
});
test("archive extraction rejects duplicate entries, symlinks, unexpected files and altered file bytes",async () => {
  const {publisher,github} = setup("archive-entries"), c = conn();
  await publisher.publish(plan([pkg("a")]),c,{version:"1.0.0"});
  const repository = github.repo(c.repository), release = repository.releases[0];
  const remoteZip = [...repository.assets.values()].find(a => a.name.endsWith(".zip")), remoteManifest = [...repository.assets.values()].find(a => a.name.endsWith("-manifest.json"));
  const originalManifest = JSON.parse(remoteManifest.data), sourceFiles = [...repository.trees.get(repository.commits.get(repository.ref).tree.sha).values()];
  for (const attack of ["duplicate","symlink","unexpected","altered"]) {
    const zip = new yazl.ZipFile(), chunks = [];
    const output = new Promise((resolve,reject) => { zip.outputStream.on("data",chunk => chunks.push(chunk)); zip.outputStream.on("end",() => resolve(Buffer.concat(chunks))); zip.outputStream.on("error",reject); });
    for (const entry of sourceFiles) {
      let data = repository.blobs.get(entry.sha);
      if (attack === "altered" && entry.path.endsWith("guide.md")) data = Buffer.from("changed bytes");
      zip.addBuffer(data,entry.path,{mode:attack === "symlink" && entry.path.endsWith("guide.md") ? 0o120777 : 0o100644});
    }
    if (attack === "duplicate") zip.addBuffer(repository.blobs.get(sourceFiles[0].sha),sourceFiles[0].path);
    if (attack === "unexpected") zip.addBuffer(Buffer.from("unlisted"),"unlisted.md");
    zip.end(); remoteZip.data = await output; remoteZip.size = remoteZip.data.length;
    const manifest = {...originalManifest,archive:{...originalManifest.archive,size:remoteZip.size,sha256:sha(remoteZip.data)}};
    remoteManifest.data = encode(manifest); remoteManifest.size = remoteManifest.data.length;
    release.assets.find(a => a.id === remoteZip.id).size = remoteZip.size;
    release.assets.find(a => a.id === remoteManifest.id).size = remoteManifest.size;
    await assert.rejects(publisher.download(c,"1.0.0"),/integrity/,attack);
  }
});
test("plan identity mismatch stops all requests",async () => {
  const {publisher,github} = setup("plan-integrity"), approved = plan([pkg("a")]);
  approved.packages[0].files[0].content = "post approval edit";
  await assert.rejects(publisher.publish(approved,conn(),{version:"1.0.0"}),/Plan identity mismatch/);
  assert.equal(github.calls.length,0);
});
test("library sealed plan, recovered publication receipt and remote reimport interoperate",async () => {
  const {publisher,github} = setup("library-integration"), c = conn();
  const local = new InstructionLibrary({root:path.join(fixtureRoot,"library-integration","local"),installedRoot:path.join(fixtureRoot,"library-integration","installed")});
  const resource = await local.create({name:"guidance",kind:"context",sharing:"public",files:[{path:"guide.md",encoding:"utf8",content:"integration guidance"}]});
  const approved = await local.planPublish([resource.id],"public"); github.failUpload = true;
  let failure; try { await publisher.publish(approved,c,{version:"1.0.0"}); } catch (e) { failure = e; }
  const frozen = await publisher.readOperationPlan(failure.operationId);
  await local.recordPublication(frozen,{...failure,destination:c.repository});
  const receipt = await publisher.recover(c,failure.operationId);
  await local.recordPublication(frozen,{...receipt,destination:receipt.repository});
  assert.equal((await local.getState()).entries[0].publications.length,1);
  const remote = await publisher.download(c,"1.0.0"), imported = new InstructionLibrary({root:path.join(fixtureRoot,"library-integration","imported"),installedRoot:path.join(fixtureRoot,"library-integration","other-installed")});
  const entry = await imported.importPackage(remote.packages[0],{repository:c.repository,version:"1.0.0",commit:receipt.commit,current:true});
  assert.equal(entry.digest,resource.digest); assert.equal(entry.version,resource.version);
});
