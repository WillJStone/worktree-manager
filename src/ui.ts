import { relative } from "node:path";
import type { AgentName, RepoContext, WorktreeEntry } from "./types";

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

async function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  for await (const chunk of process.stdin) {
    return chunk.toString().trim();
  }

  return "";
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

  console.log(colorize(title, ansi.bold));
  for (const [index, item] of items.entries()) {
    const marker = index === defaultIndex ? colorize(">", ansi.cyan) : " ";
    const number = colorize(pad(`${index + 1}.`, 4), ansi.dim);
    console.log(` ${marker} ${number} ${renderItem(item, index)}`);
  }

  const answer = await readLine(colorize(`Select [${defaultIndex + 1}]: `, ansi.dim));
  if (answer.length === 0) {
    return items[defaultIndex];
  }

  const numericIndex = Number(answer);
  if (!Number.isInteger(numericIndex) || numericIndex < 1 || numericIndex > items.length) {
    throw new Error("Invalid selection.");
  }

  return items[numericIndex - 1];
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
  ].join("  ");
  console.log(colorize(header, ansi.bold));
  console.log(colorize("-".repeat(header.length), ansi.dim));

  for (const entry of entries) {
    const row = [
      pad(formatBranch(entry, widths.branch), widths.branch),
      pad(formatPath(context, entry, widths.path), widths.path),
      pad(formatState(entry), 8),
      pad(formatRole(entry), widths.role),
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
      ].join("  ");
    },
    0,
  );
}

export async function pickAgent(defaultAgent: AgentName = "codex"): Promise<AgentName> {
  const agents: AgentName[] = ["codex", "claude", "pi", "nothing"];
  const defaultIndex = agents.indexOf(defaultAgent);
  const selected = await selectFromMenu(
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

  return selected ?? defaultAgent;
}

export function isInteractiveSession(): boolean {
  return isInteractive();
}
