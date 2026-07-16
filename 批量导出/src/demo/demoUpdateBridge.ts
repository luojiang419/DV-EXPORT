import type { UpdateBridge, UpdateSettings, UpdateState } from "../types/update";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createDemoUpdateBridge(): UpdateBridge {
  let settings: UpdateSettings = {
    updatePolicy: "automatic",
    updateNetworkMode: "automaticProxy",
    manualProxyUrl: "http://127.0.0.1:7890"
  };
  let state: UpdateState = {
    currentVersion: "0.1.27",
    status: "idle",
    message: "更新界面模拟预览，不会访问网络或安装软件。",
    progress: 0,
    pending: null,
    isDeferred: false
  };
  const listeners = new Set<(state: UpdateState) => void>();

  function commit(nextState: UpdateState) {
    state = nextState;
    for (const listener of listeners) {
      listener(clone(state));
    }
    return clone(state);
  }

  return {
    async getSettings() {
      return clone(settings);
    },
    async saveSettings(nextSettings) {
      settings = clone(nextSettings);
      return clone(settings);
    },
    async getState() {
      return clone(state);
    },
    async checkForUpdates() {
      return commit({
        currentVersion: "0.1.27",
        status: "ready",
        message: "模拟版本 0.1.28 已下载并通过 SHA-256 校验。",
        progress: 1,
        availableVersion: "0.1.28",
        releaseUrl: "https://github.com/luojiang419/DV-EXPORT/releases/tag/v0.1.28",
        releaseNotes: "自动更新端到端测试版本。\n此页面只预览界面，不会修改本机安装。",
        pending: {
          version: "0.1.28",
          assetName: "DV-EXPORT-v0.1.28-windows-installer.zip",
          archivePath: "C:\\Users\\Demo\\DV-EXPORT\\updates\\v0.1.28.zip",
          size: 1024,
          sha256: "A".repeat(64),
          downloadedAt: "2026-07-16T00:00:00Z"
        },
        isDeferred: false
      });
    },
    async deferUpdate() {
      return commit({ ...state, message: "已模拟安排下次启动更新。", isDeferred: true });
    },
    async installUpdateNow() {
      commit({ ...state, status: "installing", message: "正在模拟启动更新器..." });
      return { launched: true };
    },
    onStateChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
