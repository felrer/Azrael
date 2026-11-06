"use strict";
// Retain these boundary tests: future UI/backend wiring must preserve pinned request
// assets, project isolation and the existing Publisher's verified download boundary.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { InstructionWorkbench } = require("../instruction-workbench.cjs");
const { InstructionLibrary, packageDigest } = require("../instruction-library.cjs");
const projectRoot = path.resolve(__dirname, "../..");
const artifactRun = process.env.AZRAEL_WORKBENCH_TEST_ROOT ? null : require("../artifact-run.cjs").beginArtifactRun(projectRoot, { workId: "FA-01-instruction-package-dev-tab", owner: "scripts/tests/instruction-workbench.test.cjs" });
const fixtures = path.resolve(process.env.AZRAEL_WORKBENCH_TEST_ROOT || artifactRun.temporary);
const file = (p, content) => ({ path: p, encoding: "utf8", content });
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDQAAAABJRU5ErkJggg==";
const component = (name = "example") => ({ id: name, name, kind: "skill", files: [file("SKILL.md", `---\nname: ${name}\ndescription: A skill\n---\nUse the reference.`), file("references/a.md", "support bytes")] });
async function fixture(extra = {}) {
  await fs.mkdir(fixtures, { recursive: true });
  const base = await fs.mkdtemp(path.join(fixtures, "workbench-"));
  const options = { root: path.join(base, "sandbox"), installedRoot: path.join(base, "installed"), projects: [{ id: "A", name: "프로젝트 A" }, { id: "B", name: "프로젝트 B" }], ...extra };
  return { base, options, wb: new InstructionWorkbench(options) };
}

test("compound metadata and support files roundtrip; derived packages preserve independent identity", async () => {
  const { options, wb } = await fixture();
  const created = await wb.action("createPackage", { title: "복합 패키지", description: "전체 설명\n둘째 줄", image: png, components: [component()], profiles: [{ name: "recipe", model: "explicit-model", componentIds: ["example"] }] });
  const original = await wb.detail(created.key);
  assert.equal(original.title, "복합 패키지"); assert.equal(original.image, png);
  assert.equal(original.profiles[0].model, "explicit-model");
  assert.equal(original.components[0].files.find(f => f.path.endsWith("references/a.md")).content, "support bytes");
  const restarted = new InstructionWorkbench(options);
  assert.deepEqual((await restarted.detail(created.key)).components, original.components);
  const derived = await restarted.action("derivePackage", { title: "파생 패키지", description: "independent", selections: [{ key: created.key, componentIds: ["example"] }], components: [{ id: "added", name: "새 참고", kind: "context", files: [file("new.md", "authored addition")] }], profiles: [] });
  assert.notEqual(derived.id, created.id);
  assert.equal((await restarted.detail(derived.key)).provenance[0].digest, original.digest);
  assert.equal((await restarted.detail(derived.key)).components[1].files[0].content, "authored addition");
  assert.deepEqual((await restarted.detail(created.key)).files, original.files);
  assert.equal((await restarted.snapshot()).packages.length, 2);
  await wb.close(); await restarted.close();
});

test("profiles persist project-specific activation and immutable reception snapshots", async () => {
  const { wb, options } = await fixture();
  const pkg = await wb.action("createPackage", { title: "자료", description: "", components: [component()], profiles: [] });
  const first = await wb.action("createProfile", { name: "first", model: "m1", packageKey: pkg.key, projectId: "A", equip: true });
  const captured = await wb.action("captureRequest", { projectId: "A" });
  const second = await wb.action("createProfile", { name: "second", model: "m2", projectId: "B", equip: true });
  await wb.action("equip", { projectId: "A", profileId: second.profile.id });
  assert.equal(captured.profile.model, "m1"); assert.ok(Object.isFrozen(captured.components[0].files));
  assert.equal(captured.components[0].files[1].content, "support bytes");
  assert.equal((await wb.snapshot("A")).active.model, "m2");
  assert.equal((await wb.snapshot("B")).active.id, second.profile.id);
  assert.equal((await wb.snapshot()).active, null);
  assert.equal((await wb.action("captureRequest", {})).profile, null);
  await assert.rejects(wb.action("equip", { projectId: "A", profileId: "missing" }), /프로필/);
  assert.equal((await wb.snapshot("A")).active.id, second.profile.id);
  await assert.rejects(wb.action("equip", { projectId: "A", profileId: first.profile.id, expectedRevision: 0 }), /revision/);
  assert.equal((await new InstructionWorkbench(options).snapshot("B")).active.id, second.profile.id);
  await wb.action("unequip", { projectId: "A" });
  assert.equal((await wb.snapshot("A")).active.id, "__azrael_default__");
  assert.equal((await wb.snapshot("B")).active.id, second.profile.id);
});

