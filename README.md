# worktree-manager

A Bun CLI for creating and managing Git worktrees inside the current repository.

## Commands

```bash
bun run src/cli.ts new <branch-slug>
bun run src/cli.ts list
bun run src/cli.ts open [branch-slug]
bun run src/cli.ts rm [branch-slug]
bun run src/cli.ts prune
```

## Behavior

- Detects the Git repo from the current working directory
- Creates worktrees in `.claude/worktrees`
- Bases new branches on the repo's detected default branch
- Lets you launch `codex`, `claude`, `pi`, or nothing after `new` and `open`
