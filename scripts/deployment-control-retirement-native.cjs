"use strict";
// Metadata custody for the deployment control owner; never hydrates or edits
// native storage and never invokes native queries while holding maintenance.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const resolver = require("./maintenance-owner-config.cjs");
function validateControlCapabilities(value) {
  // This owner fences one legacy manifest. It cannot claim custody of the
  // separate detail files used by other storage formats.
  if (value?.schema !== 1 || value.protocol !== "maintenance-owner-lease-v1" ||
      value.platform?.os !== process.platform || value.platform?.arch !== process.arch ||
      !Array.isArray(value.operations) || !value.operations.includes("inventory") ||
      !Array.isArray(value.request_transports) || !value.request_transports.includes("stdin") ||
      !Array.isArray(value.storage_formats) || value.storage_formats.length !== 1 || value.storage_formats[0] !== "legacy") {
    throw Error("Legacy-only native control-retirement capabilities required");
  }
  return value;
}
module.exports.validateControlCapabilities = validateControlCapabilities;
module.exports.createNativeGuard = ({ checked, identity, absent, sha, inside, overlaps, same }) => {
  function stamp(root, filename, optional = false) {
    checked(root, filename);
    if (optional && absent(filename)) return { path: filename, absent: true };
    const before = identity(filename, "file"), bytes = fs.readFileSync(filename);
    same(identity(filename, "file"), before, "Native control file identity changed during observation");
    return { path: filename, identity: before, sha256: sha(bytes) };
  }
  function controls(root) {
    return { config: stamp(root, path.join(root, "project-maintenance.json")),
      manifest: stamp(root, path.join(root, "artifacts/maintenance/manifest.json"), true) };
  }
  function command() {
    const value = resolver.resolveMaintenanceCommand();
    const before = identity(value.executable, "file"), hash = sha(fs.readFileSync(value.executable));
    same(identity(value.executable, "file"), before, "Installed native owner identity changed");
    return { ...value, identity: before, sha256: hash };
  }
  function verify(root, snapshot) {
    same(controls(root), snapshot.controls, "Native manifest/config changed; fresh retirement preparation required");
    same(command(), snapshot.command, "Installed native owner changed");
  }
  async function query(owner, root, request, audit) {
    const args = request ? [...owner.args, "--project-root", root, "--request", "-"] : [...owner.args, "capabilities"];
    const terminal = await new Promise(resolve => {
      const child = spawn(owner.executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      let stdout = "", stderr = "", overflow = false, error = null, exit = null;
      child.stdout.on("data", bytes => { if (Buffer.byteLength(stdout) + Buffer.byteLength(bytes) <= 32 * 1024 * 1024) stdout += bytes; else overflow = true; });
      child.stderr.on("data", bytes => { stderr = (stderr + bytes).slice(-16384); });
      child.on("error", value => { error = value.message; });
      child.stdin.on("error", value => { error = value.message; });
      child.on("exit", (code, signal) => { exit = { code, signal }; });
      child.on("close", () => resolve({ stdout, stderr, pid: child.pid ?? null, exit_observed: exit !== null,
        exit_code: exit?.code ?? null, signal: exit?.signal ?? null, close_observed: true, stdout_drained: true, stderr_drained: true, overflow, error }));
      child.stdin.end(request ? JSON.stringify(request) : undefined);
    });
    const { stdout, ...observation } = terminal;
    audit({ request: request || { operation: "capabilities" }, ...observation, response_sha256: sha(stdout) });
    if (terminal.error || terminal.overflow || !terminal.exit_observed || terminal.exit_code !== 0 || terminal.signal !== null) throw Error(`Native metadata query failed: ${JSON.stringify(observation)}`);
    let value;
    try { value = JSON.parse(stdout); } catch { throw Error("Invalid native metadata JSON response"); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Native metadata object required");
    return value;
  }
  function configScope(root, target) {
    const config = JSON.parse(fs.readFileSync(path.join(root, "project-maintenance.json"), "utf8"));
    if (config.schema_version !== 1 || typeof config.project_id !== "string" || !Array.isArray(config.managed_roots) || !Array.isArray(config.protected_paths || [])) throw Error("Supported native maintenance configuration required");
    const resolved = value => nativePath(root, value);
    for (const value of config.protected_paths || []) if (overlaps(resolved(value), target)) throw Error("Configured native protection overlaps retirement workspace");
    // This dedicated generated-control owner does not extend generic managed
    // membership, root-self retirement or any native deletion exception.
    for (const value of config.managed_roots) if (inside(target, resolved(value))) throw Error("Configured managed root itself or its ancestor cannot be retired");
    return config.project_id;
  }
  function nativePath(root, value) {
    if (typeof value !== "string" || !value || value.includes("\0")) throw Error("Native metadata path required");
    const resolved = path.resolve(root, value);
    if (resolved.slice(path.parse(resolved).root.length).split(path.sep).some(part => /:/.test(part) || /[. ]$/.test(part))) throw Error("Ambiguous Windows native metadata path");
    return resolved;
  }
  function metadataPath(root, value, field) {
    // Legacy native groups permit a documentation reference with an annotation.
    // Keep real path fields strict, and protect the physical document prefix.
    const annotation = field === "provenance_ref" && typeof value === "string" && /^([^\r\n\0]+\.md):[ \t]+[^\r\n\0]+$/i.exec(value);
    if (!annotation) return nativePath(root, value);
    const document = nativePath(root, annotation[1]);
    checked(root, document);
    identity(document, "file");
    return document;
  }
  function referencePaths(root, object, depth = 0, output = []) {
    if (depth > 32 || output.length > 10000) throw Error("Unbounded native provenance metadata");
    if (typeof object === "string") { if (path.isAbsolute(object)) output.push(nativePath(root, object)); }
    else if (Array.isArray(object)) for (const value of object) referencePaths(root, value, depth + 1, output);
    else if (object && typeof object === "object") for (const [key, value] of Object.entries(object)) {
      if (/(?:^|_)(?:path|root|ref|source|destination)$/.test(key) && typeof value === "string" && value) output.push(metadataPath(root, value, key));
      else referencePaths(root, value, depth + 1, output);
    }
    return output;
  }
  function decisionScope(root, target, decisions, items, groups) {
    const byItem = new Map(items.map(item => [item.id, item]));
    const byGroup = new Map(groups.map(group => [group.id, group]));
    const explicitPaths = (object, output = [], depth = 0) => {
      if (depth > 32 || output.length > 10000) throw Error("Unbounded native decision scope");
      if (typeof object === "string") {
        if (path.isAbsolute(object)) output.push(nativePath(root, object));
      } else if (Array.isArray(object)) {
        for (const value of object) explicitPaths(value, output, depth + 1);
      } else if (object && typeof object === "object") {
        for (const [key, value] of Object.entries(object)) {
          if (/(?:^|_)(?:path|root|ref|source|destination|target)s?$/.test(key) && value != null) {
            const paths = Array.isArray(value) ? value : [value];
            if (paths.some(file => typeof file !== "string" || !file)) throw Error("Uncertain explicit native decision path");
            for (const file of paths) output.push(metadataPath(root, file, key));
          } else explicitPaths(value, output, depth + 1);
        }
      }
      return output;
    };
    const disjoint = [];
    for (const decision of decisions) {
      if (!["pending", "unknown"].includes(decision.status)) continue;
      const item = typeof decision.id === "string" && byItem.get(decision.id);
      if (!item || typeof item.path !== "string" || !path.isAbsolute(item.path) ||
          [decision.lifecycle_group_id, item.lifecycle_group_id].some(id => id != null && (typeof id !== "string" || !id)) ||
          (decision.lifecycle_group_id ?? null) !== (item.lifecycle_group_id ?? null)) throw Error("Unresolved native decision item/group binding");
      let members = [item], group;
      if (item.lifecycle_group_id) {
        group = byGroup.get(item.lifecycle_group_id);
        if (!group || group.membership_complete !== true || !Array.isArray(group.members) ||
            group.members.some(id => typeof id !== "string" || !byItem.has(id)) || new Set(group.members).size !== group.members.length ||
            !group.members.includes(item.id)) throw Error("Incomplete native decision group scope");
        members = group.members.map(id => byItem.get(id));
        const inverse = items.filter(value => value.lifecycle_group_id === group.id);
        if (inverse.length !== members.length || members.some(value => value.lifecycle_group_id !== group.id || typeof value.path !== "string" || !path.isAbsolute(value.path))) throw Error("Contradictory native decision group scope");
      }
      const paths = explicitPaths(decision);
      for (const member of members) explicitPaths(member, paths);
      if (group) explicitPaths(group, paths);
      if (paths.some(value => overlaps(value, target))) throw Error(`Pending/unknown native decision protects retirement scope: ${decision.id}`);
      disjoint.push({ id: decision.id, decision_id: decision.decision_id ?? null, status: decision.status,
        lifecycle_group_id: item.lifecycle_group_id ?? null, paths_checked: paths.length, sha256: sha(JSON.stringify(decision)) });
    }
    return disjoint;
  }
  function inventoryDecisionScope(root, target, manifestFence, decisions, items, groups) {
    const needed = new Set(decisions.filter(value => ["pending", "unknown"].includes(value.status))
      .map(value => value.lifecycle_group_id).filter(value => typeof value === "string" && value));
    if (!needed.size) return decisionScope(root, target, decisions, items, groups);
    if (manifestFence.absent) throw Error("Pending native group requires fenced legacy manifest");
    checked(root, manifestFence.path);
    same(identity(manifestFence.path, "file"), manifestFence.identity, "Legacy group manifest identity changed");
    const bytes = fs.readFileSync(manifestFence.path);
    same(identity(manifestFence.path, "file"), manifestFence.identity, "Legacy group manifest identity changed during read");
    if (sha(bytes) !== manifestFence.sha256) throw Error("Legacy group manifest bytes changed");
    const stored = JSON.parse(bytes);
    if (!stored.groups || typeof stored.groups !== "object" || Array.isArray(stored.groups)) throw Error("Legacy native group mapping required");
    const byItem = new Map(items.map(item => [item.id, item]));
    const detailed = groups.map(summary => {
      if (!needed.has(summary.id)) return summary;
      const group = stored.groups[summary.id];
      if (!group || typeof group !== "object" || Array.isArray(group)) throw Error("Fenced native decision group missing");
      for (const field of ["id", "kind", "owner", "version", "membership_complete", "provenance_ref", "membership_source",
        "membership_source_format", "membership_source_identity", "cleanup_status"]) {
        same(summary[field], group[field] ?? null, `Native decision group summary mismatch: ${field}`);
      }
      if (!Array.isArray(group.members) || group.members.some(id => typeof id !== "string" || !byItem.has(id)) ||
          new Set(group.members).size !== group.members.length || !Number.isSafeInteger(summary.members_total) ||
          summary.members_total !== group.members.length || !Number.isSafeInteger(summary.cached_live_members)) throw Error("Incomplete native decision group projection");
      const live = group.members.filter(id => byItem.get(id).cleanup_status !== "deleted" || byItem.get(id).remaining !== false).length;
      if (summary.cached_live_members !== live) throw Error("Native decision group cached membership mismatch");
      return { ...group, ...summary, members: group.members };
    });
    return decisionScope(root, target, decisions, items, detailed);
  }
  function claims(root, target, items, groups) {
    const byGroup = new Map(groups.map(group => [group.id, group]));
    const tombstones = [];
    for (const group of groups) {
      for (const field of ["membership_source", "provenance_ref"]) {
        if (group[field] != null && typeof group[field] !== "string") throw Error("Invalid native group provenance path");
        if (group[field] && overlaps(metadataPath(root, group[field], field), target)) throw Error(`Native group evidence protects workspace: ${group.id}`);
      }
    }
    for (const item of items) {
      if (typeof item.path !== "string" || !path.isAbsolute(item.path) || !Array.isArray(item.references)) throw Error("Complete native item path/reference metadata required");
      const references = referencePaths(root, item.provenance);
      for (const field of ["source_path", "provenance_ref"]) {
        if (item[field] != null && typeof item[field] !== "string") throw Error("Invalid native item source/provenance path");
        if (item[field]) references.push(metadataPath(root, item[field], field));
      }
      const itemPath = nativePath(root, item.path);
      if (!overlaps(itemPath, target) && !references.some(value => overlaps(value, target))) continue;
      const group = item.lifecycle_group_id ? byGroup.get(item.lifecycle_group_id) : null;
      if (item.lifecycle_group_id && !group) throw Error("Native item group missing from complete inventory");
      if (item.cleanup_status !== "deleted" || item.remaining !== false || item.generated !== true || item.protection_known !== true ||
          item.references.length || item.retain_reason || item.reservation_protection || item.nested_retirement_requires_registration ||
          group && (group.membership_complete !== true || group.cached_live_members !== 0 || group.cleanup_status !== "deleted" || group.reservation_protection) || !absent(item.path)) {
        throw Error(`Live or uncertain ordinary native claim protects workspace: ${item.id}`);
      }
      tombstones.push({ id: item.id, path: item.path, sha256: sha(JSON.stringify(item)), lifecycle_group_id: item.lifecycle_group_id ?? null });
    }
    return tombstones;
  }
  async function capture(root, target, audit = () => {}) {
    const before = controls(root), owner = command(), projectId = configScope(root, target), queries = [];
    const observe = value => { queries.push(value); audit(value); };
    const capabilities = await query(owner, root, null, observe);
    validateControlCapabilities(capabilities);
    const items = [], groups = [], decisions = [], runs = new Map(), ids = new Set(), groupIds = new Set();
    let totals = null;
    for (let offset = 0;; offset += 200) {
      const page = await query(owner, root, { operation: "inventory", offset, limit: 200 }, observe);
      if (page.project_root !== root || page.project_id !== projectId || !Array.isArray(page.items) || !Array.isArray(page.groups) || !page.runs || Array.isArray(page.runs)) throw Error("Incomplete native inventory response");
      const pagination = page.pagination;
      if (!pagination || pagination.offset !== offset || pagination.limit !== 200) throw Error("Native inventory pagination mismatch");
      const next = Object.fromEntries(["total", "groups_total", "runs_total", "decisions_total", "bundles_total"].map(key => [key, pagination[key]]));
      if (Object.values(next).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100000)) throw Error("Unsupported native inventory totals");
      if (next.runs_total && !capabilities.operations?.includes("run_status")) throw Error("Installed native owner does not advertise run_status; ordinary run input custody cannot be verified");
      if (totals) same(next, totals, "Native inventory totals changed during pagination"); else totals = next;
      if (page.items.length !== Math.min(200, Math.max(0, totals.total - offset)) || page.groups.length !== Math.min(200, Math.max(0, totals.groups_total - offset)) || Object.keys(page.runs).length !== Math.min(200, Math.max(0, totals.runs_total - offset))) throw Error("Partial native inventory page");
      if (!Array.isArray(page.decisions) || page.decisions.length !== Math.min(200, Math.max(0, totals.decisions_total - offset)) ||
          !Array.isArray(page.bundles) || page.bundles.length !== Math.min(200, Math.max(0, totals.bundles_total - offset))) throw Error("Partial native decision/bundle metadata page");
      for (const item of page.items) { if (typeof item.id !== "string" || ids.has(item.id)) throw Error("Duplicate/missing native inventory item identity"); ids.add(item.id); items.push(item); }
      for (const group of page.groups) { if (typeof group.id !== "string" || groupIds.has(group.id)) throw Error("Duplicate/missing native group identity"); groupIds.add(group.id); groups.push(group); }
      for (const [id, run] of Object.entries(page.runs)) { if (runs.has(id) || run.run_id !== id || !Number.isSafeInteger(run.steps_total) || run.steps_total < 0) throw Error("Duplicate/missing native run identity or invalid step total"); runs.set(id, run); }
      decisions.push(...page.decisions);
      same(controls(root), before, "Native metadata changed during pagination");
      if (offset + 200 >= Math.max(totals.total, totals.groups_total, totals.runs_total, totals.decisions_total, totals.bundles_total)) break;
    }
    // Validate complete inventory/projection bindings before the expensive run
    // readers. Native inventory intentionally omits group member IDs.
    const disjointPendingDecisions = inventoryDecisionScope(root, target, before.manifest, decisions, items, groups);
    const tombstones = claims(root, target, items, groups);
    for (const [id, summary] of runs) {
      let total = null;
      for (let offset = 0;; offset += 200) {
        const run = await query(owner, root, { operation: "run_status", run_id: id, offset, limit: 200 }, observe);
        if (run.run_id !== id || !Array.isArray(run.steps) || !run.pagination || run.pagination.offset !== offset || run.pagination.limit !== 200 || !Number.isSafeInteger(run.pagination.total) || run.pagination.total < 0) throw Error("Incomplete native run reader metadata");
        if (total !== null && total !== run.pagination.total || run.pagination.total !== summary.steps_total) throw Error("Native run step totals changed");
        total = run.pagination.total;
        if (run.steps.length !== Math.min(200, Math.max(0, total - offset))) throw Error("Partial native run reader page");
        for (const step of run.steps) {
          const active = step.producer_completed === false || ["unknown", "interrupted"].includes(step.status) && step.producer_completed !== true;
          if (!Array.isArray(step.inputs) || !["passed", "failed", "interrupted", "unknown", "not_run"].includes(step.status)) throw Error("Unknown native run custody shape");
          for (const input of step.inputs) {
            if (typeof input.path !== "string" || !path.isAbsolute(input.path)) throw Error("Native run input path missing");
            if (active && overlaps(input.path, target)) throw Error(`Active or unresolved native run input protects workspace: ${id}`);
          }
          if (active && items.some(item => overlaps(item.path, target) && (item.run_id === id || item.provenance?.run_id === id))) throw Error("Active native item producer protects workspace");
        }
        same(controls(root), before, "Native metadata changed during reader query");
        if (offset + 200 >= total) break;
      }
    }
    same(controls(root), before, "Native metadata changed before snapshot publication");
    same(command(), owner, "Installed native owner changed during metadata queries");
    return { controls: before, command: owner, capabilities, totals, tombstones, disjointPendingDecisions, queries };
  }
  function quiescent(root, observers = []) {
    for (const filename of [path.join(root, "artifacts/maintenance/manifest.pending")]) if (!absent(filename)) throw Error("Pending native state requires existing explicit recovery");
    const catalog = checked(root, path.join(root, "artifacts/maintenance/lifecycles"));
    identity(catalog, "directory");
    if (fs.readdirSync(catalog).some(name => name.endsWith(".pending"))) throw Error("Pending lifecycle publication requires existing explicit recovery");
    const directory = path.join(root, "artifacts/maintenance/lifecycles/reservations");
    checked(root, directory);
    if (absent(directory)) { if (observers.length) throw Error("Owned reservation directory disappeared"); return; }
    identity(directory, "directory");
    const seen = new Set();
    for (const name of fs.readdirSync(directory)) {
      if (!name.endsWith(".json")) continue;
      const filename = checked(root, path.join(directory, name));
      const before = identity(filename, "file"), bytes = fs.readFileSync(filename);
      same(identity(filename, "file"), before, "Active reservation changed while observing custody");
      const fence = JSON.parse(bytes), expected = observers.find(value => value.id === fence.id);
      if (!expected || name !== sha(JSON.stringify(fence.id)) + ".json") throw Error("Foreign active/suspended native writer or cleanup reservation protects metadata custody");
      same(fence, expected.fence, "Owned reservation fence changed during maintenance custody");
      seen.add(fence.id);
    }
    if (observers.some(value => !seen.has(value.id))) throw Error("Owned reservation disappeared during metadata custody");
  }
  return { capture, verify, quiescent, validateDecisionScope: decisionScope, validateInventoryDecisionScope: inventoryDecisionScope, validateInventoryClaims: claims };
};