// Retain the activation paths and last-good transition: composer/API rewiring can
// otherwise miss a root-role check or replace an applied snapshot with a role-only edit.
test("ordinary profiles require root across activation paths and retain last good role snapshots", async () => {
  const { wb, options } = await fixture();
  assert.deepEqual((await wb.snapshot("A")).active.allowedRoles, ["root"]);
  const lead = await wb.action("createProfile", { name: "Lead only", allowedRoles: ["lead"] });
  assert.deepEqual(lead.profile.allowedRoles, ["lead"]);
  await assert.rejects(wb.action("equip", { projectId: "A", profileId: lead.profile.id }), /root/i);
  await assert.rejects(wb.action("createProfile", { name: "Child only", allowedRoles: ["subagent"], projectId: "A", equip: true }), /root/i);
  assert.equal((await wb.action("captureRequest", { projectId: "A" })).profile, null);

  const saved = await wb.action("saveProfile", { name: "Ordinary", allowedRoles: ["root"], resourceIds: [], instructions: "last good" });
  await wb.action("equip", { projectId: "A", profileId: saved.profile.id });
  const before = await wb.action("captureRequest", { projectId: "A" });
  const edited = await wb.action("saveProfile", { projectId: "A", profileId: saved.profile.id, name: "Now lead", allowedRoles: ["lead"], resourceIds: [], instructions: "lead only" });
  assert.ok(edited.profile.diagnostics.some(d => d.code === "conversation-role-incompatible"));
  assert.equal(edited.profile.appliedDiffers, true);
  await assert.rejects(wb.action("equip", { projectId: "B", profileId: saved.profile.id }), /root/i);
  const restarted = new InstructionWorkbench(options);
  const stillGood = await restarted.action("captureRequest", { projectId: "A" });
  assert.deepEqual(stillGood.profile, before.profile);
  assert.deepEqual(stillGood.components, before.components);
  const statePath = path.join(options.root, "workbench-state.json");
  const state = JSON.parse(await fs.readFile(statePath, "utf8"));
  assert.deepEqual(state.profiles.find(p => p.id === saved.profile.id).diagnostics, []);
  assert.deepEqual((await wb.snapshot("B")).profiles.find(p => p.id === saved.profile.id).diagnostics, []);
  // A pre-existing invalid applied snapshot must fail explicitly, without default fallback.
  state.applied.A.allowedRoles = ["subagent"];
  await fs.writeFile(statePath, JSON.stringify(state));
  await assert.rejects(restarted.action("captureRequest", { projectId: "A" }), /root/i);
  await restarted.action("saveProfile", { profileId: saved.profile.id, name: "Repaired", allowedRoles: ["root"], resourceIds: [], instructions: "new good" });
  assert.equal((await restarted.action("captureRequest", { projectId: "A" })).profile.instructions, "new good");
});

test("read-only local library adapters expand pinned task-profile dependencies without mutation", async () => {
  const { base, options } = await fixture();
  const externalRoot = path.join(base, "external-library");
  const library = new InstructionLibrary({ root: externalRoot, installedRoot: options.installedRoot });
  const dependency = await library.create({ name: "reference", kind: "context", sharing: "local", files: [file("guide.md", "version one")] });
  const recipe = await library.create({ name: "recipe", kind: "task-profile", sharing: "local", profile: { model: "m", dependencies: [{ id: dependency.id, digest: dependency.digest }] } });
  await library.save(dependency.id, { files: [file("guide.md", "version two")] }, (await library.getState()).revision);
  const before = await fs.readFile(path.join(externalRoot, "registry.json"));
  const wb = new InstructionWorkbench({ ...options, localRoots: [{ root: externalRoot, label: "읽기 전용" }] });
  const snapshot = await wb.snapshot(), p = snapshot.packages.find(p => p.id === recipe.id);
  const detail = await wb.detail(p.key);
  assert.equal(detail.components[0].files[0].content, "version one");
  assert.equal(detail.profiles[0].model, "m");
  await wb.action("createProfile", { name: "pinned", model: "m", packageKey: p.key, projectId: "A", equip: true });
  assert.deepEqual(await fs.readFile(path.join(externalRoot, "registry.json")), before);
  // The metadata index survives restart without reading version payloads again.
  const versionPath = path.join(externalRoot, "packages", recipe.id, recipe.digest + ".json");
  await fs.rename(versionPath, versionPath + ".hidden");
  try {
    const restarted = new InstructionWorkbench({ ...options, localRoots: [{ root: externalRoot, label: "읽기 전용" }] });
    assert.ok((await restarted.snapshot()).packages.some(p => p.id === recipe.id));
    assert.equal((await restarted.action("captureRequest", { projectId: "A" })).components[0].files[0].content, "version one");
  } finally { await fs.rename(versionPath + ".hidden", versionPath); }
});

