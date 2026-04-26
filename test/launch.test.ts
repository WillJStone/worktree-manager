import { describe, expect, test } from "bun:test";
import { BUILTIN_AGENTS, getAgentByName, getAgentLaunchArgs } from "../src/agents";

describe("getAgentLaunchArgs", () => {
  test("returns no extra flags without yolo", () => {
    expect(getAgentLaunchArgs(getAgentByName(BUILTIN_AGENTS, "codex")!)).toEqual([]);
    expect(getAgentLaunchArgs(getAgentByName(BUILTIN_AGENTS, "claude")!)).toEqual([]);
  });

  test("adds Codex full-auto when yolo is enabled", () => {
    expect(getAgentLaunchArgs(getAgentByName(BUILTIN_AGENTS, "codex")!, { yolo: true })).toEqual(["--full-auto"]);
  });

  test("adds Claude skip-permissions when yolo is enabled", () => {
    expect(getAgentLaunchArgs(getAgentByName(BUILTIN_AGENTS, "claude")!, { yolo: true })).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

});
