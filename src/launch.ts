import { getAgentLaunchArgs, type AgentDefinition, type LaunchOptions } from "./agents";

export async function launchAgent(
  agent: AgentDefinition,
  cwd: string,
  options: LaunchOptions = {},
): Promise<void> {
  const whichResult = Bun.spawnSync({
    cmd: ["which", agent.command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (whichResult.exitCode !== 0) {
    throw new Error(`Launcher '${agent.command}' is not available on PATH.`);
  }

  const proc = Bun.spawn({
    cmd: [agent.command, ...getAgentLaunchArgs(agent, options)],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Launcher '${agent.command}' exited with code ${exitCode}.`);
  }
}
