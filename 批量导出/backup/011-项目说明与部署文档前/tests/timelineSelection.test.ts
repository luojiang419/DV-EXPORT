import { describe, expect, it } from "vitest";
import { computeNextSelection } from "../src/core/timelineSelection";

describe("timeline selection", () => {
  it("supports shift range selection", () => {
    const result = computeNextSelection(
      ["a", "b", "c", "d"],
      ["b"],
      "d",
      "b",
      { ctrlKey: false, shiftKey: true }
    );

    expect(result.selection).toEqual(["b", "c", "d"]);
  });

  it("supports ctrl toggle selection", () => {
    const result = computeNextSelection(
      ["a", "b", "c"],
      ["a"],
      "c",
      "a",
      { ctrlKey: true, shiftKey: false }
    );

    expect(result.selection).toEqual(["a", "c"]);
  });
});
