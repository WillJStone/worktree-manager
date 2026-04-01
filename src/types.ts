export type AgentName = "codex" | "claude" | "pi" | "nothing";

export interface RepoContext {
  gitRoot: string;
  defaultBranch: string;
  worktreeRoot: string;
}

export interface WorktreeEntry {
  path: string;
  branch?: string;
  head?: string;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isMain: boolean;
  isDirty: boolean;
}
