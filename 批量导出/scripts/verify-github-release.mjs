import { spawnSync } from "node:child_process";
import path from "node:path";
import { normalizeSemver } from "./release-version.mjs";

function argument(name, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] || "" : "";
  if (required && !value) {
    throw new Error(`Missing argument ${name}`);
  }
  return value;
}

function ghApi(endpoint, extraArgs = []) {
  const result = spawnSync("gh", ["api", endpoint, ...extraArgs], { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`gh api ${endpoint} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function resolveTagSha(repo, tag) {
  let object = JSON.parse(ghApi(`repos/${repo}/git/ref/tags/${tag}`)).object;
  if (object.type === "tag") {
    object = JSON.parse(ghApi(`repos/${repo}/git/tags/${object.sha}`)).object;
  }
  return object.sha;
}

const repo = argument("--repo");
const version = normalizeSemver(argument("--version"));
const tag = `v${version}`;
const expectedSha = argument("--expected-sha");
const expectedDraft = argument("--draft") === "true";
const requireLatest = process.argv.includes("--latest");
const release = JSON.parse(ghApi(`repos/${repo}/releases/tags/${tag}`));

if (release.tag_name !== tag || Boolean(release.draft) !== expectedDraft || release.prerelease) {
  throw new Error("Release tag, draft, or prerelease state is invalid.");
}
if (String(release.target_commitish).toLowerCase() !== expectedSha.toLowerCase()) {
  throw new Error(`Release target mismatch: expected ${expectedSha}, got ${release.target_commitish}`);
}

const stems = [`DV-EXPORT-${tag}-windows-installer`, `DV-EXPORT-${tag}-setup`];
const expectedNames = stems.flatMap((stem) => [stem.endsWith("setup") ? `${stem}.exe` : `${stem}.zip`, `${stem}.sha256.txt`]);
const assets = Array.isArray(release.assets) ? release.assets : [];
if (assets.length !== expectedNames.length) {
  throw new Error(`Expected exactly ${expectedNames.length} assets, got ${assets.length}.`);
}

for (const expectedName of expectedNames) {
  const matches = assets.filter((asset) => asset.name === expectedName);
  if (matches.length !== 1 || matches[0].state !== "uploaded" || Number(matches[0].size) <= 0) {
    throw new Error(`Release asset is missing, duplicated, empty, or not uploaded: ${expectedName}`);
  }
}

for (const stem of stems) {
  const packageName = stem.endsWith("setup") ? `${stem}.exe` : `${stem}.zip`;
  const hashName = `${stem}.sha256.txt`;
  const packageAsset = assets.find((asset) => asset.name === packageName);
  const hashAsset = assets.find((asset) => asset.name === hashName);
  const hashText = ghApi(`repos/${repo}/releases/assets/${hashAsset.id}`, ["--header", "Accept: application/octet-stream"]).trim();
  const match = /^([A-Fa-f0-9]{64})\s+\*?(.+)$/.exec(hashText);
  if (!match || match[2].trim() !== packageName) {
    throw new Error(`Remote hash file is invalid: ${hashName}`);
  }
  const digest = String(packageAsset.digest || "");
  if (digest && digest.toLowerCase() !== `sha256:${match[1].toLowerCase()}`) {
    throw new Error(`GitHub digest does not match ${hashName}`);
  }
}

if (!expectedDraft) {
  const tagSha = resolveTagSha(repo, tag);
  if (tagSha.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(`Tag ${tag} points to ${tagSha}, expected ${expectedSha}`);
  }
}

if (requireLatest) {
  const latest = JSON.parse(ghApi(`repos/${repo}/releases/latest`));
  if (latest.id !== release.id || latest.tag_name !== tag || latest.draft || latest.prerelease) {
    throw new Error("Published release is not the repository Latest Release.");
  }
}

console.log(
  JSON.stringify(
    {
      tag,
      releaseId: release.id,
      draft: release.draft,
      prerelease: release.prerelease,
      target: release.target_commitish,
      assets: expectedNames,
      latest: requireLatest,
      url: release.html_url
    },
    null,
    2
  )
);
