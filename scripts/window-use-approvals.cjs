"use strict";
const path = require("node:path");
const shared = require("./computer-use-approvals.cjs");
function createOwner(home) { return shared.createOwner(home, { mode: "window" }); }
const registry = globalThis[Symbol.for("azrael.window-use.approval-owners.v1")] ??= new Map();
function owner() { const home = require("./azrael-runtime.cjs").runtime.codexHome, key = path.resolve(home).toLowerCase(); if (!registry.has(key)) registry.set(key, createOwner(home)); return registry.get(key); }
module.exports = { createOwner };
for (const method of ["receive", "response", "stop", "reset", "outgoing", "notification", "getAppApprovals", "hasAppApproval", "removeAppApproval", "getPersistentAppApprovals", "addAppApproval"]) module.exports[method] = (...args) => owner()[method](...args);
