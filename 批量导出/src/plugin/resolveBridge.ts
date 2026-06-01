import type { ResolveBridge } from "../types/resolve";

export function getResolveBridge(): ResolveBridge {
  if (!window.resolveBridge) {
    throw new Error("插件 bridge 未注入，当前页面可能未在 DaVinci Resolve Workflow Integration 环境中运行。");
  }

  return window.resolveBridge;
}
