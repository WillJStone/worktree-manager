import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { branchSlugToDirName, createWorktree, listWorktrees, resolveRepoContext } from "../src/git";

const tempDirs: string[] = [];

function run(command: string[], cwd: string): void {
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
}

function createRepo(defaultBranch: string): string {
  const repoDir = mkdtempSync(join(tmpdir(), "wtm-"));
  tempDirs.push(repoDir);

  run(["git", "init", "-b", defaultBranch], repoDir);
  run(["git", "config", "user.email", "test@example.com"], repoDir);
  run(["git", "config", "user.name", "Test User"], repoDir);

  writeFileSync(join(repoDir, "README.md"), "# temp\n");
  run(["git", "add", "README.md"], repoDir);
  run(["git", "commit", "-m", "init"], repoDir);
  mkdirSync(join(repoDir, ".claude"), { recursive: true });

  return repoDir;
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
});
