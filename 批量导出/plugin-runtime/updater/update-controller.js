"use strict";

const fs = require("fs");
const path = require("path");
const config = require("./update-config");
const { compareVersions, normalizeUpdateSettings } = require("./update-core");
const { checkLatestRelease, downloadCandidate } = require("./update-service");
const { createUpdatePaths, readState, updateState } = require("./update-settings");
const { launchUpdaterProcess, verifyPendingFile } = require("./updater-process");

class UpdateController {
  constructor(options) {
    this.app = options.app;
    this.publish = options.publish || (() => {});
    this.activeCheck = null;
    this.state = {
      currentVersion: config.currentVersion,
      status: "idle",
      message: "尚未检查更新。",
      progress: 0,
      pending: null,
      isDeferred: false
    };
  }

  setPublisher(publish) {
    this.publish = publish || (() => {});
  }

  emit(patch) {
    this.state = { ...this.state, ...patch };
    this.publish(this.getState());
    return this.getState();
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getSettings() {
    return readState().settings;
  }

  saveSettings(settings) {
    const normalized = normalizeUpdateSettings(settings);
    updateState((state) => ({ ...state, settings: normalized }));
    return normalized;
  }

  async reconcilePending() {
    const stored = readState();
    if (!stored.pending) {
      return null;
    }

    if (compareVersions(stored.pending.version, config.currentVersion) <= 0) {
      try {
        fs.rmSync(stored.pending.archivePath, { force: true });
      } catch {
        // A completed update must not fail startup because old cache cleanup failed.
      }
      updateState((state) => ({ ...state, pending: null, deferredVersion: "" }));
      return null;
    }

    try {
      const pending = await verifyPendingFile(stored.pending);
      this.emit({
        status: "ready",
        message: `新版本 ${pending.version} 已下载完成。`,
        progress: 1,
        availableVersion: pending.version,
        releaseUrl: pending.releaseUrl || "",
        releaseNotes: pending.releaseNotes || "",
        pending,
        isDeferred: false
      });
      return pending;
    } catch (error) {
      updateState((state) => ({
        ...state,
        pending: null,
        deferredVersion: "",
        lastResult: {
          success: false,
          message: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString()
        }
      }));
      this.emit({
        status: "error",
        message: error instanceof Error ? error.message : "待安装更新校验失败。",
        progress: 0,
        pending: null,
        isDeferred: false
      });
      return null;
    }
  }

  async handleDeferredStartup() {
    const pending = await this.reconcilePending();
    const stored = readState();
    if (!pending || stored.deferredVersion !== pending.version) {
      return false;
    }

    updateState((state) => ({ ...state, deferredVersion: "" }));
    await launchUpdaterProcess(pending);
    return true;
  }

  consumeLatestSessionResult() {
    const paths = createUpdatePaths();
    if (!fs.existsSync(paths.sessions)) {
      return null;
    }

    const results = [];
    for (const entry of fs.readdirSync(paths.sessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sessionRoot = path.join(paths.sessions, entry.name);
      const resultPath = path.join(sessionRoot, "result.json");
      if (!fs.existsSync(resultPath)) {
        continue;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(resultPath, "utf-8").replace(/^\uFEFF/, ""));
        results.push({ parsed, sessionRoot, modifiedAt: fs.statSync(resultPath).mtimeMs });
      } catch {
        // Preserve malformed session data for diagnostics instead of treating it as success.
      }
    }

    if (results.length === 0) {
      return null;
    }

    results.sort((left, right) => right.modifiedAt - left.modifiedAt);
    const latest = results[0].parsed;
    for (const result of results) {
      const resolvedSessions = path.resolve(paths.sessions);
      const resolvedSession = path.resolve(result.sessionRoot);
      if (resolvedSession.startsWith(`${resolvedSessions}${path.sep}`)) {
        try {
          fs.rmSync(resolvedSession, { recursive: true, force: true });
        } catch {
          // The updater may still be releasing its script handle while the new process starts.
        }
      }
    }
    updateState((state) => ({ ...state, lastResult: latest }));
    return latest;
  }

  async initialize() {
    const sessionResult = this.consumeLatestSessionResult();
    const pending = await this.reconcilePending();
    if (pending) {
      if (sessionResult && sessionResult.success === false) {
        return this.emit({
          status: "ready",
          message: `上次更新失败：${sessionResult.message}。更新包仍可重试。`,
          pending,
          isDeferred: false
        });
      }
      return this.getState();
    }

    const stored = readState();
    if (sessionResult && sessionResult.success === true) {
      return this.emit({
        status: "upToDate",
        message: `已成功更新到 ${config.currentVersion}。`,
        progress: 1,
        pending: null,
        isDeferred: false
      });
    }
    if (stored.lastResult && stored.lastResult.success === false) {
      return this.emit({
        status: "error",
        message: `上次更新失败：${stored.lastResult.message}`,
        progress: 0
      });
    }

    return this.getState();
  }

  async checkForUpdates(options = {}) {
    if (this.activeCheck) {
      return this.activeCheck;
    }

    const settings = this.getSettings();
    if (options.manual && settings.updatePolicy === "disabled") {
      throw new Error("更新策略为“禁止更新”，无法手动检查。");
    }

    this.activeCheck = this.runCheck(settings).finally(() => {
      this.activeCheck = null;
    });
    return this.activeCheck;
  }

  async runCheck(settings) {
    try {
      this.emit({ status: "checking", message: "正在检查 GitHub 最新版本...", progress: 0 });
      const { candidate, route } = await checkLatestRelease(settings);
      if (!candidate) {
        return this.emit({
          status: "upToDate",
          message: `当前已是最新版本（${route}）。`,
          progress: 1,
          availableVersion: undefined,
          pending: null,
          isDeferred: false
        });
      }

      this.emit({
        status: "downloading",
        message: `发现新版本 ${candidate.version}，正在下载...`,
        progress: 0,
        availableVersion: candidate.version,
        releaseUrl: candidate.releaseUrl,
        releaseNotes: candidate.notes,
        isDeferred: false
      });
      const paths = createUpdatePaths();
      const download = await downloadCandidate(candidate, settings, paths, (progress) => {
        this.emit({
          status: "downloading",
          message: `正在下载新版本 ${candidate.version}（${Math.round(progress * 100)}%）...`,
          progress
        });
      });
      const pending = {
        version: candidate.version,
        assetName: candidate.archive.name,
        archivePath: download.archivePath,
        size: candidate.archive.size,
        sha256: download.expectedSha256,
        downloadedAt: new Date().toISOString(),
        releaseUrl: candidate.releaseUrl,
        releaseNotes: candidate.notes
      };
      updateState((state) => ({ ...state, pending, deferredVersion: "", lastResult: null }));
      return this.emit({
        status: "ready",
        message: download.reused
          ? `已验证缓存中的新版本 ${candidate.version}。`
          : `新版本 ${candidate.version} 已下载并通过 SHA-256 校验。`,
        progress: 1,
        pending,
        isDeferred: false
      });
    } catch (error) {
      return this.emit({
        status: "error",
        message: error instanceof Error ? error.message : "检查更新失败。",
        progress: 0
      });
    }
  }

  async startAutomaticCheck() {
    if (this.getSettings().updatePolicy !== "automatic" || this.state.status === "ready") {
      return this.getState();
    }
    return this.checkForUpdates({ manual: false });
  }

  async deferUpdate() {
    const pending = await this.reconcilePending();
    if (!pending) {
      throw new Error("没有可延期安装的更新。 ");
    }
    updateState((state) => ({ ...state, deferredVersion: pending.version }));
    return this.emit({
      status: "ready",
      message: `已安排在下次启动时安装 ${pending.version}。`,
      isDeferred: true
    });
  }

  async installUpdateNow() {
    const pending = await this.reconcilePending();
    if (!pending) {
      throw new Error("没有可立即安装的更新。");
    }
    updateState((state) => ({ ...state, deferredVersion: "" }));
    await launchUpdaterProcess(pending);
    this.emit({
      status: "installing",
      message: `正在退出并安装 ${pending.version}...`,
      progress: 1,
      isDeferred: false
    });
    setTimeout(() => this.app.quit(), 750);
    return { launched: true };
  }
}

module.exports = UpdateController;
