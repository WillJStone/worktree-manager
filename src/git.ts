import { existsSync, mkdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { RepoContext, WorktreeEntry } from "./types";

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

export function isWorktreeDirty(path: string): boolean {
  const result = runGit(["status", "--porcelain"], path);
  return result.exitCode === 0 && result.stdout.length > 0;
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
    isDirty: !entry.bare && !entry.prunable && isWorktreeDirty(entry.path),
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
