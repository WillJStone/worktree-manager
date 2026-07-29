import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parsed settings from the user's worktree-manager configuration file. */
export interface WtmConfig {
  agents?: unknown;
  worktreeRoot?: unknown;
}

/** Options for selecting the worktree-manager configuration file. */
export interface WtmConfigLoadOptions {
  home?: string;
  configPath?: string;
}

function getDefaultWtmConfigPath(home: string): string {
  return join(home, ".config", "wtm", "config.json");
}

/** Loads ~/.config/wtm/config.json, honoring WTM_CONFIG and test overrides. */
export function loadWtmConfig(options: WtmConfigLoadOptions = {}): WtmConfig | undefined {
  const home = options.home ?? process.env.HOME ?? "";
  const configPath = options.configPath ?? process.env.WTM_CONFIG ?? getDefaultWtmConfigPath(home);

  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as WtmConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read WTM config '${configPath}': ${message}`);
  }
}
