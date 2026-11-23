import { describe, expect, it } from "vitest";
import { createDemoUpdateBridge } from "../src/demo/demoUpdateBridge";

describe("createDemoUpdateBridge", () => {
  it("只模拟设置、检查与延期状态，不执行外部更新", async () => {
    const bridge = createDemoUpdateBridge();
    const initial = await bridge.getState();
    expect(initial.status).toBe("idle");

    const ready = await bridge.checkForUpdates();
    expect(ready.status).toBe("ready");
    expect(ready.availableVersion).toBe("0.1.28");
    expect(ready.pending?.assetName).toBe("DV-EXPORT-v0.1.28-windows-installer.zip");

    const deferred = await bridge.deferUpdate();
    expect(deferred.isDeferred).toBe(true);
  });
});