test("concurrent same-instance captures, project snapshots and equips serialize without bypassing external locks", async () => {
  const { wb, options } = await fixture();
  const a = await wb.action("createProfile", { name: "A profile", model: "model-A", projectId: "A", equip: true });
  const b = await wb.action("createProfile", { name: "B profile", model: "model-B", projectId: "B", equip: true });
  const results = await Promise.all([
    wb.action("equip", { projectId: "A", profileId: b.profile.id }),
    wb.action("captureRequest", { projectId: "A" }),
    wb.snapshot("B"),
    wb.snapshot("A"),
    wb.action("equip", { projectId: "B", profileId: a.profile.id }),
    wb.action("captureRequest", { projectId: "B" }),
    wb.snapshot("B")
  ]);
  assert.equal(results[1].projectId, "A"); assert.equal(results[1].profile.model, "model-B");
  assert.equal(results[2].projectId, "B"); assert.equal(results[2].active.id, b.profile.id);
  assert.equal(results[3].projectId, "A"); assert.equal(results[3].active.id, b.profile.id);
  assert.equal(results[5].projectId, "B"); assert.equal(results[5].profile.model, "model-A");
  assert.equal(results[6].projectId, "B"); assert.equal(results[6].active.id, a.profile.id);
  const lock = path.join(options.root, "workbench.lock");
  await fs.writeFile(lock, JSON.stringify({ pid: "external-owner" }), { flag: "wx" });
  try { await assert.rejects(wb.snapshot("A"), /다른 창/); assert.equal(JSON.parse(await fs.readFile(lock, "utf8")).pid, "external-owner"); }
  finally { await fs.unlink(lock); }
  assert.equal((await wb.snapshot("A")).active.id, b.profile.id);
});

test("baseline package groups manifest components without reading files; composer identities and detailed files remain available", async () => {
  const { base, options } = await fixture(), baselineRoot = path.join(base, "baseline");
  await fs.mkdir(path.join(baselineRoot, "skills/example/references"), { recursive: true });
  await fs.writeFile(path.join(baselineRoot, "azrael-environment.json"), JSON.stringify({ schemaVersion: 1, instructionVersion: "1.0.0", components: [{ id: "skill-example", title: "example", kind: "skill", files: [{ source: "skills/example/SKILL.md", target: "skills/example/SKILL.md" }, { source: "skills/example/references/a.md", target: "skills/example/references/a.md" }] }, { id: "instructions", title: "Base instructions", kind: "instructions", files: [{ source: "BASE.md", target: "AGENTS.md" }] }] }));
  const wb = new InstructionWorkbench({ ...options, baselineRoot });
  const listing = (await wb.snapshot()).packages;
  assert.equal(listing.length, 1);
  assert.equal(listing[0].key, "baseline-package:azrael-environment");
  assert.equal(listing[0].componentCount, 2);
  assert.deepEqual(listing[0].componentNames, ["example", "Base instructions"]);
  assert.deepEqual(listing[0].componentKinds, ["skill", "instruction"]);
  await assert.rejects(wb.detail("baseline:skill-example"), { code: "ENOENT" });
  await assert.rejects(wb.detail(listing[0].key), { code: "ENOENT" });
  const resources = await wb.composerResources();
  assert.deepEqual(resources.resources.map(r => r.packageKey), ["baseline:skill-example", "baseline:instructions"]);
  await fs.writeFile(path.join(baselineRoot, "skills/example/SKILL.md"), component().files[0].content);
  await fs.writeFile(path.join(baselineRoot, "skills/example/references/a.md"), "mapped support");
  const d = await wb.detail("baseline:skill-example");
  assert.equal(d.components[0].files[1].content, "mapped support");
  assert.equal(d.mappings[1].target, "skills/example/references/a.md");
  await fs.writeFile(path.join(baselineRoot, "BASE.md"), "Base instruction content");
  const grouped = await wb.detail(listing[0].key);
  assert.deepEqual(grouped.components.map(c => c.name), ["example", "Base instructions"]);
  assert.equal(grouped.components[1].kind, "instruction");
  assert.equal(grouped.files.length, 3);
  assert.equal(grouped.components[0].files[1].content, "mapped support");
});

