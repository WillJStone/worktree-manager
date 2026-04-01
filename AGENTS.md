# AGENTS.md

## Project overview

`worktree-manager` is a Bun-based CLI for creating and managing Git worktrees from inside the current repo.

## Working rules

- Do not add runtime package dependencies.
- Keep the CLI dependency-free at runtime and rely on Bun plus Node built-ins only.
- Prefer small, local implementations over bringing in libraries for prompts, formatting, or terminal UI.
- Preserve the current command surface unless a change is explicitly requested.
- Keep shell completion behavior in sync with CLI flag and command changes.

## UX expectations

- Output should stay readable in plain terminals without requiring a full TUI framework.
- Interactive flows should degrade cleanly in non-interactive shells.
- `Esc` in interactive pickers should act as cancel/no-op.

## Verification

- Run `TMPDIR=/tmp bun test` after code changes.
- For CLI/help changes, also run `TMPDIR=/tmp bun run src/cli.ts help`.
