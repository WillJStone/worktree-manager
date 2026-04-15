import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runNew, type CliOptions } from "../src/commands";
import {
  branchSlugForLinearIssue,
  getLinearIssue,
  listOpenLinearIssues,
} from "../src/linear";
import { listWorktrees, resolveRepoContext } from "../src/git";

const tempDirs: string[] = [];
const originalCwd = process.cwd();
const originalPath = process.env.PATH;
const originalLinearOpenIssuesJson = process.env.LINEAR_OPEN_ISSUES_JSON;
const originalLinearExpectedIssueId = process.env.LINEAR_EXPECTED_ISSUE_ID;
const originalLinearIssueJson = process.env.LINEAR_ISSUE_JSON;
const originalLinearLogPath = process.env.LINEAR_LOG_PATH;

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

function createRepo(defaultBranch: string): string {
  const repoDir = mkdtempSync(join(tmpdir(), "wtm-linear-"));
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

function installFakeLinear(options: {
  openIssuesJson?: string;
  expectedIssueId?: string;
  issueJson?: string;
} = {}): { logPath: string } {
  const binDir = mkdtempSync(join(tmpdir(), "wtm-linear-bin-"));
  tempDirs.push(binDir);

  const logPath = join(binDir, "linear.log");
  const scriptPath = join(binDir, "linear");
  writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ -n "$LINEAR_LOG_PATH" ]; then
  printf '%s\\n' "$*" >> "$LINEAR_LOG_PATH"
fi

if [ "$1" = "--workspace" ]; then
  shift 2
fi

if [ "$1" != "api" ]; then
  echo "unexpected command: $1" >&2
  exit 1
fi

query="$2"
shift 2

case "$query" in
  *issues*)
    printf '%s' "$LINEAR_OPEN_ISSUES_JSON"
    exit 0
    ;;
  *issue\\(id:*)
    issue_id=""
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--variable" ] && [ "$#" -gt 1 ]; then
        case "$2" in
          id=*)
            issue_id="\${2#id=}"
            ;;
        esac
        shift 2
        continue
      fi
      shift
    done

    if [ "$issue_id" = "$LINEAR_EXPECTED_ISSUE_ID" ]; then
      printf '%s' "$LINEAR_ISSUE_JSON"
    else
      printf '%s' '{"data":{"issue":null}}'
    fi
    exit 0
    ;;
  *)
    echo "unexpected query: $query" >&2
    exit 1
    ;;
esac
`,
  );
  chmodSync(scriptPath, 0o755);

  process.env.PATH = originalPath ? `${binDir}:${originalPath}` : binDir;
  process.env.LINEAR_LOG_PATH = logPath;
  process.env.LINEAR_EXPECTED_ISSUE_ID = options.expectedIssueId ?? "BOU-130";
  process.env.LINEAR_OPEN_ISSUES_JSON =
    options.openIssuesJson ??
    JSON.stringify({
      data: {
        issues: {
          nodes: [],
        },
      },
    });
  process.env.LINEAR_ISSUE_JSON =
    options.issueJson ??
    JSON.stringify({
      data: {
        issue: {
          identifier: "BOU-130",
          title: "Add picker support",
          url: "https://linear.app/boundlessdiscovery/issue/BOU-130",
          state: {
            name: "Todo",
            type: "unstarted",
          },
        },
      },
    });

  return { logPath };
}

async function captureConsoleLogs(action: () => Promise<void>): Promise<string[]> {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map((value) => String(value)).join(" "));
  };

  try {
    await action();
  } finally {
    console.log = originalLog;
  }

  return logs;
}

afterEach(() => {
  process.chdir(originalCwd);
  process.env.PATH = originalPath;
  process.env.LINEAR_OPEN_ISSUES_JSON = originalLinearOpenIssuesJson;
  process.env.LINEAR_EXPECTED_ISSUE_ID = originalLinearExpectedIssueId;
  process.env.LINEAR_ISSUE_JSON = originalLinearIssueJson;
  process.env.LINEAR_LOG_PATH = originalLinearLogPath;

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("linear integration", () => {
  test("filters open workspace issues to open states", () => {
    installFakeLinear({
      openIssuesJson: JSON.stringify({
        data: {
          issues: {
            nodes: [
              {
                identifier: "BOU-1",
                title: "Backlog issue",
                url: "https://linear.app/boundlessdiscovery/issue/BOU-1",
                state: { name: "Backlog", type: "backlog" },
              },
              {
                identifier: "BOU-2",
                title: "Started issue",
                url: "https://linear.app/boundlessdiscovery/issue/BOU-2",
                state: { name: "In Progress", type: "started" },
              },
              {
                identifier: "BOU-3",
                title: "Completed issue",
                url: "https://linear.app/boundlessdiscovery/issue/BOU-3",
                state: { name: "Done", type: "completed" },
              },
              {
                identifier: "BOU-4",
                title: "Canceled issue",
                url: "https://linear.app/boundlessdiscovery/issue/BOU-4",
                state: { name: "Canceled", type: "canceled" },
              },
            ],
          },
        },
      }),
    });

    const issues = listOpenLinearIssues();
    expect(issues.map((issue) => issue.identifier)).toEqual(["BOU-1", "BOU-2"]);
  });

  test("creates a deterministic feature branch from a Linear issue", () => {
    installFakeLinear({
      expectedIssueId: "BOU-77",
      issueJson: JSON.stringify({
        data: {
          issue: {
            identifier: "BOU-77",
            title: "Add picker/support!!!",
            url: "https://linear.app/boundlessdiscovery/issue/BOU-77",
            state: { name: "Todo", type: "unstarted" },
          },
        },
      }),
    });

    const issue = getLinearIssue("BOU-77");
    expect(branchSlugForLinearIssue(issue)).toBe("feature/bou-77-add-picker-support");
  });

  test("creates a worktree from a Linear issue and forwards the workspace flag", async () => {
    const repoDir = createRepo("main");
    const { logPath } = installFakeLinear({
      expectedIssueId: "BOU-130",
      issueJson: JSON.stringify({
        data: {
          issue: {
            identifier: "BOU-130",
            title: "Add picker support",
            url: "https://linear.app/boundlessdiscovery/issue/BOU-130",
            state: { name: "Todo", type: "unstarted" },
          },
        },
      }),
    });

    process.chdir(repoDir);

    const logs = await captureConsoleLogs(async () => {
      const options: CliOptions = {
        args: [],
        flags: new Map([
          ["issue", "BOU-130"],
          ["workspace", "boundlessdiscovery"],
        ]),
      };

      await runNew(options);
    });

    const context = resolveRepoContext(repoDir);
    const branch = "feature/bou-130-add-picker-support";
    const worktreePath = join(
      repoDir,
      ".claude",
      "worktrees",
      "feature--bou-130-add-picker-support",
    );

    expect(logs).toContain(worktreePath);
    expect(
      listWorktrees(context).some((entry) => entry.branch === branch && entry.path === worktreePath),
    ).toBe(true);
    expect(readFileSync(logPath, "utf8")).toContain("--workspace boundlessdiscovery");
  });

  test("requires an explicit issue key in non-interactive shells", async () => {
    const repoDir = createRepo("main");
    process.chdir(repoDir);

    await expect(
      runNew({
        args: [],
        flags: new Map([["issue", true]]),
      }),
    ).rejects.toThrow("--issue requires an issue key in non-interactive shells.");
  });
});
