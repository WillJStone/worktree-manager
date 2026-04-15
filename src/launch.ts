import type { AgentName } from "./types";

export interface LaunchOptions {
  yolo?: boolean;
}

export function getAgentLaunchArgs(
  agent: AgentName,
  options: LaunchOptions = {},
): string[] {
  if (!options.yolo) {
    return [];
  }

  if (agent === "claude") {
    return ["--dangerously-skip-permissions"];
  }

  if (agent === "codex") {
    return ["--full-auto"];
  }

  return [];
}

export async function launchAgent(
  agent: AgentName,
  cwd: string,
  options: LaunchOptions = {},
): Promise<void> {
  if (agent === "nothing") {
    return;
  }

  const command = agent;
  const whichResult = Bun.spawnSync({
    cmd: ["which", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (whichResult.exitCode !== 0) {
    throw new Error(`Launcher '${command}' is not available on PATH.`);
  }

  const proc = Bun.spawn({
    cmd: [command, ...getAgentLaunchArgs(agent, options)],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Launcher '${command}' exited with code ${exitCode}.`);
  }
}
