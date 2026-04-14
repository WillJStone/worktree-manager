import { existsSync, mkdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { CleanupCandidate, RepoContext, WorktreeEntry } from "./types";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runGit(args: string[], cwd: string): CommandResult {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "",
    stderr: proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "",
    exitCode: proc.exitCode,
  };
}

function mustRunGit(args: string[], cwd: string, errorMessage: string): string {
  const result = runGit(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || errorMessage);
  }

  return result.stdout;
}

export function resolveRepoContext(cwd: string): RepoContext {
  const gitRoot = mustRunGit(
    ["rev-parse", "--show-toplevel"],
    cwd,
    "Failed to detect the git root.",
  );

  const defaultBranch = detectDefaultBranch(gitRoot);
  const worktreeRoot = join(gitRoot, ".claude", "worktrees");

  return {
    gitRoot,
    defaultBranch,
    worktreeRoot,
  };
}

export function detectDefaultBranch(gitRoot: string): string {
  const originHead = runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    gitRoot,
  );
  if (originHead.exitCode === 0 && originHead.stdout.startsWith("origin/")) {
    return originHead.stdout.slice("origin/".length);
  }

  for (const branch of ["main", "master"]) {
    const localBranch = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], gitRoot);
    if (localBranch.exitCode === 0) {
      return branch;
    }
  }

  const currentBranch = runGit(["branch", "--show-current"], gitRoot);
  if (currentBranch.exitCode === 0 && currentBranch.stdout.length > 0) {
    return currentBranch.stdout;
  }

  const initDefault = runGit(["config", "--get", "init.defaultBranch"], gitRoot);
  if (initDefault.exitCode === 0 && initDefault.stdout.length > 0) {
    return initDefault.stdout;
  }

  throw new Error(
    "Unable to determine the repo's default branch. Set an origin HEAD or create a local main/master branch.",
  );
}

export function branchSlugToDirName(branchSlug: string): string {
  const trimmed = branchSlug.trim();
  if (trimmed.length === 0) {
    throw new Error("Branch slug is required.");
  }

  return trimmed.replace(/[\\/]/g, "--");
}

export function worktreePathForBranch(context: RepoContext, branchSlug: string): string {
  return join(context.worktreeRoot, branchSlugToDirName(branchSlug));
}

export function ensureWorktreeRoot(context: RepoContext): void {
  mkdirSync(context.worktreeRoot, { recursive: true });
}

export function branchExists(context: RepoContext, branchSlug: string): boolean {
  return runGit(
    ["show-ref", "--verify", "--quiet", `refs/heads/${branchSlug}`],
    context.gitRoot,
  ).exitCode === 0;
}

