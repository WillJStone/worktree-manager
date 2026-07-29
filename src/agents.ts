import { loadWtmConfig, type WtmConfigLoadOptions } from "./wtm-config";

export interface AgentDefinition {
  name: string;
  label: string;
  command: string;
  args: string[];
  yoloArgs: string[];
  source: "builtin" | "user";
}

/** Options for selecting the configuration file when loading agents. */
export type LoadAgentsOptions = WtmConfigLoadOptions;

export interface LaunchOptions {
  yolo?: boolean;
}

const AGENT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "codex",
    label: "Codex",
    command: "codex",
    args: [],
    yoloArgs: ["--full-auto"],
    source: "builtin",
  },
  {
    name: "claude",
    label: "Claude Code",
    command: "claude",
    args: [],
    yoloArgs: ["--dangerously-skip-permissions"],
    source: "builtin",
  },
];

function requireString(value: unknown, field: string, agentName?: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  const prefix = agentName ? `Agent '${agentName}'` : "Agent";
  throw new Error(`${prefix} requires a non-empty '${field}'.`);
}

function optionalStringArray(value: unknown, field: string, agentName: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Agent '${agentName}' field '${field}' must be an array of strings.`);
  }

  return [...value];
}

function normalizeCustomAgent(value: unknown): AgentDefinition {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each custom agent must be an object.");
  }

  const raw = value as Record<string, unknown>;
  const name = requireString(raw.name, "name");
  if (!AGENT_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid agent name '${name}'. Use letters, numbers, dots, dashes, or underscores.`);
  }

  const command = requireString(raw.command, "command", name);
  const label = typeof raw.label === "string" && raw.label.trim().length > 0 ? raw.label : name;

  return {
    name,
    label,
    command,
    args: optionalStringArray(raw.args, "args", name),
    yoloArgs: optionalStringArray(raw.yoloArgs, "yoloArgs", name),
    source: "user",
  };
}

export function loadAgents(options: LoadAgentsOptions = {}): AgentDefinition[] {
  const config = loadWtmConfig(options);
  const customAgents = config?.agents;

  if (customAgents === undefined) {
    return [...BUILTIN_AGENTS];
  }

  if (!Array.isArray(customAgents)) {
    throw new Error("Agent config field 'agents' must be an array.");
  }

  const agents = [...BUILTIN_AGENTS];
  for (const customAgent of customAgents) {
    const normalized = normalizeCustomAgent(customAgent);
    const existingIndex = agents.findIndex((agent) => agent.name === normalized.name);
    if (existingIndex === -1) {
      agents.push(normalized);
    } else {
      agents[existingIndex] = normalized;
    }
  }

  return agents;
}

export function getAgentNames(agents: AgentDefinition[]): string[] {
  return agents.map((agent) => agent.name);
}

export function getAgentByName(
  agents: AgentDefinition[],
  name: string,
): AgentDefinition | undefined {
  return agents.find((agent) => agent.name === name);
}

export function getAgentLaunchArgs(
  agent: AgentDefinition,
  options: LaunchOptions = {},
): string[] {
  if (!options.yolo) {
    return [...agent.args];
  }

  return [...agent.args, ...agent.yoloArgs];
}
