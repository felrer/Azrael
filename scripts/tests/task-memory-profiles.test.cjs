"use strict";
// Retained: adding optional multi-file instruction components must preserve ordered
// persistent projection, pinned bytes and isolation from unselected role fragments.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { InstructionWorkbench } = require("../instruction-workbench.cjs");
const { TaskProfileRuntime } = require("../task-profile-runtime.cjs");
const { RoleProfileStore } = require("../role-profile-store.cjs");
const { materializePolicy } = require("../role-profile-runtime.cjs");

test("optional task-memory components compose shared then selected role through actual profile materialization", async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "azrael-task-memory-profiles-"));
  let wb;
  t.after(async () => {
    if (wb) await wb.close();
    await fs.rm(temporary, { recursive: true });
    await assert.rejects(fs.stat(temporary), { code: "ENOENT" });
  });
  const baselineRoot = path.resolve(__dirname, "../../instructions");
  const texts = Object.fromEntries(await Promise.all(["shared", "root", "subagent"].map(async name => [name, await fs.readFile(path.join(baselineRoot, "task-memory", name + ".md"), "utf8")])));
  const manifest = JSON.parse(await fs.readFile(path.join(baselineRoot, "azrael-environment.json"), "utf8"));
  for (const role of ["root", "subagent"]) assert.equal(manifest.components.find(c => c.id === "task-memory-" + role).default, false);
  const codexHome = path.join(temporary, "home");
  const repository = new RoleProfileStore({ codexHome, models: async () => [] });
  wb = new InstructionWorkbench({ root: path.join(temporary, "workbench"), installedRoot: path.join(temporary, "installed"), baselineRoot, profileRepository: repository, projects: [{ id: "A", name: "A" }] });
  const initial = await wb.action("captureRequest", { projectId: "A" });
  assert.equal(initial.profile, null);
  const resources = await wb.composerResources();
  const runtime = new TaskProfileRuntime({ codexHome, request: async method => method === "model/list" ? { data: [{ model: "model", modelProvider: "openai", supportedReasoningEfforts: [] }], nextCursor: null } : { config: { model: "model" } } });
  const saved = {};
  for (const role of ["root", "subagent"]) {
    const resource = resources.resources.find(r => r.componentId === "task-memory-" + role);
    assert(resource);
    assert(!resources.defaultResourceIds.includes(resource.id));
    saved[role] = (await wb.action("saveProfile", { name: role, allowedRoles: [role], resourceIds: [resource.id] })).profile.id;
  }
  await wb.action("equip", { projectId: "A", profileId: saved.root });
  const rootCapture = await wb.action("captureRequest", { projectId: "A" });
  const rootRef = await runtime.createWorkbench(rootCapture);
  const rootSnapshot = await runtime.readSnapshot(rootRef.digest);
  function check(snapshot, role) {
    for (const name of ["shared", role]) assert.equal(snapshot.context.split(texts[name]).length - 1, 1);
    assert(snapshot.context.indexOf(texts.shared) < snapshot.context.indexOf(texts[role]));
    assert(!snapshot.context.includes(texts[role === "root" ? "subagent" : "root"]));
  }
  check(rootSnapshot, "root");
  const library = await repository.snapshotLibrary();
  const child = library.profiles.find(p => p.id === saved.subagent);
  assert.deepEqual(child.components[0].files.map(f => f.content), [texts.shared, texts.subagent]);
  const policy = await materializePolicy({ mode: "direct", revision: library.revision, rootProfileId: saved.root, rootProfileIds: [saved.root], subagentProfileIds: [saved.subagent], profiles: library.profiles.filter(p => Object.values(saved).includes(p.id)) }, undefined, capture => runtime.createWorkbench(capture));
  const childRef = policy.profiles.find(p => p.id === saved.subagent).profile_extension.agentProfile;
  check(await runtime.readSnapshot(childRef.digest), "subagent");
  const empty = (await wb.action("saveProfile", { name: "Without memory", allowedRoles: ["root"], resourceIds: [] })).profile.id;
  await wb.action("equip", { projectId: "A", profileId: empty });
  const emptyRef = await runtime.createWorkbench(await wb.action("captureRequest", { projectId: "A" }));
  assert.equal((await runtime.readSnapshot(emptyRef.digest)).context, "");
  check(await runtime.readSnapshot(rootRef.digest), "root");
});
