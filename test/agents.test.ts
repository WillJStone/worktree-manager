import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  BUILTIN_AGENTS,
  getAgentByName,
  getAgentLaunchArgs,
  getAgentNames,
  loadAgents,
} from "../src/agents";

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "wtm-agents-"));
  mkdirSync(join(home, ".config", "wtm"), { recursive: true });
  return home;
}

describe("agent registry", () => {
  test("includes the built-in launchers by default", () => {
    expect(getAgentNames(BUILTIN_AGENTS)).toEqual(["codex", "claude"]);
  });

  test("loads custom agents from ~/.config/wtm/config.json", () => {
    const home = tempHome();
    writeFileSync(
      join(home, ".config/wtm/config.json"),
      JSON.stringify({
        agents: [
          {
            name: "hermes-coder",
            label: "Hermes Coder",
            command: "hermes",
            args: ["--profile", "coder"],
            yoloArgs: ["--yes"],
          },
        ],
      }),
    );

    const agents = loadAgents({ home });
    expect(getAgentNames(agents)).toEqual(["codex", "claude", "hermes-coder"]);
    expect(getAgentByName(agents, "hermes-coder")).toEqual({
      name: "hermes-coder",
      label: "Hermes Coder",
      command: "hermes",
      args: ["--profile", "coder"],
      yoloArgs: ["--yes"],
      source: "user",
    });
  });

  test("loads custom agents from WTM_CONFIG", () => {
    const home = tempHome();
    const configPath = join(home, "custom-wtm.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: [{ name: "aider", command: "aider" }],
      }),
    );

    const agents = loadAgents({ home, configPath });
    expect(getAgentByName(agents, "aider")?.command).toBe("aider");
  });

  test("rejects malformed custom agent names", () => {
    const home = tempHome();
    writeFileSync(
      join(home, ".config/wtm/config.json"),
      JSON.stringify({ agents: [{ name: "bad name", command: "agent" }] }),
    );

    expect(() => loadAgents({ home })).toThrow("Invalid agent name 'bad name'");
  });

  test("combines base args and yolo args", () => {
    const agent = {
      name: "hermes-coder",
      label: "Hermes Coder",
      command: "hermes-coder",
      args: ["--profile", "coder"],
      yoloArgs: ["--dangerously-auto-approve"],
      source: "user" as const,
    };

    expect(getAgentLaunchArgs(agent)).toEqual(["--profile", "coder"]);
    expect(getAgentLaunchArgs(agent, { yolo: true })).toEqual([
      "--profile",
      "coder",
      "--dangerously-auto-approve",
    ]);
  });
});
