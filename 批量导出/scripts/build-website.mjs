import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
const demoOutput = path.join(projectRoot, "build", "demo");
const websiteOutput = path.join(projectRoot, "build", "website");
const bundledDemoOutput = path.join(websiteOutput, "demo");
const websiteDownloadsOutput = path.join(websiteOutput, "downloads");

function runVite(args, label) {
  const result = spawnSync(process.execPath, [viteBin, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label}失败，退出码：${result.status ?? "unknown"}`);
  }
}

async function assertFile(filePath, label) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`${label}不存在或为空：${filePath}`);
  }
}

async function buildWebsite() {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const version = String(packageJson.version || "").trim();
  if (!version) {
    throw new Error("package.json 缺少有效版本号。");
  }
  const installerFileName = `DV-EXPORT-v${version}-setup.exe`;
  const checksumFileName = `DV-EXPORT-v${version}-setup.sha256.txt`;
  const installerSource = path.join(projectRoot, "dist", "installer", installerFileName);
  const checksumSource = path.join(projectRoot, "dist", "installer", checksumFileName);
  try {
    await Promise.all([assertFile(installerSource, "当前版本安装包"), assertFile(checksumSource, "安装包校验文件")]);
  } catch {
    throw new Error(`缺少 v${version} 安装包，请先执行 npm run build:installer。`);
  }

  runVite(["build", "--mode", "demo", "--outDir", "build/demo"], "Web Demo 构建");
  runVite(["build", "--config", "website/vite.config.ts"], "官网构建");

  await rm(bundledDemoOutput, { recursive: true, force: true });
  await mkdir(websiteOutput, { recursive: true });
  await cp(demoOutput, bundledDemoOutput, { recursive: true });
  await mkdir(websiteDownloadsOutput, { recursive: true });
  await Promise.all([
    cp(installerSource, path.join(websiteDownloadsOutput, installerFileName)),
    cp(checksumSource, path.join(websiteDownloadsOutput, checksumFileName))
  ]);

  await Promise.all([
    assertFile(path.join(websiteOutput, "index.html"), "官网首页"),
    assertFile(path.join(websiteOutput, "sponsors.html"), "公开赞助榜"),
    assertFile(path.join(websiteOutput, "sponsors-admin.html"), "赞助管理页"),
    assertFile(path.join(websiteOutput, "og.png"), "社交分享图"),
    assertFile(path.join(websiteOutput, "support", "wechat-support.jpg"), "微信赞赏码"),
    assertFile(path.join(websiteOutput, "support", "alipay-support.jpg"), "支付宝赞赏码"),
    assertFile(path.join(bundledDemoOutput, "index.html"), "Web Demo 首页"),
    assertFile(path.join(websiteDownloadsOutput, installerFileName), "官网下载文件"),
    assertFile(path.join(websiteDownloadsOutput, checksumFileName), "官网下载校验文件")
  ]);

  console.log(`官网静态产物已生成：${websiteOutput}`);
}

buildWebsite().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
