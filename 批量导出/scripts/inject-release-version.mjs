import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSemver } from "./release-version.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionIndex = process.argv.indexOf("--version");
const version = normalizeSemver(versionIndex >= 0 ? process.argv[versionIndex + 1] : "");

function updateJson(relativePath, transform) {
  const filePath = path.join(projectRoot, relativePath);
  const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
  transform(parsed);
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
}

updateJson("package.json", (packageJson) => {
  packageJson.version = version;
});
updateJson("package-lock.json", (packageLock) => {
  packageLock.version = version;
  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = version;
  }
});

console.log(`Injected DV-EXPORT version ${version}`);