export function createWorktree(context: RepoContext, branchSlug: string): string {
  if (branchExists(context, branchSlug)) {
    throw new Error(`Branch '${branchSlug}' already exists.`);
  }

  ensureWorktreeRoot(context);
  const worktreePath = worktreePathForBranch(context, branchSlug);

  if (existsSync(worktreePath)) {
    throw new Error(`Worktree path already exists: ${worktreePath}`);
  }

  const result = runGit(
    ["worktree", "add", "-b", branchSlug, worktreePath, context.defaultBranch],
    context.gitRoot,
  );

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to create worktree for '${branchSlug}'.`);
  }

  return worktreePath;
}

interface StatusSummary {
  isDirty: boolean;
  modifiedCount: number;
  untrackedCount: number;
}

function parseWorktreeList(output: string, mainRoot: string): WorktreeEntry[] {
  const blocks = output
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const entry: WorktreeEntry = {
      path: "",
      bare: false,
      detached: false,
      locked: false,
      prunable: false,
      isMain: false,
      isDirty: false,
      modifiedCount: 0,
      untrackedCount: 0,
      mergedIntoDefault: false,
    };

    for (const line of block.split("\n")) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ").trim();
      switch (key) {
        case "worktree":
          entry.path = value;
          entry.isMain = resolve(value) === resolve(mainRoot);
          break;
        case "HEAD":
          entry.head = value;
          break;
        case "branch":
          entry.branch = value.replace("refs/heads/", "");
          break;
        case "bare":
          entry.bare = true;
          break;
        case "detached":
          entry.detached = true;
          break;
        case "locked":
          entry.locked = true;
          break;
        case "prunable":
          entry.prunable = true;
          break;
      }
    }

    return entry;
  });
}

function getStatusSummary(path: string): StatusSummary {
  const result = runGit(["status", "--porcelain"], path);
  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return {
      isDirty: false,
      modifiedCount: 0,
      untrackedCount: 0,
    };
  }

  let modifiedCount = 0;
  let untrackedCount = 0;

  for (const line of result.stdout.split("\n")) {
    if (!line) {
      continue;
    }

    if (line.startsWith("??")) {
      untrackedCount += 1;
      continue;
    }

    modifiedCount += 1;
  }

  return {
    isDirty: modifiedCount > 0 || untrackedCount > 0,
    modifiedCount,
    untrackedCount,
  };
}

function getUpstreamBranch(path: string): string | undefined {
  const result = runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    path,
  );
  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return undefined;
  }

  return result.stdout;
}

function getAheadBehind(path: string): { aheadCount?: number; behindCount?: number } {
  const upstreamBranch = getUpstreamBranch(path);
  if (!upstreamBranch) {
    return {};
  }

  const result = runGit(["rev-list", "--left-right", "--count", `HEAD...${upstreamBranch}`], path);
  if (result.exitCode !== 0 || result.stdout.length === 0) {
    return { upstreamBranch };
  }

  const [aheadRaw, behindRaw] = result.stdout.split(/\s+/);
  return {
    upstreamBranch,
    aheadCount: Number(aheadRaw) || 0,
    behindCount: Number(behindRaw) || 0,
  };
}

function isMergedIntoDefault(context: RepoContext, branch: string | undefined): boolean {
  if (!branch || branch === context.defaultBranch) {
    return false;
  }

  const ancestryResult = runGit(
    ["merge-base", "--is-ancestor", branch, context.defaultBranch],
    context.gitRoot,
  );
  if (ancestryResult.exitCode === 0) {
    return true;
  }

  // Fall back to patch-equivalence so squash or cherry-pick merges still clean up
  // once the branch has no unique non-merge commits left relative to the default branch.
  const patchResult = runGit(
    [
      "log",
      "--cherry-pick",
      "--right-only",
      "--no-merges",
      "--format=%H",
      `${context.defaultBranch}...${branch}`,
    ],
    context.gitRoot,
  );
  return patchResult.exitCode === 0 && patchResult.stdout.length === 0;
}

export function listWorktrees(context: RepoContext): WorktreeEntry[] {
  const output = mustRunGit(
    ["worktree", "list", "--porcelain"],
    context.gitRoot,
    "Failed to list worktrees.",
  );

  const entries = parseWorktreeList(output, context.gitRoot);
  return entries.map((entry) => ({
    ...entry,
    ...(!entry.bare && !entry.prunable ? getStatusSummary(entry.path) : {
      isDirty: false,
      modifiedCount: 0,
      untrackedCount: 0,
    }),
    ...(!entry.bare && !entry.prunable ? getAheadBehind(entry.path) : {}),
    mergedIntoDefault:
      !entry.bare && !entry.prunable && !entry.isMain ? isMergedIntoDefault(context, entry.branch) : false,
  }));
}

export function findWorktree(
  context: RepoContext,
  identifier: string,
): WorktreeEntry | undefined {
  const normalized = identifier.trim();
  const byBranchOrName = listWorktrees(context).find((entry) => {
    const dirName = basename(entry.path);
    return (
      entry.branch === normalized ||
      dirName === normalized ||
      relative(context.gitRoot, entry.path) === normalized
    );
  });

  return byBranchOrName;
}

export function removeWorktree(
  context: RepoContext,
  entry: WorktreeEntry,
  options: { force?: boolean } = {},
): void {
  if (entry.isMain) {
    throw new Error("Refusing to remove the main worktree.");
  }

  if (entry.isDirty && !options.force) {
    throw new Error(`Worktree is dirty: ${entry.path}`);
  }

  const args = ["worktree", "remove"];
  if (options.force) {
    args.push("--force");
  }
  args.push(entry.path);

  const result = runGit(args, context.gitRoot);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Failed to remove worktree '${entry.path}'.`);
  }
}

export function pruneWorktrees(context: RepoContext): string {
  const result = runGit(["worktree", "prune"], context.gitRoot);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to prune worktrees.");
  }

  return result.stdout;
}

export function getCleanupCandidates(
  context: RepoContext,
  options: { force?: boolean } = {},
): CleanupCandidate[] {
  return listWorktrees(context)
    .filter((entry) => entry.prunable || entry.mergedIntoDefault)
    .map((entry) => {
      if (entry.prunable) {
        return {
          entry,
          action: "prune",
          reason: "prunable",
        };
      }

      if (entry.isDirty) {
        if (options.force) {
          return {
            entry,
            action: "remove",
            reason: "merged",
            requiresForce: true,
          };
        }

        return {
          entry,
          reason: "merged",
          blockedReason: "dirty",
        };
      }

      return {
        entry,
        action: "remove",
        reason: "merged",
      };
    });
}

export function performCleanupCandidate(context: RepoContext, candidate: CleanupCandidate): string {
  if (candidate.blockedReason) {
    throw new Error(`Cleanup candidate is blocked: ${candidate.entry.path} (${candidate.blockedReason})`);
  }

  if (candidate.action === "remove") {
    removeWorktree(context, candidate.entry, { force: candidate.requiresForce === true });
    pruneWorktrees(context);
    return `Removed ${relative(context.gitRoot, candidate.entry.path) || candidate.entry.path}`;
  }

  if (candidate.action === "prune") {
    pruneWorktrees(context);
    return "Pruned stale worktree metadata.";
  }

  throw new Error(`Cleanup candidate is not actionable: ${candidate.entry.path}`);
}