test("canonical profiles share Team resources/images and preserve legacy bytes with CAS and referenced-delete protection", async () => {
  const { RoleProfileStore } = require("../role-profile-store.cjs");
  const { base, options, wb: legacy } = await fixture();
  await legacy.action("saveProfile", { name: "Existing", resourceIds: [], projectId: "A" });
  const oldBytes = await fs.readFile(path.join(options.root, "workbench-state.json"));
  const defaults = ["azrael-lead", "azrael-root", "sol_executor", "luna_explorer"].map((id, i) => ({ id, name: id, allowedRoles: [i === 0 ? "lead" : i === 1 ? "root" : "subagent"], model: "main", provider: "openai", instructions: "core", builtin: true }));
  const store = new RoleProfileStore({ codexHome: path.join(base, "canonical-home"), defaults, models: async () => [{ id: "main", modelProvider: "openai", supportedReasoningEfforts: [] }] });
  const wb = new InstructionWorkbench({ ...options, profileRepository: store });
  let state = await wb.snapshot("A");
  assert.equal(state.profiles.filter(p => p.name === "Existing").length, 1);
  assert.equal(state.profiles.find(p => p.id === "azrael-root").readOnly, true);
  const saved = await wb.action("saveProfile", { name: "Shared", resourceIds: [], image: png, allowedRoles: ["lead", "root", "subagent"], expectedRevision: state.revision, expectedRepoRevision: state.repoRevision });
  const id = saved.profile.id;
  assert.equal((await store.snapshotLibrary()).profiles.find(p => p.id === id).image, png);
  await store.action("saveTeamPreset", { preset: { id: "shared-team", name: "Shared Team", image: png, leadProfileId: id, rootProfileIds: [id], subagentProfileIds: [id] } });
  const capture = await store.capture("team", "shared-team");
  assert.equal(capture.profiles[0].id, id);
  assert.equal(capture.profiles[0].optionalSelection, "selected-only");
  assert.deepEqual(capture.profiles[0].mcpServerIds, []);
  assert.equal(capture.profiles[0].model, undefined);
  await assert.rejects(wb.action("saveProfile", { profileId: id, name: "Stale", resourceIds: [], expectedRepoRevision: state.repoRevision }), /revision conflict/);
  await assert.rejects(wb.action("deleteProfile", { profileId: id }), /incompatible|referenced|Missing/i);
  const copy = await wb.action("duplicateProfile", { profileId: id });
  assert.equal(copy.profile.image, png);
  await wb.action("deleteProfile", { profileId: copy.profile.id });
  assert.equal((await wb.snapshot()).profiles.some(p => p.id === copy.profile.id), false);
  await assert.rejects(wb.action("saveProfile", { profileId: "azrael-root", name: "Changed", resourceIds: [] }), /read-only/);
  assert.deepEqual(await fs.readFile(path.join(options.root, "workbench-state.json")), oldBytes);
  assert.equal(JSON.parse(await fs.readFile(path.join(options.root, "workbench-repository-state.json"), "utf8")).profiles, undefined);
});

test("invalid inventories, images, manifests, duplicate skill names and failed selections cannot change active state", async () => {
  const { wb, options } = await fixture();
  await wb.action("createProfile", { name: "safe", model: "m", projectId: "A", equip: true });
  const before = await wb.action("captureRequest", { projectId: "A" });
  await assert.rejects(wb.action("createProfile", { name: "bad", model: "", projectId: "A", equip: true }), /모델/);
  const invalids = [
    { components: [{ ...component(), files: [file("../outside.md", "bad")] }] },
    { components: [{ ...component(), files: [...component().files, file("references/A.md", "collision")] }] },
    { components: [component(), { ...component(), id: "different" }] },
    { components: [component()], image: "data:image/png;base64,YmFk" },
    { components: [component()], profiles: [{ name: "bad", model: "m", componentIds: ["missing"] }] }
  ];
  for (const bad of invalids) await assert.rejects(wb.action("createPackage", { title: "bad", description: "", profiles: [], ...bad }));
  assert.deepEqual(await wb.action("captureRequest", { projectId: "A" }), before);
  const lib = new InstructionLibrary({ root: path.join(options.root, "library"), installedRoot: options.installedRoot });
  const corrupt = await lib.create({ name: "corrupt", kind: "context", sharing: "local", files: [file("AZRAEL-PACKAGE.json", JSON.stringify({ schemaVersion: 999, components: [], profiles: [] }))] });
  await assert.rejects(wb.detail(`local:sandbox:${corrupt.id}`), /manifest/);
  assert.equal((await wb.snapshot("A")).active.model, "m");
});

