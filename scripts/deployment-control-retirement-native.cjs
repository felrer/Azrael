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
  function hasReferencePath(root, object, predicate) {
    let visited = 0;
    const count = depth => {
      if (++visited > 2000000 || depth > 32) throw Error("Unbounded native provenance metadata");
    };
    const visit = (value, depth) => {
      count(depth);
      if (typeof value === "string") return path.isAbsolute(value) && predicate(nativePath(root, value));
      if (Array.isArray(value)) {
        for (const item of value) if (visit(item, depth + 1)) return true;
      } else if (value && typeof value === "object") {
        // Iterate own fields without retaining an entries or path array.
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          const item = value[key];
          if (/(?:^|_)(?:path|root|ref|source|destination)$/.test(key) && typeof item === "string" && item) {
            // Legacy reference fields are interpreted at their container depth.
            count(depth);
            if (predicate(metadataPath(root, item, key))) return true;
          } else if (visit(item, depth + 1)) return true;
        }
      }
      return false;
    };
    return visit(object, 0);
  }
  function registrySourcePaths(root, group) {
    if (group.membership_source_format !== "producer_registry_v1") return null;
    const source = group.membership_source, catalog = path.join(root, "artifacts/maintenance/lifecycles");
    if (typeof source !== "string" || !path.isAbsolute(source) || source.split(/[\\/]/).some(part => part === "." || part === "..") ||
        (process.platform === "win32" ? source.replaceAll("/", path.sep) : source) !== catalog ||
        typeof group.id !== "string" || !group.id.trim() || typeof group.owner !== "string" || !group.owner.trim() ||
        typeof group.membership_complete !== "boolean" || typeof group.membership_source_identity !== "string" || !/^[a-f0-9]{64}$/.test(group.membership_source_identity)) {
      return null; // Unsupported bindings retain ordinary physical path protection.
    }
    // The catalog is a namespace; this group's own publication remains protected.
    const stem = sha(group.id);
    return [path.join(catalog, stem + ".json"), path.join(catalog, stem + ".pending")];
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
      if (group) {
        const sourcePaths = registrySourcePaths(root, group);
        if (sourcePaths) {
          paths.push(...sourcePaths);
          explicitPaths({ ...group, membership_source: null }, paths);
        } else explicitPaths(group, paths);
      }
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
      const sourcePaths = registrySourcePaths(root, group);
      if (sourcePaths?.some(filename => overlaps(filename, target))) throw Error(`Native group publication protects workspace: ${group.id}`);
      for (const field of ["membership_source", "provenance_ref"]) {
        if (field === "membership_source" && sourcePaths) continue;
        if (group[field] != null && typeof group[field] !== "string") throw Error("Invalid native group provenance path");
        if (group[field] && overlaps(metadataPath(root, group[field], field), target)) throw Error(`Native group evidence protects workspace: ${group.id}`);
      }
    }
    for (const item of items) {
      if (typeof item.path !== "string" || !path.isAbsolute(item.path) || !Array.isArray(item.references)) throw Error("Complete native item path/reference metadata required");
      let referenced = hasReferencePath(root, item.provenance, value => overlaps(value, target));
      for (const field of ["source_path", "provenance_ref"]) {
        if (item[field] != null && typeof item[field] !== "string") throw Error("Invalid native item source/provenance path");
        if (item[field] && overlaps(metadataPath(root, item[field], field), target)) referenced = true;
      }
      const itemPath = nativePath(root, item.path);
      if (!overlaps(itemPath, target) && !referenced) continue;
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
  function publicationAssociations(entries, objects) {
    const stems = new Set(entries.map(entry => path.basename(entry.path, ".pending")));
    let visited = 0;
    function visit(value, depth) {
      if (++visited > 2000000 || depth > 32) throw Error("Unbounded publication ownership metadata");
      if (typeof value === "string") {
        if (stems.has(value) || stems.has(sha(value))) throw Error("Existing native publication owner association");
      } else if (Array.isArray(value)) for (const child of value) visit(child, depth + 1);
      else if (value && typeof value === "object") for (const child of Object.values(value)) visit(child, depth + 1);
    }
    for (const value of objects) visit(value, 0);
  }
  function publicationCatalog(root, entries, records) {
    publicationAssociations(entries, records);
    const targets = entries.flatMap(entry => [entry.path, entry.path.slice(0, -8) + ".json"]);
    for (const record of records) {
      if (hasReferencePath(root, record, value => targets.some(target => overlaps(value, target)))) throw Error("Existing lifecycle publication ownership or reference");
    }
  }
  async function captureMany(root, targets, audit = () => {}, publications = null) {
    const before = controls(root), owner = command(), projectId = configScope(root, targets[0]), queries = [];
    for (const target of targets.slice(1)) same(configScope(root, target), projectId, "Native project binding changed");
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
    if (publications) publicationAssociations(publications, [...items, ...groups, ...decisions]);
    const disjointPendingDecisions = targets.flatMap(target => inventoryDecisionScope(root, target, before.manifest, decisions, items, groups));
    const tombstones = targets.flatMap(target => claims(root, target, items, groups));
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
            if (active && targets.some(target => overlaps(input.path, target))) throw Error(`Active or unresolved native run input protects workspace: ${id}`);
          }
          if (active && items.some(item => targets.some(target => overlaps(item.path, target)) && (item.run_id === id || item.provenance?.run_id === id))) throw Error("Active native item producer protects workspace");
        }
        same(controls(root), before, "Native metadata changed during reader query");
        if (offset + 200 >= total) break;
      }
    }
    same(controls(root), before, "Native metadata changed before snapshot publication");
    same(command(), owner, "Installed native owner changed during metadata queries");
    return { controls: before, command: owner, capabilities, totals, tombstones, disjointPendingDecisions, queries };
  }
  function capture(root, target, audit) { return captureMany(root, [target], audit); }
  function captureEmptyPublications(root, entries, audit) {
    if (!Array.isArray(entries) || entries.length !== 2 || new Set(entries.map(entry => entry.path)).size !== 2 ||
        entries.some(entry => path.dirname(entry.path) !== path.join(root, "artifacts/maintenance/lifecycles") || !/^[a-f0-9]{64}\.pending$/.test(path.basename(entry.path)))) throw Error("Exact two empty publication paths required");
    // Canonical siblings are protected by the same complete metadata snapshot.
    return captureMany(root, entries.flatMap(entry => [entry.path, entry.path.slice(0, -8) + ".json"]), audit, entries);
  }
  // Only dedicated owners construct this scope from their already checked
  // selections. Omitting it preserves the strict foreign-reservation refusal.
  function reservationScope(root, scope) {
    if (!scope || Object.keys(scope).sort().join(",") !== "ids,paths,pendingStems" ||
        !Array.isArray(scope.paths) || !scope.paths.length || !Array.isArray(scope.ids) || !scope.ids.length ||
        !Array.isArray(scope.pendingStems) || scope.pendingStems.some(value => !/^[a-f0-9]{64}$/.test(value))) throw Error("Exact owner-derived reservation scope required");
    for (const filename of scope.paths) {
      if (typeof filename !== "string" || !path.isAbsolute(filename) || path.normalize(filename) !== filename) throw Error("Absolute normalized reservation scope required");
      checked(root, filename);
    }
    if (scope.ids.some(value => typeof value !== "string" || !value.trim())) throw Error("Exact logical reservation scope required");
    return scope;
  }
  function known(value, fields, label, nested = []) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key) || value[key] !== null && typeof value[key] === "object" && !nested.includes(key))) throw Error("Unclear " + label + " reservation fields");
  }
  function foreignReservation(root, value, scope) {
    const nonempty = value => typeof value === "string" && value.trim().length > 0;
    const hex = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    const catalog = path.join(root, "artifacts/maintenance/lifecycles");
    const catalogSource = filename => typeof filename === "string" && path.isAbsolute(filename) &&
      !filename.split(/[\\/]/).some(part => part === "." || part === "..") &&
      (process.platform === "win32" ? filename.replaceAll("/", path.sep) : filename) === catalog;
    known(value, ["schema", "status", "id", "token", "members", "lease_owner", "manifest_revision", "group_scope", "source", "source_fence", "source_owner", "purpose", "registration_sources"], "foreign", ["members", "lease_owner", "group_scope", "source_owner", "registration_sources"]);
    if (value.schema !== 1 || value.status !== "active" || !nonempty(value.id) || !nonempty(value.token) || !Array.isArray(value.members) ||
        Object.hasOwn(value, "purpose") && value.purpose !== "registration") throw Error("Unsupported active foreign reservation");
    known(value.group_scope, ["id", "owner", "kind", "version", "members", "membership_source", "membership_source_identity"], "group scope", ["members"]);
    if (value.group_scope.id !== value.id || !nonempty(value.group_scope.owner) || !Array.isArray(value.group_scope.members) ||
        value.group_scope.members.some(id => !nonempty(id)) || value.group_scope.members.length !== value.members.length ||
        new Set(value.group_scope.members).size !== value.group_scope.members.length ||
        value.members.some(member => !value.group_scope.members.includes(member?.id)) ||
        !catalogSource(value.group_scope.membership_source) || value.group_scope.membership_source_identity !== null && !hex(value.group_scope.membership_source_identity)) throw Error("Unclear foreign group scope");
    known(value.lease_owner, ["schema", "pid", "token", "operation", "acquired_at_ms"], "lease owner");
    if (value.lease_owner.schema !== 2 || !Number.isSafeInteger(value.lease_owner.pid) || value.lease_owner.pid <= 0 ||
        !nonempty(value.lease_owner.token) || !nonempty(value.lease_owner.operation) || !Number.isSafeInteger(value.lease_owner.acquired_at_ms) ||
        !Number.isSafeInteger(value.manifest_revision) || value.manifest_revision < 0) throw Error("Unclear foreign lease metadata");
    const plainPath = filename => {
      if (!nonempty(filename) || !path.isAbsolute(filename) || path.normalize(filename) !== filename || nativePath(root, filename) !== filename) throw Error("Absolute normalized foreign member path required");
    };
    const references = values => {
      if (!Array.isArray(values)) throw Error("Unclear foreign references");
      for (const ref of values) {
        known(ref, ["id", "kind", "member_paths", "reason", "reference_id"], "reference", ["member_paths"]);
        if (!nonempty(ref.id) || ref.member_paths != null && !Array.isArray(ref.member_paths)) throw Error("Unclear foreign reference binding");
        for (const filename of ref.member_paths || []) plainPath(filename);
      }
    };
    for (const member of value.members) {
      known(member, ["cache_schema", "cleanup_status", "created_at_ms", "generated", "id", "identity", "kind", "lifecycle_group_id", "lifecycle_role", "logical_bytes", "measured_at_ms", "owner", "path", "presence", "protection_known", "protection_revision", "provenance", "provenance_ref", "references", "registered_at_ms", "remaining", "role", "source_path", "tool", "version"], "member", ["references"]);
      if (!nonempty(member.id) || !nonempty(member.owner) || Object.hasOwn(member, "lifecycle_group_id") && member.lifecycle_group_id !== value.id || member.owner !== value.group_scope.owner) throw Error("Unclear foreign member ownership");
      plainPath(member.path);
      if (Object.hasOwn(member, "references")) references(member.references);
      if (member.provenance != null && typeof member.provenance !== "string") throw Error("Unsupported foreign provenance shape");
    }
    const binding = item => {
      if (!catalogSource(item.source) || !hex(item.source_fence)) throw Error("Foreign reservation source namespace or fence unsupported");
      const owner = item.source_owner;
      known(owner, ["schema", "id", "owner", "kind", "version", "generation", "state", "revision", "created_at", "updated_at", "members", "membership_complete", "owned_root", "ownership_scope", "producer", "references", "close_receipt", "release_receipt", "cleanup_recovery", "recover_receipt"], "source owner", ["members", "references", "producer", "close_receipt", "release_receipt", "cleanup_recovery", "recover_receipt"]);
      if (owner.schema !== 1 || owner.id !== value.id || owner.owner !== value.group_scope.owner || !Array.isArray(owner.members) ||
          !nonempty(owner.state) || !Number.isSafeInteger(owner.revision) || owner.revision < 1) throw Error("Foreign reservation source owner mismatch");
      if (owner.generation != null && !nonempty(owner.generation)) throw Error("Unclear foreign generation");
      if (!["run", "work", "version"].includes(owner.kind) || owner.kind !== value.group_scope.kind ||
          owner.version != null && !nonempty(owner.version)) throw Error("Unclear foreign source owner kind/version");
      references(owner.references);
      for (const member of owner.members) {
        known(member, ["path", "role", "generated", "protection_known"], "source owner member");
        plainPath(member.path);
      }
      if (owner.producer != null) known(owner.producer, ["status", "outcome", "exit_code", "reason", "evidence_ref", "evidence_sha256"], "source producer");
      for (const receipt of [owner.close_receipt, owner.release_receipt]) if (receipt != null) known(receipt, ["reason", "evidence_ref", "evidence_sha256", "request_sha256"], "source receipt");
      // Classify existing recovery metadata, never authenticate an external
      // stop claim or grant deletion/release authority from these flags. The
      // complete object stays in the subsequent path and logical-ID walk.
      if (Object.hasOwn(owner, "cleanup_recovery")) {
        const recovery = owner.cleanup_recovery;
        known(recovery, ["schema", "id", "kind", "owner", "version", "generation", "source_revision", "original_state", "original_producer", "original_membership_complete", "members", "evidence_ref", "evidence_sha256", "reason", "producer_stopped_verified", "membership_complete_verified", "verified_at"], "cleanup recovery", ["original_producer", "members"]);
        if (recovery.schema !== 1 || recovery.id !== owner.id || recovery.kind !== owner.kind || recovery.owner !== owner.owner ||
            recovery.version !== (owner.version ?? null) || recovery.generation !== (owner.generation ?? null) ||
            !Number.isSafeInteger(recovery.source_revision) || recovery.source_revision < 1 || recovery.original_state !== owner.state || owner.state !== "pending" ||
            typeof recovery.original_membership_complete !== "boolean" || owner.membership_complete !== true ||
            recovery.producer_stopped_verified !== true || recovery.membership_complete_verified !== true ||
            !nonempty(recovery.reason) || !nonempty(recovery.verified_at) || !Number.isFinite(Date.parse(recovery.verified_at)) ||
            !hex(recovery.evidence_sha256)) throw Error("Unclear foreign cleanup recovery binding");
        plainPath(recovery.evidence_ref);
        same(recovery.original_producer, owner.producer ?? null, "Foreign cleanup original producer binding changed");
        same(recovery.members, owner.members, "Foreign cleanup member binding changed");
        if (owner.producer && (owner.producer.status !== "stopped" || owner.producer.outcome !== "unknown" || owner.producer.exit_code !== null) ||
            owner.members.some(member => member.generated !== true || member.protection_known !== true)) throw Error("Unsupported foreign cleanup recovery shape");
      }
      if (Object.hasOwn(owner, "recover_receipt")) {
        const receipt = owner.recover_receipt;
        known(receipt, ["reason", "evidence_ref", "evidence_sha256", "request_sha256"], "recover receipt");
        if (!nonempty(receipt.reason) || !hex(receipt.evidence_sha256) || !hex(receipt.request_sha256)) throw Error("Unclear foreign recover receipt");
        plainPath(receipt.evidence_ref);
      }
    };
    binding(value);
    const foreign = structuredClone(value);
    // These exact, validated fields name the source catalog namespace. Every
    // source-owner payload, reference and evidence field remains in the walk.
    delete foreign.source; delete foreign.group_scope.membership_source;
    if (value.purpose === "registration") {
      if (!Array.isArray(value.registration_sources) || !value.registration_sources.length) throw Error("Foreign registration source bindings required");
      for (let index = 0; index < value.registration_sources.length; index++) {
        const item = value.registration_sources[index];
        known(item, ["source", "source_fence", "source_owner"], "registration binding", ["source_owner"]);
        if (Object.keys(item).sort().join(",") !== "source,source_fence,source_owner") throw Error("Exact foreign registration binding required");
        binding(item); delete foreign.registration_sources[index].source;
      }
    } else if (Object.hasOwn(value, "registration_sources")) throw Error("Unexpected foreign registration binding");
    if (hasReferencePath(root, foreign, filename => scope.paths.some(target => overlaps(filename, target)))) throw Error("Related foreign reservation path protects metadata custody");
    const associations = new Set([...scope.pendingStems, ...scope.ids.flatMap(id => [id, sha(id), sha(JSON.stringify(id))])]);
    let visited = 0;
    function visit(item, depth = 0) {
      if (++visited > 2000000 || depth > 32) throw Error("Unbounded foreign reservation associations");
      if (typeof item === "string") {
        if (associations.has(item) || associations.has(sha(item)) || associations.has(sha(JSON.stringify(item)))) throw Error("Related foreign reservation logical association protects metadata custody");
      } else if (Array.isArray(item)) for (const child of item) visit(child, depth + 1);
      else if (item && typeof item === "object") for (const child of Object.values(item)) visit(child, depth + 1);
    }
    visit(foreign);
  }
  function validateReservations(root, records, observers = [], scope = null) {
    if (!Array.isArray(records) || !Array.isArray(observers) || observers.some(value => typeof value?.id !== "string" || !value.fence) ||
        new Set(observers.map(value => value.id)).size !== observers.length) throw Error("Exact native reservation observers required");
    if (scope !== null) reservationScope(root, scope);
    const seen = new Set();
    for (const record of records) {
      const fence = record.value, expected = observers.find(value => value.id === fence?.id);
      if (typeof fence?.id !== "string" || !fence.id.trim() || record.name !== sha(JSON.stringify(fence.id)) + ".json" || seen.has(fence.id)) throw Error("Active reservation identity/path mismatch");
      if (expected) same(fence, expected.fence, "Owned reservation fence changed during maintenance custody");
      else {
        if (scope === null) throw Error("Foreign active/suspended native writer or cleanup reservation protects metadata custody");
        foreignReservation(root, fence, scope);
      }
      seen.add(fence.id);
    }
    if (observers.some(value => !seen.has(value.id))) throw Error("Owned reservation disappeared during metadata custody");
  }
  function reservationRecords(root, observers = [], scope = null) {
    const directory = checked(root, path.join(root, "artifacts/maintenance/lifecycles/reservations"));
    if (absent(directory)) {
      if (observers.length) throw Error("Owned reservation directory disappeared");
      if (!absent(directory)) throw Error("Reservation directory appeared during observation");
      return;
    }
    const observe = () => {
      const before = identity(directory, "directory"), names = fs.readdirSync(directory).sort();
      if (names.length > 10000) throw Error("Unbounded reservation directory membership");
      const records = [];
      let rawBytes = 0n;
      for (const name of names) {
        if (!/\.json$/i.test(name)) continue;
        const filename = checked(root, path.join(directory, name)), before = identity(filename, "file");
        const size = BigInt(before.size);
        if (size < 0n || size > 64n * 1024n * 1024n) throw Error("Bounded plain reservation required");
        rawBytes += size;
        if (rawBytes > 64n * 1024n * 1024n) throw Error("Aggregate reservation bytes exceed 64 MiB bound");
        const fd = fs.openSync(filename, "r"), buffer = Buffer.alloc(Number(size) + 1);
        let length = 0;
        try {
          while (length < buffer.length) { const count = fs.readSync(fd, buffer, length, buffer.length - length, null); if (!count) break; length += count; }
        } finally { fs.closeSync(fd); }
        if (length !== Number(size)) throw Error("Reservation size changed during bounded read");
        const bytes = buffer.subarray(0, length);
        same(identity(filename, "file"), before, "Active reservation changed while observing custody");
        records.push({ name, identity: before, sha256: sha(bytes), value: JSON.parse(bytes) });
      }
      same(fs.readdirSync(directory).sort(), names, "Reservation directory membership changed");
      same(identity(directory, "directory"), before, "Reservation directory identity changed");
      return { identity: before, names, records };
    };
    const first = observe();
    validateReservations(root, first.records, observers, scope);
    const second = observe();
    same(second, first, "Reservation identity, bytes, parsed content or membership changed during custody observation");
    validateReservations(root, second.records, observers, scope);
  }
  function quiescent(root, observers = [], scope = null) {
    for (const filename of [path.join(root, "artifacts/maintenance/manifest.pending")]) if (!absent(filename)) throw Error("Pending native state requires existing explicit recovery");
    const catalog = checked(root, path.join(root, "artifacts/maintenance/lifecycles"));
    identity(catalog, "directory");
    if (fs.readdirSync(catalog).some(name => name.endsWith(".pending"))) throw Error("Pending lifecycle publication requires existing explicit recovery");
    reservationRecords(root, observers, scope);
  }
  return { capture, captureEmptyPublications, verify, quiescent, reservationRecords, validateReservations, validateDecisionScope: decisionScope, validateInventoryDecisionScope: inventoryDecisionScope, validateInventoryClaims: claims, validatePublicationAssociations: publicationAssociations, validatePublicationCatalog: publicationCatalog };
};
