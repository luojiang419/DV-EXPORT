import { beforeEach, describe, expect, it } from "vitest";
import {
  exportSettingsStorageKey,
  loadPersistedExportSettings,
  savePersistedExportSettings
} from "../src/core/exportSettingsStorage";
import type { RenderProfile } from "../src/types/models";

const fallbackProfile: RenderProfile = {
  presetName: "",
  format: "mp4",
  codec: "h264",
  resolution: {
    width: 1920,
    height: 1080
  },
  frameRate: 25,
  exportVideo: true,
  exportAudio: true
};

describe("export settings storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads persisted settings when storage is valid", () => {
    window.localStorage.setItem(
      exportSettingsStorageKey,
      JSON.stringify({
        hasManualPresetSelection: true,
        renderProfile: {
          ...fallbackProfile,
          frameRate: 50,
          resolution: { width: 3840, height: 2160 }
        },
        showAllTimelines: true,
        outputDirectory: "D:/Exports",
        namingTemplate: "{project}_{timeline}"
      })
    );

    const result = loadPersistedExportSettings(fallbackProfile, "{timeline}_{date}_{index}");

    expect(result.hasManualPresetSelection).toBe(true);
    expect(result.showAllTimelines).toBe(true);
    expect(result.renderProfile.frameRate).toBe(50);
    expect(result.renderProfile.resolution).toEqual({ width: 3840, height: 2160 });
    expect(result.outputDirectory).toBe("D:/Exports");
    expect(result.namingTemplate).toBe("{project}_{timeline}");
  });

  it("falls back to defaults when storage is malformed", () => {
    window.localStorage.setItem(exportSettingsStorageKey, "{broken json");

    const result = loadPersistedExportSettings(fallbackProfile, "{timeline}_{date}_{index}");

    expect(result).toEqual({
      hasManualPresetSelection: false,
      showAllTimelines: false,
      renderProfile: fallbackProfile,
      outputDirectory: "",
      namingTemplate: "{timeline}_{date}_{index}"
    });
  });

  it("persists settings into local storage", () => {
    savePersistedExportSettings({
      hasManualPresetSelection: true,
      showAllTimelines: true,
      renderProfile: fallbackProfile,
      outputDirectory: "E:/Queue",
      namingTemplate: "{timeline}_{index}"
    });

    expect(JSON.parse(window.localStorage.getItem(exportSettingsStorageKey) || "{}")).toEqual({
      hasManualPresetSelection: true,
      showAllTimelines: true,
      renderProfile: fallbackProfile,
      outputDirectory: "E:/Queue",
      namingTemplate: "{timeline}_{index}"
    });
  });

  it("defaults legacy storage without preset metadata to automatic-off mode", () => {
    window.localStorage.setItem(
      exportSettingsStorageKey,
      JSON.stringify({
        renderProfile: {
          ...fallbackProfile,
          presetName: "H.264 Master"
        },
        outputDirectory: "D:/Exports",
        namingTemplate: "{timeline}"
      })
    );

    const result = loadPersistedExportSettings(fallbackProfile, "{timeline}_{date}_{index}");

    expect(result.hasManualPresetSelection).toBe(false);
    expect(result.showAllTimelines).toBe(false);
    expect(result.renderProfile.presetName).toBe("H.264 Master");
  });
});