async function releaseFixture(pkg, repository = "owner/catalog", version = "1.0.0") {
  const sha = b => crypto.createHash("sha256").update(b).digest("hex"), json = x => Buffer.from(JSON.stringify(x));
  const heads = { [pkg.id]: pkg.digest };
  const metadata = { id: pkg.id, name: pkg.name, kind: pkg.kind, sharing: pkg.sharing, digest: pkg.digest, files: pkg.files.map(f => { const bytes = Buffer.from(f.content, f.encoding); return { path: f.path, encoding: f.encoding, size: bytes.length, sha256: sha(bytes) }; }), version: pkg.version };
  const prefix = `packages/${pkg.id}/${pkg.digest}`;
  const payload = [{ path: "index.json", data: json({ schemaVersion: 1, heads }) }, { path: `${prefix}/package.json`, data: json(metadata) }, ...pkg.files.map(f => ({ path: `${prefix}/files/${f.path}`, data: Buffer.from(f.content, f.encoding) }))].sort((a,b) => a.path.localeCompare(b.path, "en"));
  const yazl = require(require.resolve("yazl", { paths: [path.join(projectRoot, "extensions/azrael-ex")] }));
  const zip = new yazl.ZipFile(), chunks = [];
  const done = new Promise((resolve, reject) => { zip.outputStream.on("data", b => chunks.push(b)); zip.outputStream.on("end", () => resolve(Buffer.concat(chunks))); zip.outputStream.on("error", reject); });
  for (const p of payload) zip.addBuffer(p.data, p.path); zip.end();
  const archive = await done;
  const manifest = { schemaVersion: 1, repository, version, sharing: "public", sourceCommit: "a".repeat(40), archive: { name: `azrael-resources-${version}.zip`, size: archive.length, sha256: sha(archive) }, packages: [metadata], heads, files: payload.map(p => ({ path: p.path, size: p.data.length, sha256: sha(p.data) })) };
  const manifestBytes = json(manifest), release = { id: 3, tag_name: `azrael-resources-v${version}`, draft: false, prerelease: false, assets: [{ id: 1, name: `azrael-resources-${version}-manifest.json`, size: manifestBytes.length }, { id: 2, name: manifest.archive.name, size: archive.length }] };
  let blocked, failure = false, corrupt = false, corruptContents = false, calls = 0;
  const requests = [];
  return {
    get calls() { return calls; },
    requests,
    corruptContents(value) { corruptContents = value; },
    block(p) { blocked = p; }, fail(value) { failure = value; }, corrupt(value) { corrupt = value; },
    request: async (url, options) => {
      calls++; requests.push(url); assert.equal(options.method, "GET");
      if (blocked) await blocked; if (failure) throw Error("fixture offline");
      assert.equal(options.headers.Authorization, "Bearer fixture-secret");
      const parsed = new URL(url), route = decodeURIComponent(parsed.pathname);
      let body;
      if (route === `/repos/${repository}`) body = json({ full_name: repository, private: false, visibility: "public", permissions: { push: false } });
      else if (route === `/repos/${repository}/releases`) body = json([release]);
      else if (route.includes("/releases/tags/")) body = json(release);
      else if (route.endsWith("/assets/1")) body = manifestBytes;
      else if (route.endsWith("/assets/2")) body = corrupt ? Buffer.alloc(archive.length) : archive;
      else if (route.startsWith(`/repos/${repository}/contents/`)) {
        assert.equal(parsed.searchParams.get("ref"), manifest.sourceCommit);
        const source = route.slice(`/repos/${repository}/contents/`.length), item = payload.find(p => p.path === source);
        assert.ok(item, `Unknown immutable contents path ${source}`);
        assert.ok(source.endsWith("/AZRAEL-PACKAGE.json") || /\/assets\/image\.(png|jpeg|webp)$/.test(source), "Refresh reads only manifest and image");
        const data = corruptContents ? Buffer.alloc(item.data.length) : item.data;
        body = json({ type: "file", encoding: "base64", size: item.data.length, content: data.toString("base64").replace(/(.{60})/g, "$1\n") });
      }
      else throw Error(`Unexpected route ${route}`);
      return { status: 200, headers: {}, body };
    }
  };
}

test("manual background GitHub refresh, verified download, source dedup and offline cache retain selection", async () => {
  const pkg = { id: crypto.randomUUID(), name: "remote", kind: "context", sharing: "public", files: [file("guide.md", "remote support")], version: 1 };
  pkg.digest = packageDigest(pkg);
  const github = await releaseFixture(pkg), { wb, options } = await fixture({ connections: [{ repository: "owner/catalog", sharing: "public", token: "fixture-secret" }], request: github.request });
  assert.equal(github.calls, 0); assert.equal((await wb.snapshot()).packages.length, 0);
  let unblock; github.block(new Promise(resolve => { unblock = resolve; }));
  assert.equal((await wb.action("refresh")).accepted, true);
  assert.equal((await wb.action("refresh")).coalesced, true);
  assert.equal((await wb.snapshot()).github.phase, "loading");
  await wb.action("createProfile", { name: "during refresh", model: "m", projectId: "A", equip: true });
  unblock(); await wb.close();
  let state = await wb.snapshot("A");
  assert.equal(state.packages.length, 1); assert.equal(state.packages[0].downloaded, false);
  assert.equal(JSON.stringify(state).includes("fixture-secret"), false);
  const key = state.packages[0].key;
  github.corrupt(true); await assert.rejects(wb.action("download", { key }), /integrity/);
  assert.equal((await wb.snapshot("A")).active.model, "m");
  github.corrupt(false); await wb.action("download", { key });
  state = await wb.snapshot("A"); assert.equal(state.packages.length, 1); assert.equal(state.packages[0].downloaded, true); assert.equal(state.packages[0].used, false);
  assert.equal((await wb.detail(key)).components[0].files[0].content, "remote support");
  github.fail(true); await wb.action("refresh"); await wb.close();
  state = await new InstructionWorkbench(options).snapshot("A");
  assert.equal(state.github.phase, "error"); assert.equal(state.packages[0].key, key); assert.equal(state.active.model, "m");
});

