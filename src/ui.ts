import { relative } from "node:path";
import type { AgentName, CleanupCandidate, RepoContext, WorktreeEntry } from "./types";

const ansi = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
};

function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY);
}

function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function colorize(text: string, color: string): string {
  if (!supportsColor()) {
    return text;
  }

  return `${color}${text}${ansi.reset}`;
}

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function pad(value: string, width: number): string {
  const length = visibleLength(value);
  if (length >= width) {
    return value;
  }

  return `${value}${" ".repeat(width - length)}`;
}

function truncate(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 1) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 1)}…`;
}

function displayState(entry: WorktreeEntry): { label: string; tone: string } {
  if (entry.prunable) {
    return { label: "STALE", tone: ansi.yellow };
  }

  if (entry.isDirty) {
    return { label: "DIRTY", tone: ansi.red };
  }

  if (entry.detached) {
    return { label: "DETACHED", tone: ansi.yellow };
  }

  return { label: "CLEAN", tone: ansi.green };
}

function formatState(entry: WorktreeEntry): string {
  const state = displayState(entry);
  return colorize(state.label, state.tone);
}

function formatBranch(entry: WorktreeEntry, width: number): string {
  const label = entry.branch ?? "(detached)";
  const value = truncate(label, width);
  return entry.isMain ? colorize(value, ansi.cyan) : value;
}

function formatPath(context: RepoContext, entry: WorktreeEntry, width: number): string {
  const relPath = relative(context.gitRoot, entry.path) || ".";
  return truncate(relPath, width);
}

function formatRole(entry: WorktreeEntry): string {
  if (entry.isMain) {
    return colorize("MAIN", ansi.cyan);
  }

  if (entry.locked) {
    return colorize("LOCKED", ansi.yellow);
  }

  return colorize("LINKED", ansi.gray);
}

function formatSync(entry: WorktreeEntry): string {
  if (entry.upstreamBranch === undefined) {
    return colorize("-", ansi.dim);
  }

  const ahead = entry.aheadCount ?? 0;
  const behind = entry.behindCount ?? 0;
  const value = `+${ahead}/-${behind}`;
  if (ahead === 0 && behind === 0) {
    return colorize(value, ansi.dim);
  }

  return value;
}

function formatCount(value: number): string {
  if (value === 0) {
    return colorize("0", ansi.dim);
  }

  return String(value);
}

function getCleanupReason(candidate: CleanupCandidate): string {
  if (candidate.reason === "prunable") {
    return "stale metadata";
  }

  return "merged into default";
}

function formatCleanupAction(candidate: CleanupCandidate): string {
  if (candidate.blockedReason === "dirty") {
    return colorize("BLOCKED", ansi.red);
  }

  if (candidate.requiresForce) {
    return colorize("FORCE", ansi.yellow);
  }

  if (candidate.action === "prune") {
    return colorize("PRUNE", ansi.yellow);
  }

  return colorize("REMOVE", ansi.green);
}

function getColumnWidths(context: RepoContext, entries: WorktreeEntry[]): {
  branch: number;
  path: number;
  role: number;
} {
  const branch = Math.max(
    "BRANCH".length,
    ...entries.map((entry) => (entry.branch ?? "(detached)").length),
  );
  const path = Math.max(
    "PATH".length,
    ...entries.map((entry) => (relative(context.gitRoot, entry.path) || ".").length),
  );

  return {
    branch: Math.min(branch, 32),
    path: Math.min(path, 56),
    role: "KIND".length,
  };
}

function getCleanupColumnWidths(context: RepoContext, candidates: CleanupCandidate[]): {
  branch: number;
  path: number;
  reason: number;
} {
  const branch = Math.max(
    "BRANCH".length,
    ...candidates.map((candidate) => (candidate.entry.branch ?? "(detached)").length),
  );
  const path = Math.max(
    "PATH".length,
    ...candidates.map((candidate) => (relative(context.gitRoot, candidate.entry.path) || ".").length),
  );
  const reason = Math.max(
    "REASON".length,
    ...candidates.map((candidate) => getCleanupReason(candidate).length),
  );

  return {
    branch: Math.min(branch, 32),
    path: Math.min(path, 56),
    reason: Math.min(reason, 24),
  };
}

function clearRenderedMenu(lines: number): void {
  if (lines <= 0 || !process.stdout.isTTY) {
    return;
  }

  for (let index = 0; index < lines; index += 1) {
    process.stdout.write("\r");
    process.stdout.write("\u001b[2K");
    if (index < lines - 1) {
      process.stdout.write("\u001b[1A");
    }
  }

  process.stdout.write("\r");
}

function renderMenu<T>(
  title: string,
  items: T[],
  renderItem: (item: T, index: number) => string,
  selectedIndex: number,
): number {
  const lines: string[] = [colorize(title, ansi.bold)];

  for (const [index, item] of items.entries()) {
    const isSelected = index === selectedIndex;
    const pointer = isSelected ? colorize("›", ansi.cyan) : " ";
    const content = renderItem(item, index);
    lines.push(` ${pointer} ${content}`);
  }

  lines.push(colorize("Use ↑/↓ to move, Enter to select, Esc to cancel.", ansi.dim));
  process.stdout.write(lines.join("\n"));
  return lines.length;
}

async function readMenuSelection<T>(
  title: string,
  items: T[],
  renderItem: (item: T, index: number) => string,
  defaultIndex: number,
): Promise<T | undefined> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return items[defaultIndex];
  }

  let selectedIndex = defaultIndex;
  let renderedLines = renderMenu(title, items, renderItem, selectedIndex);

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return await new Promise<T | undefined>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }

      settled = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      clearRenderedMenu(renderedLines);
    };

    const finish = (value: T | undefined) => {
      cleanup();
      resolve(value);
    };

    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };

    const rerender = () => {
      clearRenderedMenu(renderedLines);
      renderedLines = renderMenu(title, items, renderItem, selectedIndex);
    };

    const onData = (chunk: string) => {
      switch (chunk) {
        case "\u0003":
          fail(new Error("Selection cancelled."));
          return;
        case "\u001b":
          finish(undefined);
          return;
        case "\r":
        case "\n":
          finish(items[selectedIndex]);
          return;
        case "\u001b[A":
        case "k":
          selectedIndex = selectedIndex === 0 ? items.length - 1 : selectedIndex - 1;
          rerender();
          return;
        case "\u001b[B":
        case "j":
          selectedIndex = selectedIndex === items.length - 1 ? 0 : selectedIndex + 1;
          rerender();
          return;
        default:
          return;
      }
    };

    stdin.on("data", onData);
  });
}

export async function selectFromMenu<T>(
  title: string,
  items: T[],
  renderItem: (item: T, index: number) => string,
  defaultIndex = 0,
): Promise<T | undefined> {
  if (items.length === 0) {
    return undefined;
  }

  if (!isInteractive()) {
    return items[defaultIndex];
  }

  return readMenuSelection(title, items, renderItem, defaultIndex);
}

export function printWorktrees(context: RepoContext, entries: WorktreeEntry[]): void {
  if (entries.length === 0) {
    console.log(colorize("No worktrees found.", ansi.dim));
    return;
  }

  const widths = getColumnWidths(context, entries);
  const header = [
    pad("BRANCH", widths.branch),
    pad("PATH", widths.path),
    pad("STATE", 8),
    pad("KIND", widths.role),
    pad("SYNC", 9),
    pad("MOD", 3),
    pad("NEW", 3),
  ].join("  ");
  console.log(colorize(header, ansi.bold));
  console.log(colorize("-".repeat(header.length), ansi.dim));

  for (const entry of entries) {
    const row = [
      pad(formatBranch(entry, widths.branch), widths.branch),
      pad(formatPath(context, entry, widths.path), widths.path),
      pad(formatState(entry), 8),
      pad(formatRole(entry), widths.role),
      pad(formatSync(entry), 9),
      pad(formatCount(entry.modifiedCount), 3),
      pad(formatCount(entry.untrackedCount), 3),
    ].join("  ");
    console.log(row);
  }
}

export async function pickWorktree(
  context: RepoContext,
  entries: WorktreeEntry[],
  title: string,
): Promise<WorktreeEntry | undefined> {
  const widths = getColumnWidths(context, entries);
  return selectFromMenu(
    title,
    entries,
    (entry) => {
      return [
        pad(formatBranch(entry, widths.branch), widths.branch),
        pad(formatPath(context, entry, widths.path), widths.path),
        pad(formatState(entry), 8),
        pad(formatRole(entry), widths.role),
        pad(formatSync(entry), 9),
        pad(formatCount(entry.modifiedCount), 3),
        pad(formatCount(entry.untrackedCount), 3),
      ].join("  ");
    },
    0,
  );
}

export async function pickAgent(defaultAgent: AgentName = "codex"): Promise<AgentName | undefined> {
  const agents: AgentName[] = ["codex", "claude", "pi"];
  const defaultIndex = agents.indexOf(defaultAgent);
  return selectFromMenu(
    "Launch agent:",
    agents,
    (agent) => {
      if (agent === defaultAgent) {
        return `${colorize(agent, ansi.cyan)} ${colorize("(default)", ansi.dim)}`;
      }

      return agent;
    },
    defaultIndex === -1 ? 0 : defaultIndex,
  );
}

export function isInteractiveSession(): boolean {
  return isInteractive();
}

export function printCleanupCandidates(context: RepoContext, candidates: CleanupCandidate[]): void {
  if (candidates.length === 0) {
    console.log(colorize("No cleanup candidates found.", ansi.dim));
    return;
  }

  const widths = getCleanupColumnWidths(context, candidates);
  const header = [
    pad("BRANCH", widths.branch),
    pad("PATH", widths.path),
    pad("REASON", widths.reason),
    pad("ACTION", 7),
  ].join("  ");
  console.log(colorize(header, ansi.bold));
  console.log(colorize("-".repeat(header.length), ansi.dim));

  for (const candidate of candidates) {
    const row = [
      pad(formatBranch(candidate.entry, widths.branch), widths.branch),
      pad(formatPath(context, candidate.entry, widths.path), widths.path),
      pad(getCleanupReason(candidate), widths.reason),
      pad(formatCleanupAction(candidate), 7),
    ].join("  ");
    console.log(row);
  }
}

export async function pickCleanupCandidate(
  context: RepoContext,
  candidates: CleanupCandidate[],
): Promise<CleanupCandidate | undefined> {
  const actionableCandidates = candidates.filter((candidate) => candidate.action !== undefined && !candidate.blockedReason);
  if (actionableCandidates.length === 0) {
    return undefined;
  }

  const widths = getCleanupColumnWidths(context, actionableCandidates);
  return selectFromMenu(
    "Clean worktree:",
    actionableCandidates,
    (candidate) => {
      return [
        pad(formatBranch(candidate.entry, widths.branch), widths.branch),
        pad(formatPath(context, candidate.entry, widths.path), widths.path),
        pad(getCleanupReason(candidate), widths.reason),
        pad(formatCleanupAction(candidate), 7),
      ].join("  ");
    },
    0,
  );
}
