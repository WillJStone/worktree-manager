import { describe, expect, test } from "bun:test";
import { getAgentLaunchArgs } from "../src/launch";

describe("getAgentLaunchArgs", () => {
  test("returns no extra flags without yolo", () => {
    expect(getAgentLaunchArgs("codex")).toEqual([]);
    expect(getAgentLaunchArgs("claude")).toEqual([]);
    expect(getAgentLaunchArgs("pi")).toEqual([]);
  });

  test("adds Codex full-auto when yolo is enabled", () => {
    expect(getAgentLaunchArgs("codex", { yolo: true })).toEqual(["--full-auto"]);
  });

  test("adds Claude skip-permissions when yolo is enabled", () => {
    expect(getAgentLaunchArgs("claude", { yolo: true })).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  test("leaves Pi unchanged when yolo is enabled", () => {
    expect(getAgentLaunchArgs("pi", { yolo: true })).toEqual([]);
  });
});
