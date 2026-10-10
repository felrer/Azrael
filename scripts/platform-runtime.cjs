"use strict";

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const policy = require("./azrael-platforms.json");

function resolvePlatform(platform = process.platform, arch = process.arch) {
  const entry = policy.platforms.find(item => item.os === platform && item.arch === arch);
  if (!entry) throw new Error(`Unsupported Azrael platform: ${platform}/${arch}.`);
  return Object.freeze({ ...entry });
}

// Legacy absolute Windows manifests remain valid on Windows only. Explicit
// platform identities are required for new Unix runtimes before launching code.
function validateRuntimePlatform(identity, environment = {}) {
  const platform = environment.platform ?? process.platform;
  const arch = environment.arch ?? process.arch;
  const expected = resolvePlatform(platform, arch);
  if (platform === "linux" && process.platform === "linux" &&
      !process.report?.getReport().header.glibcVersionRuntime) {
    throw new Error("Azrael Linux runtime requires GNU/glibc; musl is unsupported.");
  }
  if (identity === undefined) {
    if (platform !== "win32") throw new Error("Azrael runtime has no platform identity. Prepare a matching runtime.");
    return expected;
  }
  if (!identity || typeof identity !== "object" || Array.isArray(identity) ||
      identity.os !== expected.os || identity.arch !== expected.arch ||
      identity.target !== expected.target ||
      (expected.libc && identity.libc !== expected.libc)) {
    throw new Error("Azrael runtime platform does not match this host.");
  }
  return expected;
}

function platformIdentity(descriptor = resolvePlatform()) {
  return { os: descriptor.os, arch: descriptor.arch, target: descriptor.target,
    ...(descriptor.libc ? { libc: descriptor.libc } : {}) };
}

function executableName(name, descriptor = resolvePlatform()) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    throw new Error("Invalid Azrael executable name.");
  }
  return name + descriptor.executableSuffix;
}

function engineBinaryNames(descriptor = resolvePlatform()) {
  return ["codex", "azrael-bridge", "codex-code-mode-host"].map(name => executableName(name, descriptor));
}

function canonicalPath(value, platform = process.platform) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const resolved = paths.resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function requireExecutable(file, platform = process.platform) {
  if (!fs.statSync(file).isFile()) throw new Error("Azrael executable is not a file.");
  if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
  return file;
}

function defaultReleasesRoot(environment = process.env, platform = process.platform, home = os.homedir()) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (environment.AZRAEL_RELEASES_ROOT) {
    if (!paths.isAbsolute(environment.AZRAEL_RELEASES_ROOT)) throw new Error("AZRAEL_RELEASES_ROOT must be absolute.");
    return environment.AZRAEL_RELEASES_ROOT;
  }
  if (platform === "win32") {
    if (!environment.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required for Windows installation.");
    return paths.join(environment.LOCALAPPDATA, "azrael-ex", "releases");
  }
  if (platform === "darwin") return paths.join(home, "Library", "Application Support", "Azrael", "releases");
  if (platform === "linux") {
    const data = environment.XDG_DATA_HOME || paths.join(home, ".local", "share");
    if (!paths.isAbsolute(data)) throw new Error("XDG_DATA_HOME must be absolute.");
    return paths.join(data, "azrael-ex", "releases");
  }
  throw new Error(`Unsupported Azrael platform: ${platform}.`);
}

module.exports = { policy, resolvePlatform, validateRuntimePlatform, platformIdentity,
  executableName, engineBinaryNames, canonicalPath, requireExecutable, defaultReleasesRoot };
