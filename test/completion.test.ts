import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const completionFile = resolve(import.meta.dir, "../completions/_wtm.zsh");

function captureArguments(words: string[], current: number): string[] {
  const wordsLiteral = words.map((word) => `'${word.replace(/'/g, `'\\''`)}'`).join(" ");
  const script = `
    compdef() { :; }
    source "${completionFile}"
    _arguments() { printf '%s\\n' "$@"; }
    _describe() { :; }
    words=(${wordsLiteral})
    CURRENT=${current}
    _wtm
  `;

  const proc = Bun.spawnSync({
    cmd: ["zsh", "-fc", script],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr).trim() : "";
    throw new Error(stderr || "Failed to evaluate zsh completion.");
  }

  const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout).trim() : "";
  return stdout.length > 0 ? stdout.split("\n") : [];
}

describe("zsh completions", () => {
  test("new without --issue still offers a branch slug positional", () => {
    const args = captureArguments(["wtm", "new"], 3);

    expect(args).toContain("1:branch slug:");
    expect(args).not.toContain("--workspace[target Linear workspace]:workspace slug:");
  });

  test("new with --issue removes the positional branch slug and offers workspace", () => {
    const args = captureArguments(["wtm", "new", "--issue"], 4);

    expect(args).toContain("--workspace[target Linear workspace]:workspace slug:");
    expect(args).not.toContain("1:branch slug:");
  });
});
