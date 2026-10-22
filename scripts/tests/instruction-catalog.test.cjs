"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { scanInstalled, LIMITS } = require("../instruction-catalog.cjs");
const { packageDigest } = require("../instruction-library.cjs");
async function remove(root) {
  for (const item of await fs.readdir(root, {withFileTypes:true})) {
    const file = path.join(root,item.name);
    if (item.isDirectory() && !item.isSymbolicLink()) await remove(file);
    else await fs.unlink(file);
  }
  await fs.rmdir(root);
}
async function fixture(t) {
  assert.ok(process.env.AZRAEL_CATALOG_TEST_ROOT, "Parent must assign AZRAEL_CATALOG_TEST_ROOT before running fixture tests");
  const parent = path.resolve(process.env.AZRAEL_CATALOG_TEST_ROOT);
  await fs.mkdir(parent,{recursive:true});
  const root = await fs.mkdtemp(path.join(parent,"catalog-"));
  t.after(() => remove(root));
  const put = async (name, content) => { const file=path.join(root,name); await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,content); return file; };
  return {root,put};
}
const skill = name => `---\nname: ${name}\ndescription: Fixture instruction\n---\nUse the fixture.\n`;
async function baseline(put, prefix = "baseline", version = "1.2.3") {
  await put(`${prefix}/skills/example/SKILL.md`,skill("example"));
  await put(`${prefix}/skills/example/ref.md`,"Canonical support");
  await put(`${prefix}/azrael-environment.json`,JSON.stringify({instructionVersion:version,components:[
    {id:"skill-example",kind:"skill",scope:"home",files:[{source:"skills/example/SKILL.md",target:"skills/example/SKILL.md"},{source:"skills/example/ref.md",target:"skills/example/ref.md"}]}
  ]}));
}
test("omitting installedRoot ignores the host CODEX_HOME", async t => {
  const {root,put}=await fixture(t);
  await put("skills/example/SKILL.md",skill("example"));
  const previous=process.env.CODEX_HOME;
  process.env.CODEX_HOME=root;
  try { assert.deepEqual(await scanInstalled(),{entries:[],notices:[]}); }
  finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME=previous; }
});
test("installed skills, system skills, roles and context retain full bytes and stable source identity", async t => {
  const {root,put} = await fixture(t);
  await put("skills/example/SKILL.md",skill("example"));
  await put("skills/example/references/a.md","Support\n");
  await put("skills/example/image.bin",Buffer.from([0,255,1]));
  await put("skills/.system/example/SKILL.md",skill("example"));
  await put("agents/helper.toml",'description = "Helper role"\ndeveloper_instructions = "Help"\n');
  await put("AGENTS.md","Global instructions\n");
  const first=await scanInstalled({installedRoot:root}), second=await scanInstalled({installedRoot:root});
  assert.equal(first.entries.length,4); assert.deepEqual(first.notices,[]);
  assert.deepEqual(first.entries.map(e=>e.id),second.entries.map(e=>e.id));
  assert.equal(new Set(first.entries.map(e=>e.id)).size,4);
  const entry=first.entries.find(e=>e.files.length===3);
  assert.equal(entry.files.find(f=>f.path==="image.bin").encoding,"base64");
  assert.equal(entry.files.find(f=>f.path==="image.bin").content,"AP8B");
  for (const e of first.entries) { assert.equal(e.digest,packageDigest(e)); assert.equal(e.installedDigest,e.digest); assert.equal(e.readOnly,true); assert.equal(e.sharing,"local"); assert.match(e.id,/^[a-f0-9-]{36}$/); }
});
test("baseline declared mappings preserve provenance without claiming installation", async t => {
  const {root,put}=await fixture(t);
  await put("skills/example/SKILL.md",skill("example"));
  await put("skills/example/ref.md","Declared support");
  await put("skills/example/undeclared.md","Not mapped");
  await put("instructions/AGENTS.snippet.md","Baseline global");
  await put("azrael-environment.json",JSON.stringify({instructionVersion:"1.2.3",components:[
    {id:"skill-example",kind:"skill",title:"example",files:[{source:"skills/example/SKILL.md",target:"skills/example/SKILL.md"},{source:"skills/example/ref.md",target:"skills/example/ref.md"}]},
    {id:"global",kind:"instructions",title:"Global instructions",files:[{source:"instructions/AGENTS.snippet.md",target:"AGENTS.md"}]},
    {id:"escape",kind:"context",files:[{source:"../private.md",target:"AGENTS.md"}]}
  ]}));
  const value=await scanInstalled({baselineRoot:root});
  assert.equal(value.entries.length,2); assert.equal(value.notices.length,1);
  for (const entry of value.entries) { assert.equal(entry.sourceKind,"builtin"); assert.equal(entry.versionLabel,"1.2.3"); assert.equal(entry.installedDigest,undefined); assert.ok(entry.mainPath.startsWith(root)); }
  assert.deepEqual(value.entries[0].files.map(f=>f.path),["ref.md","SKILL.md"].sort((a,b)=>a.localeCompare(b,"en")));
  assert.equal(value.entries[1].mainPath,path.join(root,"instructions/AGENTS.snippet.md"));
});
test("plugin same-name entries remain distinct and a bad source does not hide good sources", async t => {
  const {root,put}=await fixture(t);
  await put("one/skills/same/SKILL.md",skill("same"));
  await put("two/skills/same/SKILL.md",skill("same"));
  await put("two/skills/broken/SKILL.md",skill("broken"));
  const huge=await put("two/skills/broken/huge.bin","");
  const handle=await fs.open(huge,"w"); await handle.truncate(LIMITS.fileBytes+1); await handle.close();
  const value=await scanInstalled({pluginRoots:[path.join(root,"one"),path.join(root,"two"),path.join(root,"missing")]});
  assert.equal(value.entries.length,2); assert.notEqual(value.entries[0].id,value.entries[1].id);
  assert.ok(value.notices.length>=2); assert.ok(value.notices.some(n=>n.message.includes("size limit")));
});
test("linked package files are rejected without reading their target", async t => {
  const {root,put}=await fixture(t);
  await put("installed/skills/good/SKILL.md",skill("good"));
  await put("installed/skills/bad/SKILL.md",skill("bad"));
  const outside=await put("outside/private.md","Private fixture");
  try { await fs.symlink(outside,path.join(root,"installed/skills/bad/link.md")); }
  catch (error) { if (["EPERM","EACCES","ENOTSUP"].includes(error.code)) { t.skip(`Host symlink unavailable: ${error.code}`); return; } throw error; }
  const value=await scanInstalled({pluginRoots:[path.join(root,"installed/skills")]});
  assert.deepEqual(value.entries.map(e=>e.name),["good"]);
  assert.ok(value.notices.some(n=>n.message.includes("Linked")));
});
test("case-colliding package paths are rejected when the filesystem supports them", async t => {
  const {root,put}=await fixture(t);
  await put("skills/bad/SKILL.md",skill("bad"));
  await put("skills/bad/Guide.md","first");
  await put("skills/bad/guide.md","second");
  if ((await fs.readdir(path.join(root,"skills/bad"))).filter(n=>n.toLowerCase()==="guide.md").length<2) { t.skip("Case-insensitive filesystem"); return; }
  const value=await scanInstalled({pluginRoots:[path.join(root,"skills") ]});
  assert.equal(value.entries.length,0); assert.ok(value.notices.some(n=>n.message.includes("Case-colliding")));
});

