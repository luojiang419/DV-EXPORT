import type { ResolveBridge } from "../types/resolve";
import type { UpdateBridge } from "../types/update";

declare global {
  interface Window {
    resolveBridge: ResolveBridge;
    updateBridge?: UpdateBridge;
  }
}

export {};
