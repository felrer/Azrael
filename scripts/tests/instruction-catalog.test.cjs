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
