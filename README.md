# worktree-manager

`worktree-manager` is a Bun CLI for creating and managing Git worktrees from inside the repo you are currently in.

It is intentionally dependency-free at runtime. The CLI uses Bun plus Node built-ins only.

It detects the current Git root automatically, creates worktrees in `.claude/worktrees`, and provides a small command set for the common lifecycle:
- create a worktree from the repo default branch
- list worktrees in readable columns
- open an existing worktree
- remove a worktree safely
- prune stale worktree metadata

## Prerequisites

- `git`
- `bun`
- optional: `codex`, `claude`, or `pi` on your `PATH` if you want launcher support after `new` and `open`

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/WillJStone/worktree-manager.git
cd worktree-manager
```

### 2. Link the CLI globally

This makes `wtm` available from anywhere.

```bash
bun link
```

Confirm it works:

```bash
wtm help
```

### 3. Optional: enable `zsh` completion

This enables branch-name completion for commands like `wtm open <TAB>` and `wtm rm <TAB>`.

Add this to your `~/.zshrc`:

```zsh
source /path/to/worktree-manager/completions/_wtm.zsh
```

If the repo lives at `~/Repositories/worktree-manager`, the line would be:

```zsh
source ~/Repositories/worktree-manager/completions/_wtm.zsh
```

Reload your shell:

```bash
source ~/.zshrc
```

## Usage

Run `wtm` from anywhere inside a Git repo.

### Create a worktree

```bash
wtm new feature/my-branch
```

This will:
- detect the repo root
- detect the repo default branch
- create a new branch from that default branch
- create a worktree at `.claude/worktrees/feature--my-branch`
- offer to launch `codex`, `claude`, or `pi`

### List worktrees

```bash
wtm list
```

`list` shows branch, path, state, worktree kind, upstream sync, modified count, and untracked count.

### Open a worktree

```bash
wtm open feature/my-branch
```

You can also use shell completion:

```bash
wtm open <TAB>
```

### Remove a worktree

```bash
wtm rm feature/my-branch
```

By default, removal is safe:
- it refuses to remove the main worktree
- it refuses to remove a dirty worktree unless `--force` is used

### Prune stale metadata

```bash
wtm prune
```

### Review cleanup candidates

```bash
wtm clean
```

`clean` shows merged and stale cleanup candidates, including branches whose changes were already integrated into the default branch via equivalent commits, lets you choose one actionable candidate interactively, removes only the worktree, and then runs prune.

Use `wtm clean --force` to also remove merged worktrees that still have local modifications.

## Command reference

```bash
wtm new <branch-slug> [--agent <codex|claude|pi>] [--no-agent]
wtm list [--pick]
wtm open [branch-slug] [--agent <codex|claude|pi>] [--no-agent]
wtm rm [branch-slug] [--force]
wtm clean [--force]
wtm prune
```

## Notes

- Worktrees are repo-local and live under `.claude/worktrees`
- Branch slugs with `/` are mapped to directory names using `--`
- `Esc` cancels the interactive launcher picker without launching anything
