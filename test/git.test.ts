import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  branchSlugToDirName,
  createWorktree,
  getCleanupCandidates,
  listWorktrees,
  performCleanupCandidate,
  pruneWorktrees,
  resolveRepoContext,
} from "../src/git";

const tempDirs: string[] = [];

function run(command: string[], cwd: string): string {
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
    throw new Error(stderr || `Command failed: ${command.join(" ")}`);
  }

  return proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "";
}

function runExitCode(command: string[], cwd: string): number {
  const proc = Bun.spawnSync({
    cmd: command,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  return proc.exitCode;
}

function createBareOrigin(): string {
  const originDir = mkdtempSync(join(tmpdir(), "wtm-origin-"));
  tempDirs.push(originDir);
  run(["git", "init", "--bare"], originDir);
  return originDir;
}

function createRepo(defaultBranch: string, options: { withOrigin?: boolean } = {}): string {
  const repoDir = mkdtempSync(join(tmpdir(), "wtm-"));
  tempDirs.push(repoDir);

  run(["git", "init", "-b", defaultBranch], repoDir);
  run(["git", "config", "user.email", "test@example.com"], repoDir);
  run(["git", "config", "user.name", "Test User"], repoDir);

  writeFileSync(join(repoDir, "README.md"), "# temp\n");
  run(["git", "add", "README.md"], repoDir);
  run(["git", "commit", "-m", "init"], repoDir);
  mkdirSync(join(repoDir, ".claude"), { recursive: true });

  if (options.withOrigin) {
    const originDir = createBareOrigin();
    run(["git", "remote", "add", "origin", originDir], repoDir);
    run(["git", "push", "-u", "origin", defaultBranch], repoDir);
    run(["git", "remote", "set-head", "origin", "-a"], repoDir);
  }

  return repoDir;
}

function cloneRepo(remoteDir: string): string {
  const cloneDir = mkdtempSync(join(tmpdir(), "wtm-clone-"));
  tempDirs.push(cloneDir);
  run(["git", "clone", remoteDir, cloneDir], tmpdir());
  run(["git", "config", "user.email", "test@example.com"], cloneDir);
  run(["git", "config", "user.name", "Test User"], cloneDir);
  return cloneDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("git helpers", () => {
  test("normalizes branch slugs for directories", () => {
    expect(branchSlugToDirName("feature/test")).toBe("feature--test");
  });

  test("detects a main default branch and creates a worktree", () => {
    const repoDir = createRepo("main");
    const context = resolveRepoContext(repoDir);

    expect(context.defaultBranch).toBe("main");

    const worktreePath = createWorktree(context, "feature/test");
    expect(worktreePath.endsWith(".claude/worktrees/feature--test")).toBe(true);

    const entries = listWorktrees(context);
    expect(entries.some((entry) => entry.branch === "feature/test")).toBe(true);
  });

  test("detects a master default branch without origin", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    expect(context.defaultBranch).toBe("master");
  });

  test("reports ahead and behind counts plus file counts", () => {
    const repoDir = createRepo("master", { withOrigin: true });
    const context = resolveRepoContext(repoDir);
    const worktreePath = createWorktree(context, "feature/sync");
    const originDir = run(["git", "remote", "get-url", "origin"], repoDir);

    run(["git", "push", "-u", "origin", "feature/sync"], worktreePath);

    writeFileSync(join(worktreePath, "local.txt"), "local\n");
    run(["git", "add", "local.txt"], worktreePath);
    run(["git", "commit", "-m", "local"], worktreePath);
    writeFileSync(join(worktreePath, "README.md"), "# temp\nupdated locally\n");
    writeFileSync(join(worktreePath, "untracked.txt"), "draft\n");

    const cloneDir = cloneRepo(originDir);
    run(["git", "checkout", "feature/sync"], cloneDir);
    writeFileSync(join(cloneDir, "remote.txt"), "remote\n");
    run(["git", "add", "remote.txt"], cloneDir);
    run(["git", "commit", "-m", "remote"], cloneDir);
    run(["git", "push", "origin", "feature/sync"], cloneDir);

    run(["git", "fetch", "origin"], worktreePath);

    const entry = listWorktrees(context).find((candidate) => candidate.branch === "feature/sync");
    expect(entry).toBeDefined();
    expect(entry?.upstreamBranch).toBe("origin/feature/sync");
    expect(entry?.aheadCount).toBe(1);
    expect(entry?.behindCount).toBe(1);
    expect(entry?.modifiedCount).toBe(1);
    expect(entry?.untrackedCount).toBe(1);
  });

  test("classifies merged, dirty, and prunable cleanup candidates", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    const mergedPath = createWorktree(context, "feature/merged");
    writeFileSync(join(mergedPath, "merged.txt"), "done\n");
    run(["git", "add", "merged.txt"], mergedPath);
    run(["git", "commit", "-m", "merged"], mergedPath);
    run(["git", "checkout", "master"], repoDir);
    run(["git", "merge", "--no-ff", "feature/merged", "-m", "merge feature/merged"], repoDir);

    const dirtyPath = createWorktree(context, "feature/dirty");
    writeFileSync(join(dirtyPath, "dirty.txt"), "dirty\n");
    run(["git", "add", "dirty.txt"], dirtyPath);
    run(["git", "commit", "-m", "dirty"], dirtyPath);
    run(["git", "checkout", "master"], repoDir);
    run(["git", "merge", "--no-ff", "feature/dirty", "-m", "merge feature/dirty"], repoDir);
    writeFileSync(join(dirtyPath, "dirty.txt"), "changed after merge\n");

    const squashedPath = createWorktree(context, "feature/squashed");
    writeFileSync(join(squashedPath, "squashed.txt"), "squashed\n");
    run(["git", "add", "squashed.txt"], squashedPath);
    run(["git", "commit", "-m", "squashed"], squashedPath);
    const squashedHead = run(["git", "rev-parse", "HEAD"], squashedPath);
    run(["git", "checkout", "master"], repoDir);
    run(["git", "cherry-pick", squashedHead], repoDir);

    const prunePath = createWorktree(context, "feature/prunable");
    rmSync(prunePath, { recursive: true, force: true });

    const candidates = getCleanupCandidates(context);
    const mergedCandidate = candidates.find((candidate) => candidate.entry.branch === "feature/merged");
    const dirtyCandidate = candidates.find((candidate) => candidate.entry.branch === "feature/dirty");
    const squashedCandidate = candidates.find((candidate) => candidate.entry.branch === "feature/squashed");
    const prunableCandidate = candidates.find((candidate) => candidate.reason === "prunable");

    expect(mergedCandidate?.action).toBe("remove");
    expect(mergedCandidate?.blockedReason).toBeUndefined();

    expect(dirtyCandidate?.reason).toBe("merged");
    expect(dirtyCandidate?.blockedReason).toBe("dirty");

    expect(squashedCandidate?.action).toBe("remove");
    expect(squashedCandidate?.blockedReason).toBeUndefined();

    expect(prunableCandidate?.action).toBe("prune");
  });

  test("classifies multi-commit squash merges as merged cleanup candidates", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    const squashedPath = createWorktree(context, "feature/multi-squashed");
    writeFileSync(join(squashedPath, "first.txt"), "first\n");
    run(["git", "add", "first.txt"], squashedPath);
    run(["git", "commit", "-m", "first"], squashedPath);
    writeFileSync(join(squashedPath, "second.txt"), "second\n");
    run(["git", "add", "second.txt"], squashedPath);
    run(["git", "commit", "-m", "second"], squashedPath);

    run(["git", "checkout", "master"], repoDir);
    run(["git", "merge", "--squash", "feature/multi-squashed"], repoDir);
    run(["git", "commit", "-m", "squash merge feature/multi-squashed"], repoDir);

    const candidate = getCleanupCandidates(context).find(
      (entry) => entry.entry.branch === "feature/multi-squashed",
    );

    expect(candidate?.action).toBe("remove");
    expect(candidate?.reason).toBe("merged");
    expect(candidate?.blockedReason).toBeUndefined();
  });

  test("allows forcing dirty merged cleanup candidates", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    const dirtyPath = createWorktree(context, "feature/force-clean");
    writeFileSync(join(dirtyPath, "dirty.txt"), "dirty\n");
    run(["git", "add", "dirty.txt"], dirtyPath);
    run(["git", "commit", "-m", "dirty"], dirtyPath);
    run(["git", "checkout", "master"], repoDir);
    run(["git", "merge", "--no-ff", "feature/force-clean", "-m", "merge feature/force-clean"], repoDir);
    writeFileSync(join(dirtyPath, "dirty.txt"), "changed after merge\n");

    const blockedCandidate = getCleanupCandidates(context).find(
      (candidate) => candidate.entry.branch === "feature/force-clean",
    );
    expect(blockedCandidate?.blockedReason).toBe("dirty");

    const forcedCandidate = getCleanupCandidates(context, { force: true }).find(
      (candidate) => candidate.entry.branch === "feature/force-clean",
    );
    expect(forcedCandidate?.action).toBe("remove");
    expect(forcedCandidate?.requiresForce).toBe(true);
    expect(forcedCandidate?.blockedReason).toBeUndefined();

    expect(performCleanupCandidate(context, forcedCandidate!)).toContain("Removed");
    expect(listWorktrees(context).some((entry) => entry.branch === "feature/force-clean")).toBe(false);
  });

  test("reattaches an orphan branch whose worktree directory was deleted", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    const originalPath = createWorktree(context, "feature/orphan");
    rmSync(originalPath, { recursive: true, force: true });

    // Branch ref still exists, but the worktree directory is gone.
    expect(runExitCode(["git", "show-ref", "--verify", "--quiet", "refs/heads/feature/orphan"], repoDir)).toBe(0);

    const reattachedPath = createWorktree(context, "feature/orphan");
    expect(reattachedPath).toBe(originalPath);

    const entries = listWorktrees(context);
    const entry = entries.find((candidate) => candidate.branch === "feature/orphan");
    expect(entry).toBeDefined();
    expect(entry?.path).toBe(reattachedPath);
  });

  test("refuses to create a worktree when the branch is already checked out elsewhere", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);

    createWorktree(context, "feature/in-use");

    expect(() => createWorktree(context, "feature/in-use")).toThrow(/already checked out/);
  });

  test("removes merged cleanup candidates without deleting branches", () => {
    const repoDir = createRepo("master");
    const context = resolveRepoContext(repoDir);
    const mergedPath = createWorktree(context, "feature/remove-me");

    writeFileSync(join(mergedPath, "remove.txt"), "done\n");
    run(["git", "add", "remove.txt"], mergedPath);
    run(["git", "commit", "-m", "remove"], mergedPath);
    run(["git", "checkout", "master"], repoDir);
    run(["git", "merge", "--no-ff", "feature/remove-me", "-m", "merge feature/remove-me"], repoDir);

    const candidate = getCleanupCandidates(context).find(
      (entry) => entry.entry.branch === "feature/remove-me",
    );

    expect(candidate).toBeDefined();
    expect(performCleanupCandidate(context, candidate!)).toContain("Removed");
    expect(runExitCode(["git", "show-ref", "--verify", "--quiet", "refs/heads/feature/remove-me"], repoDir)).toBe(0);
    expect(listWorktrees(context).some((entry) => entry.branch === "feature/remove-me")).toBe(false);
  });
});
