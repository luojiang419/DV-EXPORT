import type { ResolveBridge } from "../types/resolve";

declare global {
  interface Window {
    resolveBridge: ResolveBridge;
  }
}

export {};
