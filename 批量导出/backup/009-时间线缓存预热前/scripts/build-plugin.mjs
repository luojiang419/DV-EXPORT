import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const buildRoot = path.join(projectRoot, "build");
const webBuildRoot = path.join(buildRoot, "web");
const pluginRuntimeRoot = path.join(projectRoot, "plugin-runtime");
const distRoot = path.join(projectRoot, "dist");
const sourcePackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
const pluginFolderName = "com.dvexport.batch-export";
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function nextVersion(baseVersion) {
  const normalized = baseVersion.startsWith("v") ? baseVersion.slice(1) : baseVersion;
  const [major, minor, patch] = normalized.split(".").map((item) => Number(item || "0"));
  let candidate = `${major}.${minor}.${patch}`;
  const existing = new Set(
    existsSync(distRoot)
      ? readdirSync(distRoot, { withFileTypes: true })
          .filter((item) => item.isDirectory() && item.name.startsWith("v"))
          .map((item) => item.name.slice(1))
      : []
  );

  let currentPatch = patch;
  while (existing.has(candidate)) {
    currentPatch += 1;
    candidate = `${major}.${minor}.${currentPatch}`;
  }

  return candidate;
}

function copyWorkflowIntegrationNode(targetDir) {
  const candidates = [
    process.env.RESOLVE_WORKFLOW_NODE_PATH,
    "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Workflow Integrations\\Examples\\SamplePlugin\\WorkflowIntegration.node",
    "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins\\SamplePlugin\\WorkflowIntegration.node",
    "/mnt/c/ProgramData/Blackmagic Design/DaVinci Resolve/Support/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node",
    "/mnt/c/ProgramData/Blackmagic Design/DaVinci Resolve/Support/Workflow Integration Plugins/SamplePlugin/WorkflowIntegration.node"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      cpSync(candidate, path.join(targetDir, "WorkflowIntegration.node"));
      return true;
    }
  }

  writeFileSync(
    path.join(targetDir, "MISSING_WORKFLOWINTEGRATION_NODE.txt"),
    [
      "未找到 WorkflowIntegration.node。",
      "请从 DaVinci Resolve Studio 安装目录中的 Developer/Workflow Integrations/Examples/SamplePlugin 拷贝该文件到当前插件根目录。"
    ].join("\n"),
    "utf-8"
  );
  return false;
}

run(process.execPath, ["./node_modules/vite/bin/vite.js", "build"]);

const version = nextVersion(sourcePackage.version);
const versionDir = path.join(distRoot, `v${version}`);
const pluginDir = path.join(versionDir, pluginFolderName);

rmSync(versionDir, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });

cpSync(pluginRuntimeRoot, pluginDir, { recursive: true });
cpSync(webBuildRoot, pluginDir, { recursive: true });

const pluginPackage = {
  name: "DaVinci Resolve Batch Export",
  version,
  description: "Resolve batch export workflow integration plugin",
  main: "main.js"
};
writeFileSync(path.join(pluginDir, "package.json"), `${JSON.stringify(pluginPackage, null, 2)}\n`, "utf-8");

const manifestPath = path.join(pluginDir, "manifest.xml");
const manifest = readFileSync(manifestPath, "utf-8").replaceAll("__PLUGIN_VERSION__", version);
writeFileSync(manifestPath, manifest, "utf-8");

copyWorkflowIntegrationNode(pluginDir);

mkdirSync(path.join(distRoot), { recursive: true });
writeFileSync(path.join(distRoot, ".gitkeep"), "", "utf-8");
