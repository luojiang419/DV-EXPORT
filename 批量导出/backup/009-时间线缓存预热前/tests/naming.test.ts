import { describe, expect, it } from "vitest";
import { formatNamingTemplate, sanitizeWindowsFileName } from "../src/core/naming";

describe("naming", () => {
  it("sanitizes invalid windows characters", () => {
    expect(sanitizeWindowsFileName('A:B*C?"<>|')).toBe("A_B_C_____");
  });

  it("renders supported tokens", () => {
    expect(
      formatNamingTemplate("{project}_{timeline}_{date}_{time}_{index}", {
        project: "Demo",
        timeline: "Cut01",
        index: 3,
        now: new Date("2026-06-01T10:20:30")
      })
    ).toBe("Demo_Cut01_20260601_102030_03");
  });
});
