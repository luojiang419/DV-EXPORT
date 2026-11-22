"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeVersion } = require("./update-core");

const pluginRoot = path.resolve(__dirname, "..");
const packageCandidates = [
  path.join(pluginRoot, "package.json"),
  path.join(pluginRoot, "..", "package.json")
];
const packagePath = packageCandidates.find((candidate) => fs.existsSync(candidate));
if (!packagePath) {
  throw new Error("无法读取 DV-EXPORT package.json 版本来源。");
}
const pluginPackage = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

module.exports = Object.freeze({
  productName: "DV-EXPORT",
  pluginId: "com.dvexport.batch-export",
  currentVersion: normalizeVersion(pluginPackage.version),
  repositoryOwner: "luojiang419",
  repositoryName: "DV-EXPORT",
  latestReleaseApi: "https://api.github.com/repos/luojiang419/DV-EXPORT/releases/latest",
  installRoot:
    process.env.DVEXPORT_INSTALL_ROOT ||
    path.join(
      process.env.ProgramData || "C:\\ProgramData",
      "Blackmagic Design",
      "DaVinci Resolve",
      "Support",
      "Workflow Integration Plugins"
    )
});
