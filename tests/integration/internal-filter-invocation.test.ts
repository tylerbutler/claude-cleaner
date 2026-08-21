/**
 * Integration tests proving the internal self-invocation filter entry point
 * works end-to-end through the real `src/main.ts` CLI process (the actual
 * seam `git filter-branch` will invoke), not just through direct unit-level
 * calls into src/internal-filter.ts.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { addClaudeArtifacts, createTestRepo } from "../utils/test-helpers.ts";

// Resolve an absolute path to src/main.ts so this test can spawn the CLI
// with an independent `cwd` (mirroring how `resolveSelfInvocation` always
// passes an absolute script path rather than one relative to the caller's
// working directory).
const MAIN_TS_PATH = fromFileUrl(new URL("../../src/main.ts", import.meta.url));

/** `git rm --cached` only untracks a path from the index; it deliberately
 * leaves the working tree file in place (matching `git filter-branch
 * --index-filter` semantics). Assertions must therefore check the tracked
 * file list, not the working tree. */
async function getTrackedFiles(repoPath: string): Promise<string[]> {
  const cmd = new Deno.Command("git", { args: ["ls-files"], cwd: repoPath, stdout: "piped" });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean);
}

async function runMain(
  args: string[],
  options: { stdin?: string; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const commandOptions: Deno.CommandOptions = {
    args: ["run", "--allow-all", MAIN_TS_PATH, ...args],
    stdin: options.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
  };
  if (options.cwd !== undefined) {
    commandOptions.cwd = options.cwd;
  }
  const cmd = new Deno.Command("deno", commandOptions);

  const child = cmd.spawn();

  if (options.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(options.stdin));
    await writer.close();
  }

  const output = await child.output();

  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

Deno.test("Internal filter self-invocation - deno run entry point", async (t) => {
  await t.step(
    "__internal-filter msg-filter reads stdin and writes the cleaned message to stdout",
    async () => {
      const input = "Fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
      const result = await runMain(["__internal-filter", "msg-filter"], {
        stdin: input,
      });

      assert(result.success, `stderr: ${result.stderr}`);
      // The msg-filter now delegates to the shared parser, which strips the
      // terminal Claude co-author trailer and preserves the subject.
      assertEquals(result.stdout, "Fix bug\n");
    },
  );

  await t.step(
    "__internal-filter index-filter removes exact paths from the Git index",
    async () => {
      const repo = await createTestRepo("internal-filter-index");
      try {
        await addClaudeArtifacts(repo.path, [
          { type: "file", path: "CLAUDE.md", content: "claude instructions" },
          { type: "file", path: "keep-me.txt", content: "keep" },
        ]);
        await new Deno.Command("git", { args: ["add", "."], cwd: repo.path }).output();
        await new Deno.Command("git", {
          args: ["commit", "-m", "add files"],
          cwd: repo.path,
        }).output();

        const manifestPath = join(repo.path, "manifest");
        await Deno.writeTextFile(manifestPath, "CLAUDE.md");

        const result = await runMain(
          ["__internal-filter", "index-filter", manifestPath],
          { cwd: repo.path },
        );

        assert(result.success, `stderr: ${result.stderr}`);

        const files = await getTrackedFiles(repo.path);
        assert(!files.includes("CLAUDE.md"));
        assert(files.includes("keep-me.txt"));
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step("an unrecognized internal mode fails with a non-zero exit code", async () => {
    const result = await runMain(["__internal-filter", "bogus-mode"]);
    assert(!result.success);
  });

  await t.step("the internal marker is never listed in --help output", async () => {
    const result = await runMain(["--help"]);
    assert(result.success, `stderr: ${result.stderr}`);
    assert(!result.stdout.includes("__internal-filter"));
    assert(!result.stdout.toLowerCase().includes("internal filter"));
  });
});