test("compound GitHub listing verifies immutable manifest and image without downloading archive; bad metadata retains cache", async () => {
  const { wb: author } = await fixture();
  const authored = await author.action("createPackage", { title: "이미지 복합 카드", description: "다운로드 전 전체 설명", image: png, components: [component()], profiles: [{ name: "선택할 프로필", model: "explicit-model", componentIds: ["example"] }] });
  const local = await author.detail(authored.key);
  const pkg = { id: authored.id, name: "transport-only-name", kind: "context", sharing: "public", files: local.files, version: 1 };
  pkg.digest = packageDigest(pkg);
  const github = await releaseFixture(pkg), { wb } = await fixture({ connections: [{ repository: "owner/catalog", sharing: "public", token: "fixture-secret" }], request: github.request });
  await wb.action("refresh"); await wb.close();
  const snapshot = await wb.snapshot(), card = snapshot.packages[0];
  assert.equal(card.title, "이미지 복합 카드"); assert.equal(card.description, "다운로드 전 전체 설명"); assert.equal(card.image, png);
  assert.deepEqual(card.componentKinds, ["skill"]); assert.equal(card.profileCount, 1); assert.equal(card.downloaded, false); assert.equal(card.metadataVerified, true);
  const detail = await wb.detail(card.key);
  assert.equal(detail.previewAvailable, false); assert.equal(detail.profiles[0].model, "explicit-model");
  assert.deepEqual(detail.profiles[0].componentIds, ["example"]);
  assert.ok(detail.components[0].files.some(f => f.path.endsWith("references/a.md") && typeof f.sha256 === "string"));
  assert.equal(detail.components[0].files[0].content, undefined);
  assert.equal(github.requests.filter(url => url.includes("/contents/")).length, 2);
  assert.equal(github.requests.some(url => url.endsWith("/assets/2")), false);
  github.corruptContents(true); await wb.action("refresh"); await wb.close();
  const retained = await wb.snapshot();
  assert.equal(retained.github.phase, "error"); assert.match(retained.github.message, /checksum/);
  assert.equal(retained.sources.find(s => s.message && s.repository === "owner/catalog").kind, "github");
  assert.deepEqual(retained.packages[0], card);
  assert.equal(github.requests.some(url => url.endsWith("/assets/2")), false);
});

test("profiles without provider settings omit all model overrides even when catalog is unavailable", async () => {
  const { wb } = await fixture({ readProfileOptions: async () => { throw Error("catalog unavailable"); } });
  await wb.action("createProfile", { name: "instructions only", instructions: "Use these instructions.", projectId: "A", equip: true });
  const captured = await wb.action("captureRequest", { projectId: "A" });
  for (const key of ["provider", "providerAccount", "model", "reasoningEffort"]) assert.equal(Object.hasOwn(captured.profile, key), false);
  assert.equal(captured.profile.instructions, "Use these instructions.");
  await assert.rejects(wb.action("createProfile", { name: "invalid", reasoningEffort: "medium" }), /모델/);
  const pkg = await wb.action("createPackage", { title: "Instructions", description: "No model override", components: [], profiles: [{ name: "instructions only", instructions: "Use these instructions." }] });
  assert.equal(Object.hasOwn((await wb.detail(pkg.key)).profiles[0], "model"), false);
});

test("profile dropdown scope normalizes account identity and rejects unavailable selections", async () => {
  const { wb } = await fixture({ readProfileOptions: async () => ({ providers: [{ id: "scope:A", modelProvider: "openai", account: { providerId: "openai", accountId: "account-A" } }], models: [{ model: "available-model", providerIds: ["scope:A"], supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }] }) });
  await wb.action("createProfile", { name: "all", model: "available-model", providerAccount: { providerId: "forged", accountId: "forged" }, projectId: "A", equip: true });
  const all = await wb.action("captureRequest", { projectId: "A" });
  assert.equal(all.profile.provider, undefined); assert.equal(all.profile.providerAccount, undefined);
  await wb.action("createProfile", { name: "scoped", model: "available-model", provider: "scope:A", reasoningEffort: "medium", projectId: "A", equip: true });
  const scoped = await wb.action("captureRequest", { projectId: "A" });
  assert.equal(scoped.profile.provider, "openai"); assert.deepEqual(scoped.profile.providerAccount, { providerId: "openai", accountId: "account-A" });
  await assert.rejects(wb.action("createProfile", { name: "invalid", model: "available-model", provider: "missing" }));
  await assert.rejects(wb.action("createProfile", { name: "invalid", model: "missing" }));
  await assert.rejects(wb.action("createProfile", { name: "invalid", model: "available-model", reasoningEffort: "unsupported" }));
  assert.equal((await wb.snapshot("A")).active.name, "scoped"); await wb.close();
});

