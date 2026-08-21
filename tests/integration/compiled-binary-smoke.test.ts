/**
 * Compiled-binary smoke test for commit cleaning.
 *
 * Exercises the *compiled* `deno compile` binary (not `deno run src/main.ts`)
 * end-to-end: `--commits-only --execute` against a real temporary Git repo
 * containing a canonical Claude trailer. This is the single reusable check
 * the release workflow points at for the Linux binary it builds, instead of
 * duplicating fragile inline Bash assertions in `release.yml`.
 *
 * It also proves the child `git filter-branch --msg-filter` self-invocation
 * never shells out to `deno`: a failing `deno` shim is placed first on PATH
 * (shadowing any real `deno`) while every other required command (`git`,
 * `sh`, ...) stays resolvable via the inherited PATH. Standalone compiled
 * binaries embed the Deno runtime and re-invoke themselves directly (see
 * `resolveSelfInvocation` in `src/internal-filter.ts`), so cleaning must
 * still succeed even though `deno` on PATH is broken.
 *
 * Activation: set `CLAUDE_CLEANER_BINARY` to an absolute path to a compiled
 * Linux binary before running `deno test --allow-all` on this file. Without
 * it (e.g. the normal `deno task test` run in CI, which never compiles a
 * binary), the test is skipped rather than failing. It is also skipped on
 * any non-Linux host: this test is specifically for the compiled Linux
 * binary, and foreign-platform binaries must never be executed on Linux (or
 * vice versa).
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { createIsolatedRepo, gitCmd } from "../utils/test-helpers.ts";

const BINARY_PATH_ENV = "CLAUDE_CLEANER_BINARY";
const binaryPath = Deno.env.get(BINARY_PATH_ENV);
const isLinuxHost = Deno.build.os === "linux";

const CANONICAL_TRAILER = "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
  "Co-Authored-By: Claude <noreply@anthropic.com>";

/**
 * Writes a failing `deno` shim into its own directory and returns that
 * directory so it can be prepended to PATH. Any invocation of `deno` while
 * this directory is first on PATH fails loudly (and prints a distinctive
 * marker), which is how this test proves the compiled binary never needed
 * it.
 */
async function createFailingDenoShim(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "claude-cleaner-fake-deno-" });
  const shimPath = join(dir, "deno");
  await Deno.writeTextFile(
    shimPath,
    "#!/bin/sh\n" +
      'echo "deno shim: compiled binary must never invoke deno" >&2\n' +
      "exit 1\n",
  );
  await Deno.chmod(shimPath, 0o755);
  return {
    dir,
    cleanup: async () => {
      try {
        await Deno.remove(dir, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

Deno.test({
  name: "Compiled binary smoke test - commit cleaning without deno on PATH",
  ignore: !isLinuxHost || !binaryPath,
  fn: async (t) => {
    const binary = binaryPath ?? "";
    assert(await exists(binary), `compiled binary not found at ${binary}`);

    const shim = await createFailingDenoShim();
    try {
      await t.step(
        "the deno shim itself fails when invoked directly (sanity check)",
        async () => {
          const shimResult = await new Deno.Command(join(shim.dir, "deno"), {
            stdout: "piped",
            stderr: "piped",
          }).output();
          assertEquals(shimResult.code, 1, "the fake deno shim must exit non-zero when invoked");
        },
      );

      await t.step(
        "compiled binary cleans a Claude trailer, creates a backup, and never invokes deno",
        async () => {
          const repo = await createIsolatedRepo("compiled-binary-smoke");
          try {
            await Deno.writeTextFile(join(repo.path, "feature.txt"), "feature content\n");
            await gitCmd(repo.path, ["add", "-A"]);
            await gitCmd(repo.path, [
              "commit",
              "-m",
              `Add feature\n\n${CANONICAL_TRAILER}`,
            ]);

            const originalHeadSha = (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim();
            const branchBefore = (await gitCmd(repo.path, ["symbolic-ref", "--short", "HEAD"]))
              .trim();
            const branchesBefore = new Set(
              (await gitCmd(repo.path, ["branch", "--format=%(refname:short)"]))
                .trim().split("\n").filter(Boolean),
            );

            const inheritedPath = Deno.env.get("PATH") ?? "";
            const poisonedPath = [shim.dir, inheritedPath].join(":");

            const output = await new Deno.Command(binary, {
              args: ["--commits-only", "--execute", repo.path],
              env: { ...Deno.env.toObject(), PATH: poisonedPath },
              stdout: "piped",
              stderr: "piped",
            }).output();

            const stdout = new TextDecoder().decode(output.stdout);
            const stderr = new TextDecoder().decode(output.stderr);

            assert(
              output.success,
              `compiled binary --commits-only --execute failed (a broken deno shim on ` +
                `PATH may have been invoked):\nstdout:\n${stdout}\nstderr:\n${stderr}`,
            );
            assert(
              !stderr.includes("deno shim") && !stdout.includes("deno shim"),
              `compiled binary must never invoke deno; shim output leaked:\n` +
                `stdout:\n${stdout}\nstderr:\n${stderr}`,
            );
            assert(
              stdout.includes("Backup created:"),
              `expected a backup-creation message, got:\n${stdout}`,
            );
            assert(
              stdout.includes("Commit cleaning completed successfully"),
              `expected a completion message, got:\n${stdout}`,
            );

            // Exact cleaned message content: the canonical trailer (both
            // lines) must be gone and only the original subject remains.
            const cleanedMessage = (
              await gitCmd(repo.path, ["log", "-1", "--format=%B"])
            ).trim();
            assertEquals(
              cleanedMessage,
              "Add feature",
              `cleaned commit message must be exactly "Add feature", got: ${
                JSON.stringify(cleanedMessage)
              }`,
            );

            // Backup behavior: checkout unchanged, exactly one backup branch,
            // pointing at the original (un-rewritten) commit.
            const branchAfter = (await gitCmd(repo.path, ["symbolic-ref", "--short", "HEAD"]))
              .trim();
            assertEquals(branchAfter, branchBefore, "checkout must not change");

            const newBranches = (
              await gitCmd(repo.path, ["branch", "--format=%(refname:short)"])
            ).trim().split("\n").filter(Boolean).filter((b) => !branchesBefore.has(b));
            const backups = newBranches.filter((b) => b.startsWith("backup/pre-claude-clean-"));
            assertEquals(
              backups.length,
              1,
              `expected exactly one backup branch, got: ${newBranches.join(", ")}`,
            );

            const backupBranch = backups[0] ?? "";
            const backupSha = (await gitCmd(repo.path, ["rev-parse", backupBranch])).trim();
            assertEquals(
              backupSha,
              originalHeadSha,
              "backup branch must point at the original, un-rewritten commit",
            );

            const backupMessage = await gitCmd(
              repo.path,
              ["log", "-1", "--format=%B", backupBranch],
            );
            assert(
              backupMessage.includes("Co-Authored-By: Claude <noreply@anthropic.com>"),
              `backup must preserve the original Claude trailer, got:\n${backupMessage}`,
            );

            const rewrittenSha = (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim();
            assertNotEquals(
              rewrittenSha,
              originalHeadSha,
              "HEAD must point at a rewritten commit, distinct from the backup",
            );
          } finally {
            await repo.cleanup();
          }
        },
      );
    } finally {
      await shim.cleanup();
    }
  },
});
