export type AgentName = "codex" | "claude" | "pi";

export type CleanupAction = "remove" | "prune";
export type CleanupReason = "merged" | "prunable";

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
  upstreamBranch?: string;
  aheadCount?: number;
  behindCount?: number;
  modifiedCount: number;
  untrackedCount: number;
  mergedIntoDefault: boolean;
}

export interface CleanupCandidate {
  entry: WorktreeEntry;
  action?: CleanupAction;
  reason: CleanupReason;
  blockedReason?: string;
}