test("profile options project cached metadata without credentials or stock fallback", async () => {
  const { base, wb } = await fixture();
  const { readProfileOptions } = require("../instruction-workbench-options.cjs");
  const nativeModelsPath = path.join(base, "model-observation.json");
  const cache = { identity: "fixture-observation", client_version: "1.0.0", fetched_at: new Date().toISOString(), private_token: "must-not-leak", models: [{ slug: "fixture-model", display_name: "Fixture model", supported_reasoning_levels: [{ effort: "medium", description: "Medium" }], default_reasoning_level: "medium", private_token: "must-not-leak" }] };
  await fs.writeFile(nativeModelsPath, JSON.stringify(cache));
  const input = { codexHome: base, env: {}, nativeModelsPath, openaiAccounts: async () => [{ id: "a".repeat(32), label: "Linked" }, { id: "b".repeat(32), label: "Reauth", needsReauth: true }, { id: "c".repeat(32), label: "Removed", removed: true }], providerAccounts: async () => ({ providers: [], availableProviders: [] }) };
  const result = await readProfileOptions(input);
  assert.equal(result.providers.length, 1); assert.equal(result.models.length, 1); assert.equal(result.cached, true);
  assert.equal(result.models[0].supportedReasoningEfforts[0].reasoningEffort, "medium");
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false); assert.equal(JSON.stringify(result).includes("fixture-observation"), false);
  // Keep inventory separate from activation when selection/recovery adapters change.
  const accountStateFile = path.join(base, "account-state.json"), openaiProfilesRoot = path.join(base, "accounts");
  for (const [id, marker] of [["a".repeat(32), null], ["b".repeat(32), "reauth.v1"], ["c".repeat(32), "removed.v1"]]) {
    const directory = path.join(openaiProfilesRoot, id); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "profile.json"), JSON.stringify({ id, email: "linked@example.test", workspaceAccountId: "workspace", userId: "user", planType: "team" }));
    if (marker) await fs.writeFile(path.join(directory, marker), "");
  }
  const nativeInput = { ...input, openaiAccounts: undefined, accountStateFile, openaiProfilesRoot };
  await fs.writeFile(accountStateFile, JSON.stringify({ selectedProfileId: "a".repeat(32), requiresRecovery: true }));
  const recovering = await readProfileOptions(nativeInput);
  assert.equal(recovering.providers.length, 1); assert.equal(recovering.models.length, 1);
  assert.equal(recovering.providers[0].selected, false);
  await fs.writeFile(accountStateFile, JSON.stringify({ selectedProfileId: "a".repeat(32), requiresRecovery: false }));
  assert.equal((await readProfileOptions(nativeInput)).providers[0].selected, true);
  await fs.writeFile(accountStateFile, JSON.stringify({ selectedProfileId: "invalid", requiresRecovery: true }));
  assert.equal((await readProfileOptions(nativeInput)).providers.length, 0);
  delete cache.identity; await fs.writeFile(nativeModelsPath, JSON.stringify(cache));
  const stock = await readProfileOptions(input); assert.equal(stock.models.length, 0); assert.equal(stock.providers.length, 1);
  await wb.close();
});

// Retain these transitions: later composer wiring can accidentally equip on save,
// trust client payloads, or replace the last valid request with an invalid draft.
test("composer saves pinned selected resources, duplicates independently and preserves last valid active state", async () => {
  let online = true, resolutions = 0;
  const hostSkill = { id: "host:skill", kind: "skill", name: "Host skill", available: true, external: true };
  const { wb, options } = await fixture({
    readComposerResources: async () => ({ core: { id: "core", name: "Core", text: "Required identity" }, resources: online ? [hostSkill, { id: "host:mcp", kind: "mcp", name: "Server", serverId: "safe-server", available: true, token: "must-not-leak" }] : [], errors: [] }),
    resolveComposerResource: async id => { resolutions++; return { ...hostSkill, id, component: component("host-skill") }; }
  });
  const pkg = await wb.action("createPackage", { title: "Instructions", description: "", components: [{ id: "base", kind: "instruction", name: "Base", files: [file("base.md", "server bytes")] }], profiles: [] });
  const resources = await wb.composerResources();
  assert.equal(resolutions, 0);
  assert.equal(resources.core.text, "Required identity");
  assert.equal(JSON.stringify(resources).includes("must-not-leak"), false);
  const base = resources.resources.find(r => r.component?.name === "Base");
  const saved = await wb.action("saveProfile", { name: "Custom", resourceIds: [base.id, "host:skill", "host:mcp"], components: [{ files: [file("base.md", "forged")] }], instructions: "extra" });
  assert.equal(resolutions, 1);
  assert.equal(saved.profile.readOnly, false);
  assert.equal((await wb.snapshot("A")).active.isDefault, true);
  await wb.action("equip", { projectId: "A", profileId: saved.profile.id });
  const capture = await wb.action("captureRequest", { projectId: "A" });
  assert.equal(capture.components[0].files[0].content, "server bytes");
  assert.equal(capture.components[0].loading, "persistent");
  assert.deepEqual(capture.profile.mcpServerIds, ["safe-server"]);
  assert.equal(capture.profile.optionalSelection, "selected-only");
  online = false;
  const invalid = await wb.action("saveProfile", { profileId: saved.profile.id, name: "Invalid draft", resourceIds: [base.id, "host:skill", "host:mcp", "missing"], instructions: "invalid edit" });
  assert.equal(invalid.profile.diagnostics.length, 3);
  await assert.rejects(wb.action("equip", { projectId: "B", profileId: saved.profile.id }), /프로필 오류/);
  await assert.rejects(wb.action("captureRequest", { projectId: "A" }), /리소스/);
  online = true;
  const current = await wb.action("captureRequest", { projectId: "A" });
  assert.deepEqual(current.components, capture.components);
  assert.equal(current.profile.instructions, "extra");
  assert.equal((await wb.snapshot("A")).active.appliedDiffers, true);
  const duplicate = await wb.action("duplicateProfile", { profileId: saved.profile.id });
  assert.notEqual(duplicate.profile.id, saved.profile.id);
  assert.deepEqual(duplicate.profile.resourceIds, invalid.profile.resourceIds);
  const repaired = await wb.action("saveProfile", { profileId: saved.profile.id, name: "Empty optional", resourceIds: [] });
  assert.deepEqual(repaired.profile.diagnostics, []);
  assert.equal((await wb.snapshot("A")).active.appliedDiffers, false);
  assert.deepEqual((await wb.action("captureRequest", { projectId: "A" })).components, []);
  const restarted = new InstructionWorkbench(options);
  assert.equal((await restarted.action("captureRequest", { projectId: "A" })).profile.name, "Empty optional");
  assert.equal((await restarted.snapshot()).profiles.find(p => p.id === duplicate.profile.id).name, "Invalid draft 사본");
  assert.equal(Object.isFrozen(capture.components[0].files), true);
  assert.ok(pkg.key);
});

