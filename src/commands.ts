import { relative } from "node:path";
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
import { launchAgent } from "./launch";
import type { AgentName, WorktreeEntry } from "./types";
import {
  isInteractiveSession,
  pickAgent,
  pickCleanupCandidate,
  pickWorktree,
  printCleanupCandidates,
  printWorktrees,
} from "./ui";

export interface CliOptions {
  args: string[];
  flags: Map<string, string | boolean>;
}

function getAgentFromFlags(flags: Map<string, string | boolean>): AgentName | undefined {
  const value = flags.get("agent");
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === "codex" || value === "claude" || value === "pi") {
    return value;
  }

  throw new Error(`Unsupported agent '${value}'. Use codex, claude, or pi.`);
}

async function maybeLaunch(
  path: string,
  flags: Map<string, string | boolean>,
  defaultAgent: AgentName,
): Promise<void> {
  if (flags.get("no-agent") === true) {
    return;
  }

  const requested = getAgentFromFlags(flags);
  if (requested) {
    await launchAgent(requested, path);
    return;
  }

  if (!isInteractiveSession()) {
    return;
  }

  const selected = await pickAgent(defaultAgent);
  if (selected === undefined) {
    return;
  }
  await launchAgent(selected, path);
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

export async function runNew(options: CliOptions): Promise<void> {
  const branchSlug = options.args[0];
  if (!branchSlug) {
    throw new Error("Usage: wtm new <branch-slug>");
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

export async function runClean(): Promise<void> {
  const context = resolveRepoContext(process.cwd());
  const candidates = getCleanupCandidates(context);
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
      console.log("No removable cleanup candidates. Dirty merged worktrees must be removed manually with `wtm rm --force`.");
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
      default:
        break;
    }
  } catch {
    // Completion should fail silently when not inside a repo or when git metadata is unavailable.
  }
}
