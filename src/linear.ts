import type { LinearIssue } from "./types";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface LinearApiResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearIssuePayload {
  identifier: string;
  title: string;
  url: string;
  state?: {
    name?: string | null;
    type?: string | null;
  } | null;
}

const OPEN_STATE_TYPES = new Set(["backlog", "triage", "unstarted", "started"]);
const MAX_BRANCH_TITLE_LENGTH = 48;

function decodeOutput(buffer?: Uint8Array): string {
  return buffer ? new TextDecoder().decode(buffer).trim() : "";
}

function ensureLinearAvailable(): void {
  const proc = Bun.spawnSync({
    cmd: ["which", "linear"],
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    throw new Error("Linear CLI is not available on PATH.");
  }
}

function runLinear(args: string[], workspace?: string): CommandResult {
  ensureLinearAvailable();

  const command = workspace
    ? ["linear", "--workspace", workspace, ...args]
    : ["linear", ...args];
  const proc = Bun.spawnSync({
    cmd: command,
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: decodeOutput(proc.stdout),
    stderr: decodeOutput(proc.stderr),
    exitCode: proc.exitCode,
  };
}

function runLinearApi<T>(
  query: string,
  options: { workspace?: string; variables?: Record<string, string> } = {},
): T {
  const args = ["api", query];

  for (const [key, value] of Object.entries(options.variables ?? {})) {
    args.push("--variable", `${key}=${value}`);
  }

  const result = runLinear(args, options.workspace);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Linear API request failed.");
  }

  let parsed: LinearApiResponse<T>;
  try {
    parsed = JSON.parse(result.stdout) as LinearApiResponse<T>;
  } catch {
    throw new Error("Linear API returned invalid JSON.");
  }

  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || "Linear API request failed.");
  }

  if (parsed.data === undefined) {
    throw new Error("Linear API response did not include data.");
  }

  return parsed.data;
}

function toLinearIssue(issue: LinearIssuePayload): LinearIssue {
  return {
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    stateName: issue.state?.name ?? "Unknown",
    stateType: issue.state?.type ?? "unknown",
  };
}

export function getLinearIssue(
  issueId: string,
  options: { workspace?: string } = {},
): LinearIssue {
  const data = runLinearApi<{ issue: LinearIssuePayload | null }>(
    `query ($id: String!) {
      issue(id: $id) {
        identifier
        title
        url
        state {
          name
          type
        }
      }
    }`,
    {
      workspace: options.workspace,
      variables: { id: issueId },
    },
  );

  if (!data.issue) {
    throw new Error(`No Linear issue found for '${issueId}'.`);
  }

  return toLinearIssue(data.issue);
}

export function listOpenLinearIssues(
  options: { workspace?: string } = {},
): LinearIssue[] {
  const data = runLinearApi<{
    issues: {
      nodes: LinearIssuePayload[];
    };
  }>(
    `query {
      issues(first: 100) {
        nodes {
          identifier
          title
          url
          state {
            name
            type
          }
        }
      }
    }`,
    {
      workspace: options.workspace,
    },
  );

  return data.issues.nodes
    .map(toLinearIssue)
    .filter((issue) => OPEN_STATE_TYPES.has(issue.stateType));
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) {
    return "";
  }

  return normalized.slice(0, MAX_BRANCH_TITLE_LENGTH).replace(/-+$/g, "");
}

export function branchSlugForLinearIssue(issue: LinearIssue): string {
  const identifier = issue.identifier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (identifier.length === 0) {
    throw new Error("Linear issue identifier is required.");
  }

  const titleSlug = slugify(issue.title);
  return titleSlug.length > 0
    ? `feature/${identifier}-${titleSlug}`
    : `feature/${identifier}`;
}