test("canonical IDs follow repository and component across checkout and release cache versions", async t => {
  const {root,put}=await fixture(t);
  await baseline(put,"checkout/instructions");
  await baseline(put,"cache/release-2", "2.0.0");
  const first=await scanInstalled({baselineRoot:path.join(root,"checkout/instructions"),baselineIdentity:"Felrer/Azrael"});
  const second=await scanInstalled({baselineRoot:path.join(root,"cache/release-2"),baselineIdentity:"felrer/azrael"});
  const other=await scanInstalled({baselineRoot:path.join(root,"cache/release-2"),baselineIdentity:"another/repository"});
  assert.deepEqual(first.notices,[]); assert.deepEqual(second.notices,[]);
  assert.equal(first.entries[0].id,second.entries[0].id);
  assert.notEqual(first.entries[0].id,other.entries[0].id);
  assert.equal(first.entries[0].componentId,"skill-example");
  assert.equal(first.entries[0].sourceIdentity,"felrer/azrael");
  assert.equal(first.entries[0].installedRelativePath,"skills/example/SKILL.md");
  assert.equal(first.entries[0].digest,second.entries[0].digest);
  assert.notEqual(first.entries[0].mainPath,second.entries[0].mainPath);
});

test("only validated home targets expose installation paths", async t => {
  const {root,put}=await fixture(t);
  await put("context.md","Context");
  await put("azrael-environment.json",JSON.stringify({components:[
    {id:"workspace",kind:"context",scope:"workspace",files:[{source:"context.md",target:"AGENTS.md"}]},
    {id:"home",kind:"context",scope:"home",files:[{source:"context.md",target:"AGENTS.md"}]},
    {id:"unsafe",kind:"context",scope:"home",files:[{source:"context.md",target:"../private.md"}]}
  ]}));
  const value=await scanInstalled({baselineRoot:root});
  assert.equal(value.entries.length,2);
  assert.equal(value.entries.find(e=>e.componentId==="workspace").installedRelativePath,undefined);
  assert.equal(value.entries.find(e=>e.componentId==="home").installedRelativePath,"AGENTS.md");
  assert.equal(value.notices[0].code,"source-invalid");
});

