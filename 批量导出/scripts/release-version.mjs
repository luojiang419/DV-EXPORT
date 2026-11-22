import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeSemver(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`版本号必须是稳定三段 SemVer，当前值：${value || "空"}`);
  }
  return normalized;
}

export function compareSemver(left, right) {
  const leftParts = normalizeSemver(left).split(".").map(Number);
  const rightParts = normalizeSemver(right).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  return 0;
}

export function resolveNextVersion(sourceVersion, latestTag = "") {
  const source = normalizeSemver(sourceVersion);
  const latest = latestTag ? normalizeSemver(latestTag) : "";
  const base = latest && compareSemver(latest, source) > 0 ? latest : source;
  const parts = base.split(".").map(Number);
  parts[2] += 1;
  return parts.join(".");
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
}

function runSelfTest() {
  assert.equal(resolveNextVersion("0.1.26", "v0.1.10"), "0.1.27");
  assert.equal(resolveNextVersion("0.1.26", "v0.1.27"), "0.1.28");
  assert.equal(resolveNextVersion("1.0.0", ""), "1.0.1");
  assert.equal(resolveNextVersion("1.0.0", "v2.3.4"), "2.3.5");
  assert.throws(() => resolveNextVersion("1.0", ""), /SemVer/);
  assert.throws(() => resolveNextVersion("1.0.0", "v1.1.0-beta.1"), /SemVer/);
  console.log("release-version self-test passed");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
  } else {
    const sourcePackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
    const source = readArgument("--source") || sourcePackage.version;
    const latest = readArgument("--latest");
    console.log(resolveNextVersion(source, latest));
  }
}
