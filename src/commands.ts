import { relative } from "node:path";
import { getAgentByName, getAgentNames, loadAgents, type AgentDefinition } from "./agents";
import {
  createWorktree,
  detectDefaultBranch,
  findWorktree,
  getCleanupCandidates,
  listWorktrees,
  performCleanupCandidate,
  pruneWorktrees,
  removeWorktree,
  resolveRepoContext,
} from "./git";
import {
  branchSlugForLinearIssue,
  getLinearIssue,
  listOpenLinearIssues,
} from "./linear";
import { launchAgent } from "./launch";
import type { LinearIssue, WorktreeEntry } from "./types";
import {
  isInteractiveSession,
  pickAgent,
  pickCleanupCandidate,
  pickLinearIssue,
  pickWorktree,
  printCleanupCandidates,
  printWorktrees,
} from "./ui";

export interface CliOptions {
  args: string[];
  flags: Map<string, string | boolean>;
}

const NEW_USAGE =
  "Usage: wtm new <branch-slug> | wtm new --issue [issue-id] [--workspace <slug>]";

function getAgentFromFlags(
  flags: Map<string, string | boolean>,
  agents: AgentDefinition[],
): AgentDefinition | undefined {
  const value = flags.get("agent");
  if (typeof value !== "string") {
    return undefined;
  }

  const agent = getAgentByName(agents, value);
  if (agent) {
    return agent;
  }

  throw new Error(`Unsupported agent '${value}'. Use one of: ${getAgentNames(agents).join(", ")}.`);
}

function getOptionalStringFlag(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Flag '--${key}' requires a value.`);
  }

  return value;
}

async function maybeLaunch(
  path: string,
  flags: Map<string, string | boolean>,
  defaultAgentName: string,
): Promise<void> {
  if (flags.get("no-agent") === true) {
    return;
  }

  const yolo = flags.get("yolo") === true;
  const agents = loadAgents();

  const requested = getAgentFromFlags(flags, agents);
  if (requested) {
    await launchAgent(requested, path, { yolo });
    return;
  }

  if (!isInteractiveSession()) {
    return;
  }

  const selected = await pickAgent(agents, defaultAgentName);
  if (selected === undefined) {
    return;
  }
  await launchAgent(selected, path, { yolo });
}

function requireTarget(
  entry: WorktreeEntry | undefined,
  identifier: string | undefined,
  action: string,
): WorktreeEntry {
  if (entry) {
    return entry;
  }

  if (identifier) {
    throw new Error(`No worktree found for '${identifier}'.`);
  }

  throw new Error(`No worktree selected for ${action}.`);
}

async function resolveLinearIssue(
  issueFlag: string | boolean,
  workspace: string | undefined,
): Promise<LinearIssue | undefined> {
  if (typeof issueFlag === "string") {
    return getLinearIssue(issueFlag, { workspace });
  }

  if (!isInteractiveSession()) {
    throw new Error("--issue requires an issue key in non-interactive shells.");
  }

  const issues = listOpenLinearIssues({ workspace });
  if (issues.length === 0) {
    console.log("No open Linear issues found.");
    return undefined;
  }

  return pickLinearIssue(issues);
}

export async function runNew(options: CliOptions): Promise<void> {
  const manualBranchSlug = options.args[0];
  const issueFlag = options.flags.get("issue");
  const workspace = getOptionalStringFlag(options.flags, "workspace");

  if (workspace !== undefined && issueFlag === undefined) {
    throw new Error("`--workspace` can only be used with `--issue`.");
  }

  if (issueFlag !== undefined && manualBranchSlug !== undefined) {
    throw new Error(NEW_USAGE);
  }

  let branchSlug = manualBranchSlug;
  if (issueFlag !== undefined) {
    const issue = await resolveLinearIssue(issueFlag, workspace);
    if (!issue) {
      return;
    }

    branchSlug = branchSlugForLinearIssue(issue);
  }

  if (!branchSlug) {
    throw new Error(NEW_USAGE);
  }

  const context = resolveRepoContext(process.cwd());
  const worktreePath = createWorktree(context, branchSlug);
  console.log(worktreePath);
  await maybeLaunch(worktreePath, options.flags, "codex");
}

export async function runList(options: CliOptions): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const entries = listWorktrees(context);
  printWorktrees(context, entries);

  if (options.flags.get("pick") === true && entries.length > 0) {
    const selected = await pickWorktree(context, entries, "Select worktree:");
    if (selected) {
      console.log(selected.path);
    }
  }
}

export async function runOpen(options: CliOptions): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const identifier = options.args[0];
  const entries = listWorktrees(context);
  const selected =
    identifier !== undefined
      ? findWorktree(context, identifier)
      : await pickWorktree(context, entries, "Open worktree:");

  const entry = requireTarget(selected, identifier, "open");
  console.log(entry.path);
  await maybeLaunch(entry.path, options.flags, "codex");
}

export async function runRemove(options: CliOptions): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const identifier = options.args[0];
  const entries = listWorktrees(context).filter((entry) => !entry.isMain);
  const selected =
    identifier !== undefined
      ? findWorktree(context, identifier)
      : await pickWorktree(context, entries, "Remove worktree:");

  const entry = requireTarget(selected, identifier, "remove");
  removeWorktree(context, entry, { force: options.flags.get("force") === true });
  console.log(`Removed ${relative(context.gitRoot, entry.path) || entry.path}`);
}

export async function runPrune(): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const output = pruneWorktrees(context);
  if (output.length > 0) {
    console.log(output);
  }
  console.log("Pruned stale worktree metadata.");
}

export async function runClean(options: CliOptions): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const force = options.flags.get("force") === true;
  const candidates = getCleanupCandidates(context, { force });
  printCleanupCandidates(context, candidates);

  if (candidates.length === 0) {
    return;
  }

  if (!isInteractiveSession()) {
    console.log("Run `wtm clean` in an interactive shell to choose a cleanup candidate.");
    return;
  }

  const selected = await pickCleanupCandidate(context, candidates);
  if (!selected) {
    const blockedCount = candidates.filter((candidate) => candidate.blockedReason).length;
    if (blockedCount > 0) {
      console.log("No removable cleanup candidates. Re-run `wtm clean --force` to remove dirty merged worktrees.");
    }
    return;
  }

  console.log(performCleanupCandidate(context, selected));
}

export async function runCompletion(options: CliOptions): Promise<void> {
  const topic = options.args[0];
  const prefix = options.args[1] ?? "";

  try {
    switch (topic) {
      case "worktrees": {
        const context = resolveRepoContext(process.cwd());
        const entries = listWorktrees(context)
          .map((entry) => entry.branch)
          .filter((branch): branch is string => branch !== undefined)
          .filter((branch) => branch.startsWith(prefix));
        console.log(entries.join("\n"));
        break;
      }
      case "default-branch": {
        const context = resolveRepoContext(process.cwd());
        const branch = detectDefaultBranch(context.gitRoot);
        if (branch.startsWith(prefix)) {
          console.log(branch);
        }
        break;
      }
      case "agents": {
        const agents = loadAgents()
          .map((agent) => agent.name)
          .filter((name) => name.startsWith(prefix));
        console.log(agents.join("\n"));
        break;
      }
      default:
        break;
    }
  } catch {
    // Completion should fail silently when not inside a repo or when git metadata is unavailable.
  }
}
