import type { UpdateBridge } from "../types/update";
import { createDemoUpdateBridge } from "../demo/demoUpdateBridge";

let demoUpdateBridge: UpdateBridge | null = null;

export function getUpdateBridge(): UpdateBridge | null {
  if (window.updateBridge) {
    return window.updateBridge;
  }

  if (import.meta.env.MODE === "demo" && new URLSearchParams(window.location.search).get("updatePreview") === "1") {
    demoUpdateBridge ??= createDemoUpdateBridge();
    return demoUpdateBridge;
  }

  return null;
}