test("canonical source and installed copy remain independent complete read-only snapshots", async t => {
  const {root,put}=await fixture(t);
  await baseline(put);
  await put("installed/skills/example/SKILL.md",skill("example"));
  await put("installed/skills/example/ref.md","Personal support");
  const options={baselineRoot:path.join(root,"baseline"),installedRoot:path.join(root,"installed")};
  const first=await scanInstalled(options);
  const original=first.entries.find(e=>e.sourceKind==="builtin"), installed=first.entries.find(e=>e.sourceKind==="installed");
  assert.ok(original && installed); assert.notEqual(original.id,installed.id); assert.notEqual(original.digest,installed.digest);
  await put("installed/skills/example/ref.md","Changed installation");
  const second=await scanInstalled(options);
  assert.equal(second.entries.find(e=>e.sourceKind==="builtin").digest,original.digest);
  assert.notEqual(second.entries.find(e=>e.sourceKind==="installed").digest,installed.digest);
  assert.equal(installed.files.find(f=>f.path==="ref.md").content,"Personal support");
  for (const entry of first.entries) { assert.equal(entry.readOnly,true); assert.equal(entry.digest,packageDigest(entry)); }
});

test("canonical sources have first claim on shared budgets before installed inventory", async t => {
  const {root,put}=await fixture(t);
  await baseline(put);
  await put("installed/skills/example/SKILL.md",skill("example"));
  await put("installed/skills/oversize/SKILL.md",skill("oversize"));
  const huge=await put("installed/skills/oversize/huge.bin","");
  const handle=await fs.open(huge,"w"); await handle.truncate(LIMITS.fileBytes+1); await handle.close();
  const value=await scanInstalled({baselineRoot:path.join(root,"baseline"),installedRoot:path.join(root,"installed")});
  assert.deepEqual(value.entries.map(e=>e.sourceKind),["builtin","installed"]);
  assert.equal(value.entries[0].componentId,"skill-example");
  assert.ok(value.notices.some(n=>n.code==="source-limit" && n.sourceKind==="installed"));
});

test("linked and broken installed junctions aggregate migration metadata without requiring external originals", async t => {
  const {root,put}=await fixture(t);
  await baseline(put);
  await put("installed/skills/good/SKILL.md",skill("good"));
  // Dangling links model an unavailable personal source. Never create or read it.
  const absent=path.join(root,"absent-personal-source");
  await put("external/example/SKILL.md",skill("external-personal-secret"));
  for (let index=0; index<10; index++) await fs.symlink(index === 0 ? path.join(root,"external/example") : absent,path.join(root,"installed/skills",`linked-${index}`),process.platform==="win32"?"junction":"dir");
  const value=await scanInstalled({installedRoot:path.join(root,"installed"),baselineRoot:path.join(root,"baseline")});
  assert.deepEqual(value.entries.map(e=>e.name).sort(),["example","good"]);
  const linked=value.notices.filter(n=>n.code==="linked-installation");
  assert.equal(linked.length,1); assert.equal(linked[0].count,10);
  assert.equal(linked[0].reason,"migration-needed"); assert.equal(linked[0].sourceKind,"installed");
  assert.equal(linked[0].affectedPaths.length,10);
  assert.ok(linked[0].affectedPaths.every(p=>p.startsWith(path.join(root,"installed/skills"))));
  assert.equal(JSON.stringify(value).includes(absent),false);
  assert.equal(JSON.stringify(value).includes("external-personal-secret"),false);
  await assert.rejects(fs.stat(absent),{code:"ENOENT"});
});

test("missing sources report structured reasons while available canonical sources stay browseable", async t => {
  const {root,put}=await fixture(t);
  await baseline(put);
  const value=await scanInstalled({baselineRoot:path.join(root,"baseline"),installedRoot:path.join(root,"missing-installation"),pluginRoots:[path.join(root,"missing-plugin")]});
  assert.equal(value.entries.length,1);
  assert.ok(value.notices.length>0);
  for (const n of value.notices) { assert.equal(n.code,"source-missing"); assert.equal(n.reason,"missing-source"); assert.ok(n.affectedPaths.includes(n.sourcePath)); }
  const missing=await scanInstalled({baselineRoot:path.join(root,"missing-baseline"),pluginRoots:[path.join(root,"baseline/skills")]});
  assert.equal(missing.entries.length,1);
  assert.equal(missing.notices[0].sourceKind,"builtin"); assert.equal(missing.notices[0].code,"source-missing");
});

test("linked support directories remain rejected in canonical packages", async t => {
  const {root,put}=await fixture(t);
  await baseline(put);
  await fs.symlink(path.join(root,"unavailable"),path.join(root,"baseline/skills/example/linked"),process.platform==="win32"?"junction":"dir");
  // Enumerated plugin packages and declared canonical mappings both enforce links.
  const plugin=await scanInstalled({pluginRoots:[path.join(root,"baseline/skills")]});
  assert.equal(plugin.entries.length,0); assert.equal(plugin.notices[0].code,"linked-content-rejected");
  await put("baseline/azrael-environment.json",JSON.stringify({components:[{id:"skill-example",kind:"skill",files:[{source:"skills/example/SKILL.md"},{source:"skills/example/linked/ref.md"}]}]}));
  const canonical=await scanInstalled({baselineRoot:path.join(root,"baseline")});
  assert.equal(canonical.entries.length,0); assert.equal(canonical.notices[0].code,"linked-content-rejected");
});
