# worktree-manager

`worktree-manager` is a Bun CLI for creating and managing Git worktrees from inside the repo you are currently in.

It is intentionally dependency-free at runtime. The CLI uses Bun plus Node built-ins only.

It detects the current Git root automatically, creates worktrees in `.claude/worktrees` by default, and provides a small command set for the common lifecycle:
- create a worktree from the repo default branch
- create a worktree from a Linear issue with an auto-generated branch name
- list worktrees in readable columns
- open an existing worktree
- remove a worktree safely
- prune stale worktree metadata

## Prerequisites

- `git`
- `bun`
- optional: `codex`, `claude`, or `pi` on your `PATH` if you want launcher support after `new` and `open`
- optional: `linear` on your `PATH` if you want to create worktrees from Linear issues

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

## Configuration

The optional user configuration file is `~/.config/wtm/config.json`. A relative
`worktreeRoot` is resolved from each repository's Git root; an absolute path is used
as-is. If `worktreeRoot` is omitted, worktrees continue to use `.claude/worktrees`.

```json
{
  "worktreeRoot": ".wtm/worktrees",
  "agents": [
    {
      "name": "pi",
      "label": "Pi",
      "command": "pi",
      "args": [],
      "yoloArgs": []
    }
  ]
}
```

The `agents` array is optional. Set `WTM_CONFIG` to use a different configuration
file.

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
- create a worktree under the configured root, `.claude/worktrees/feature--my-branch` by default
- offer to launch `codex`, `claude`, or `pi`

### Create a worktree from a Linear issue

```bash
wtm new --issue
```

In an interactive shell this opens a picker of open Linear issues in the workspace, generates a branch name like `feature/bou-123-add-picker-support`, creates the worktree, and then offers to launch an agent.

You can also skip the picker and create directly from an issue key:

```bash
wtm new --issue BOU-123
```

If you need to target a non-default Linear workspace:

```bash
wtm new --issue BOU-123 --workspace boundlessdiscovery
```

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
wtm new <branch-slug> [--agent <codex|claude|pi>] [--no-agent] [--yolo]
wtm new --issue [issue-id] [--workspace <slug>] [--agent <codex|claude|pi>] [--no-agent] [--yolo]
wtm list [--pick]
wtm open [branch-slug] [--agent <codex|claude|pi>] [--no-agent] [--yolo]
wtm rm [branch-slug] [--force]
wtm clean [--force]
wtm prune
```

Pass `--yolo` to `new` or `open` to launch Codex with `--full-auto` or Claude with `--dangerously-skip-permissions`. This is intended for disposable worktree sandboxes; only use it in repos where an unattended agent is acceptable. The flag is a no-op for `pi`.

## Notes

- Worktrees are repo-local and live under `.claude/worktrees` by default; use `worktreeRoot` to change the location
- Branch slugs with `/` are mapped to directory names using `--`
- `Esc` cancels the interactive launcher picker without launching anything