test("default profile is read only and duplication never changes project activation", async () => {
  const { wb } = await fixture({ readComposerResources: async () => ({ resources: [
    { id: "host:on", kind: "mcp", name: "enabled", serverId: "enabled", available: true, defaultEnabled: true },
    { id: "host:off", kind: "mcp", name: "disabled", serverId: "disabled", available: true, defaultEnabled: false }
  ] }) });
  const initial = await wb.snapshot("A");
  assert.equal(initial.active.id, "__azrael_default__");
  await assert.rejects(wb.action("saveProfile", { profileId: initial.active.id, name: "overwrite", resourceIds: [] }), /복제/);
  const duplicate = await wb.action("duplicateProfile", { profileId: initial.active.id, expectedRevision: initial.revision });
  assert.equal(duplicate.profile.readOnly, false);
  assert.deepEqual(duplicate.profile.resourceIds, ["host:on"]);
  assert.equal((await wb.snapshot("A")).active.isDefault, true);
  await wb.action("equip", { projectId: "A", profileId: duplicate.profile.id });
  await wb.action("equip", { projectId: "A", profileId: "__azrael_default__" });
  assert.equal((await wb.action("captureRequest", { projectId: "A" })).profile, null);
  const invalid = await wb.action("saveProfile", { name: "Incomplete model settings", resourceIds: [], provider: "", model: "", reasoningEffort: "" });
  assert.ok(invalid.profile.diagnostics.some(d => d.code === "model-required"));
  assert.ok(invalid.profile.diagnostics.some(d => d.code === "provider-required"));
  await assert.rejects(wb.action("equip", { projectId: "A", profileId: invalid.profile.id }), /프로필 오류/);
});

test("package profile templates and legacy pinned components remain independently editable", async () => {
  const { wb } = await fixture();
  const pkg = await wb.action("createPackage", { title: "Template package", description: "", components: [component()], profiles: [{ id: "recipe", name: "Recipe", componentIds: ["example"], model: "m1" }] });
  const listing = await wb.snapshot("A");
  const template = listing.profiles.find(p => p.isTemplate);
  assert.equal(template.packageKey, pkg.key);
  assert.equal(template.readOnly, false);
  assert.equal((await wb.snapshot()).profiles.find(p => p.isTemplate).id, template.id);
  const saved = await wb.action("saveProfile", { profileId: template.id, name: "Personal", resourceIds: template.resourceIds });
  assert.notEqual(saved.profile.id, template.id);
  assert.equal((await wb.snapshot("A")).active.isDefault, true);
  const equipped = await wb.action("equip", { projectId: "B", profileId: template.id });
  assert.notEqual(equipped.profileId, template.id);
  assert.equal((await wb.action("captureRequest", { projectId: "B" })).components[0].files[1].content, "support bytes");
  const legacy = await wb.action("createProfile", { name: "Legacy", packageKey: pkg.key });
  const summary = (await wb.snapshot()).profiles.find(p => p.id === legacy.profile.id);
  assert.equal(summary.resourceIds.length, 1);
  const resources = await wb.composerResources();
  assert.equal(resources.resources.find(r => r.id === summary.resourceIds[0]).component.files[1].content, "support bytes");
  await wb.action("saveProfile", { profileId: legacy.profile.id, name: "Legacy edited", resourceIds: summary.resourceIds });
  await wb.action("equip", { projectId: "A", profileId: legacy.profile.id });
  assert.equal((await wb.action("captureRequest", { projectId: "A" })).components[0].files[1].content, "support bytes");
  const duplicate = await wb.action("duplicateProfile", { profileId: template.id });
  assert.equal(duplicate.profile.isTemplate, undefined);
  assert.notEqual(duplicate.profile.id, template.id);
});
