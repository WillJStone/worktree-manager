import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const completionFile = resolve(import.meta.dir, "../completions/_wtm.zsh");

function runZsh(script: string): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync({
    cmd: ["zsh", "-fc", script],
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    stdout: proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "",
    stderr: proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "",
    exitCode: proc.exitCode ?? -1,
  };
}

function captureArguments(words: string[], current: number): string[] {
  const wordsLiteral = words.map((word) => `'${word.replace(/'/g, `'\\''`)}'`).join(" ");
  const script = `
    compdef() { :; }
    add-zsh-hook() { :; }
    source "${completionFile}"
    _arguments() { printf '%s\\n' "$@"; }
    _describe() { :; }
    words=(${wordsLiteral})
    CURRENT=${current}
    _wtm
  `;

  const result = runZsh(script);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "Failed to evaluate zsh completion.");
  }
  return result.stdout.length > 0 ? result.stdout.split("\n") : [];
}

describe("zsh completions", () => {
  test("file parses with zsh -n", () => {
    const result = runZsh(`zsh -n "${completionFile}" && echo OK`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("OK");
  });

  test("sourcing registers _wtm function and binds compdef after compinit", () => {
    const script = `
      autoload -Uz compinit && compinit -u -d /tmp/zcd-wtm-test 2>/dev/null
      source "${completionFile}"
      (( $+functions[_wtm] )) && echo "fn:ok"
      [[ -n "\${_comps[wtm]:-}" ]] && echo "comp:ok"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("fn:ok");
    expect(result.stdout).toContain("comp:ok");
  });

  test("sourcing before compinit still binds once compinit loads", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      (( $+functions[_wtm] )) && echo "fn:ok"
      autoload -Uz compinit && compinit -u -d /tmp/zcd-wtm-test2 2>/dev/null
      (( $+functions[_wtm_deferred_compdef] )) && _wtm_deferred_compdef
      [[ -n "\${_comps[wtm]:-}" ]] && echo "comp:ok"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("fn:ok");
    expect(result.stdout).toContain("comp:ok");
  });

  test("new without --issue offers a branch slug positional", () => {
    const args = captureArguments(["wtm", "new"], 3);
    expect(args).toContain("1:branch slug:");
    expect(args).not.toContain("--workspace[target Linear workspace]:workspace slug:");
  });

  test("new without --issue advertises --yolo", () => {
    const args = captureArguments(["wtm", "new"], 3);
    expect(args).toContain("--yolo[launch the selected agent with its configured yolo args]");
  });

  test("new with --issue removes the positional branch slug and offers workspace", () => {
    const args = captureArguments(["wtm", "new", "--issue"], 4);
    expect(args).toContain("--workspace[target Linear workspace]:workspace slug:");
    expect(args).not.toContain("1:branch slug:");
  });

  test("new with --issue advertises --yolo", () => {
    const args = captureArguments(["wtm", "new", "--issue"], 4);
    expect(args).toContain("--yolo[launch the selected agent with its configured yolo args]");
  });

  test("open advertises --yolo and branches completer", () => {
    const args = captureArguments(["wtm", "open"], 3);
    expect(args).toContain("-A");
    expect(args).toContain("-*");
    expect(args).toContain("--yolo[launch the selected agent with its configured yolo args]");
    expect(args).toContain("1:worktree:->worktree");
  });

  test("rm wires up the worktree branches completer", () => {
    const args = captureArguments(["wtm", "rm"], 3);
    expect(args).toContain("-A");
    expect(args).toContain("-*");
    expect(args).toContain("1:worktree:->worktree");
    expect(args).toContain("--force[remove even if the worktree is dirty]");
  });

  test("list advertises --pick", () => {
    const args = captureArguments(["wtm", "list"], 3);
    expect(args).toContain("--pick[choose a worktree interactively]");
  });

  test("clean advertises --force", () => {
    const args = captureArguments(["wtm", "clean"], 3);
    expect(args).toContain("--force[remove dirty merged worktrees]");
  });

  test("prune and help do not error and emit no _arguments", () => {
    expect(captureArguments(["wtm", "prune"], 3)).toEqual([]);
    expect(captureArguments(["wtm", "help"], 3)).toEqual([]);
  });

  test("_wtm_worktree_branches handles empty output without calling compadd with empty string", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      # Stub wtm to return nothing
      wtm() { return 0; }
      PREFIX=""
      local -a compadd_calls
      compadd() { compadd_calls+=("$*"); }
      _wtm_worktree_branches
      echo "calls=\${#compadd_calls[@]}"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("calls=0");
  });

  test("_wtm_worktree_branches forwards non-empty output to compadd", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      wtm() { printf '%s\\n' "feature/alpha" "feature/beta"; }
      PREFIX=""
      local -a compadd_args
      compadd() {
        while (( $# )); do
          [[ "$1" == "--" ]] && { shift; continue; }
          compadd_args+=("$1")
          shift
        done
      }
      _wtm_worktree_branches
      printf '%s\\n' "\${compadd_args[@]}"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual([
      "-M",
      "r:|/=* r:|=*",
      "feature/alpha",
      "feature/beta",
    ]);
  });

  test("_wtm_open shifts out the subcommand before calling _arguments", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      _arguments() {
        echo "CURRENT=$CURRENT"
        printf '%s\\n' "\${words[@]}"
        return 0
      }
      words=(wtm open featu)
      CURRENT=3
      _wtm
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual(["CURRENT=2", "wtm", "featu"]);
  });

  test("_wtm_rm shifts out the subcommand before calling _arguments", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      _arguments() {
        echo "CURRENT=$CURRENT"
        printf '%s\\n' "\${words[@]}"
        return 0
      }
      words=(wtm rm featu)
      CURRENT=3
      _wtm
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual(["CURRENT=2", "wtm", "featu"]);
  });

  test("_wtm_open forwards the worktree state to _wtm_worktree_branches", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      wtm() { printf '%s\\n' "feature/alpha" "feature/beta"; }
      _arguments() { state=worktree; return 1; }
      PREFIX=""
      words=(wtm open '')
      CURRENT=3
      local -a compadd_args
      compadd() {
        while (( $# )); do
          [[ "$1" == "--" ]] && { shift; continue; }
          compadd_args+=("$1")
          shift
        done
      }
      _wtm
      printf '%s\\n' "\${compadd_args[@]}"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual([
      "-M",
      "r:|/=* r:|=*",
      "feature/alpha",
      "feature/beta",
    ]);
  });

  test("_wtm_rm forwards the worktree state to _wtm_worktree_branches", () => {
    const script = `
      source "${completionFile}" 2>/dev/null
      wtm() { printf '%s\\n' "feature/gamma"; }
      _arguments() { state=worktree; return 1; }
      PREFIX=""
      words=(wtm rm '')
      CURRENT=3
      local -a compadd_args
      compadd() {
        while (( $# )); do
          [[ "$1" == "--" ]] && { shift; continue; }
          compadd_args+=("$1")
          shift
        done
      }
      _wtm
      printf '%s\\n' "\${compadd_args[@]}"
    `;
    const result = runZsh(script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n")).toEqual([
      "-M",
      "r:|/=* r:|=*",
      "feature/gamma",
    ]);
  });
});
