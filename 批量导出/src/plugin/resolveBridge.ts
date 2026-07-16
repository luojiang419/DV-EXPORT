import type { ResolveBridge } from "../types/resolve";
import { createDemoResolveBridge } from "../demo/demoBridge";

let demoBridge: ResolveBridge | null = null;

export function getResolveBridge(): ResolveBridge {
  if (window.resolveBridge) {
    return window.resolveBridge;
  }

  if (import.meta.env.MODE === "demo") {
    demoBridge ??= createDemoResolveBridge();
    return demoBridge;
  }

  throw new Error("插件 bridge 未注入，当前页面可能未在 DaVinci Resolve Workflow Integration 环境中运行。");
}
