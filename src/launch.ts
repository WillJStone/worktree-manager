import type { AgentName } from "./types";

export async function launchAgent(agent: AgentName, cwd: string): Promise<void> {
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
    cmd: [command],
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
