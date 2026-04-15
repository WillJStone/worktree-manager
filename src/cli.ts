#!/usr/bin/env bun

import {
  runCompletion,
  runClean,
  runList,
  runNew,
  runOpen,
  runPrune,
  runRemove,
  type CliOptions,
} from "./commands";

function printHelp(): void {
  console.log(`wtm - worktree manager

Usage:
  wtm new <branch-slug> [--agent <codex|claude|pi>] [--no-agent]
  wtm new --issue [issue-id] [--workspace <slug>] [--agent <codex|claude|pi>] [--no-agent]
  wtm list [--pick]
  wtm open [branch-slug] [--agent <codex|claude|pi>] [--no-agent]
  wtm rm [branch-slug] [--force]
  wtm clean [--force]
  wtm prune
  wtm completion <worktrees|default-branch> [prefix]
`);
}

function parseArgs(argv: string[]): { command?: string; options: CliOptions } {
  const [command, ...rest] = argv;
  const args: string[] = [];
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) {
        flags.set(key, next);
        index += 1;
      } else {
        flags.set(key, true);
      }
    } else {
      args.push(token);
    }
  }

  return { command, options: { args, flags } };
}

async function main(): Promise<void> {
  const { command, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case "new":
        await runNew(options);
        break;
      case "list":
        await runList(options);
        break;
      case "open":
        await runOpen(options);
        break;
      case "rm":
        await runRemove(options);
        break;
      case "clean":
        await runClean(options);
        break;
      case "prune":
        await runPrune();
        break;
      case "completion":
        await runCompletion(options);
        break;
      case "help":
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;
      default:
        throw new Error(`Unknown command '${command}'. Run 'wtm help' for usage.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

await main();
