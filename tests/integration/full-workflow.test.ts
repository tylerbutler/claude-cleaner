/**
 * End-to-end integration tests for the complete Claude Cleaner workflow,
 * driven through the real CLI (`src/main.ts`).
 *
 * These deliberately cover the gaps not already proven by the focused Task 1-5
 * integration suites (which own same-basename preservation, branch scoping,
 * message filtering, mode coordination, and preflight-failure non-mutation):
 *
 *  - **Full-mode dry-run** surfaces BOTH the file-removal and commit-cleaning
 *    executable plans while mutating nothing.
 *  - **Full-mode execute** creates a bare-clone file backup AND a commit
 *    backup branch, each of which retains the original (pre-rewrite) history —
 *    i.e. a usable recovery point — while the live repo has both the Claude
 *    files and the commit trailers removed.
 *  - **No temporary artifacts leak**: the internal manifest temp dir is
 *    cleaned up after a successful rewrite (guarding the `finally` cleanup for
 *    both the success and failure paths).
 *  - An **already-clean repository** completes gracefully without rewriting
 *    history.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  createIsolatedRepo,
  entriesWithPrefix,
  gitCmd,
  type IsolatedRepo,
  runCli,
} from "../utils/test-helpers.ts";

const CANONICAL_TRAILER = "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
  "Co-Authored-By: Claude <noreply@anthropic.com>";

/** Commits a repo containing a `.claude` artifact and a commit trailer. */
async function setupFullFixture(repoPath: string): Promise<void> {
  await Deno.writeTextFile(join(repoPath, "README.md"), "# project\n");
  await Deno.mkdir(join(repoPath, ".claude"));
  await Deno.writeTextFile(join(repoPath, ".claude", "settings.json"), "{}\n");
  await gitCmd(repoPath, ["add", "-A"]);
  await gitCmd(repoPath, ["commit", "-m", `add files\n\n${CANONICAL_TRAILER}`]);
}

async function historyHasClaudeFile(repoPath: string): Promise<boolean> {
  const out = await gitCmd(repoPath, ["log", "--all", "--pretty=format:", "--name-only"]);
  return out.split("\n").some((p) => p.trim().startsWith(".claude"));
}

async function fileBackupDirs(repo: IsolatedRepo): Promise<string[]> {
  return await entriesWithPrefix(repo.parent, "claude-cleaner-backup-");
}

async function commitBackupBranches(repoPath: string): Promise<string[]> {
  const out = await gitCmd(repoPath, ["branch", "--format=%(refname:short)"]);
  return out.split("\n").map((b) => b.trim()).filter((b) =>
    b.startsWith("backup/pre-claude-clean-")
  );
}

Deno.test("Integration - full-mode dry-run shows both plans and mutates nothing", async (t) => {
  await t.step(
    "surfaces the file and commit executable plans without touching history",
    async () => {
      const repo = await createIsolatedRepo("full-dry");
      try {
        await setupFullFixture(repo.path);
        const headBefore = (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim();

        const result = await runCli([repo.path]); // full mode, dry-run default
        assert(result.success, `dry-run failed: ${result.stderr}`);

        // File-removal plan.
        assert(
          result.stdout.includes("Exact paths that would be rewritten"),
          "file plan lists exact paths",
        );
        assert(
          result.stdout.includes("git filter-branch -f --index-filter"),
          "file plan shows the index-filter command",
        );
        // Commit-cleaning plan.
        assert(
          result.stdout.includes("Commits with Claude trailers: 1"),
          `commit plan reports the trailer commit, got: ${result.stdout}`,
        );
        assert(
          result.stdout.includes("__internal-filter") && result.stdout.includes("msg-filter"),
          "commit plan shows the self-invocation msg-filter command",
        );

        // Nothing mutated: HEAD, artifact, trailer, and refs are all intact.
        assertEquals(
          (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim(),
          headBefore,
          "dry-run must not rewrite history",
        );
        assert(await historyHasClaudeFile(repo.path), "artifact remains in history");
        assert(
          (await gitCmd(repo.path, ["log", "-1", "--format=%B"])).includes(
            "Co-Authored-By: Claude <noreply@anthropic.com>",
          ),
          "trailer remains in the message",
        );
        assertEquals(
          (await fileBackupDirs(repo)).length,
          0,
          "dry-run must not create a file backup",
        );
        assertEquals(
          (await commitBackupBranches(repo.path)).length,
          0,
          "dry-run must not create a commit backup branch",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Integration - full-mode execute cleans and leaves recoverable backups", async (t) => {
  await t.step(
    "removes files and trailers while both backups retain the original history",
    async () => {
      const repo = await createIsolatedRepo("full-exec");
      try {
        await setupFullFixture(repo.path);

        const result = await runCli(["--execute", repo.path]);
        assert(result.success, `execute failed: ${result.stderr}`);

        // Live repo: Claude files and trailers are gone; the non-trailer
        // subject survives.
        assert(
          !(await historyHasClaudeFile(repo.path)),
          "the .claude artifact must be removed from history",
        );
        const liveMessage = await gitCmd(repo.path, ["log", "-1", "--format=%B"]);
        assert(
          !liveMessage.includes("Co-Authored-By: Claude") &&
            !liveMessage.includes("Generated with [Claude Code]"),
          `trailers must be removed, got: ${liveMessage}`,
        );
        assert(liveMessage.startsWith("add files"), "the real subject is preserved");

        // Recovery point 1: the bare-clone file backup still contains the
        // original .claude artifact AND the original trailer.
        const fileBackups = await fileBackupDirs(repo);
        assertEquals(
          fileBackups.length,
          1,
          `one file backup expected, got: ${fileBackups.join(", ")}`,
        );
        const backupPath = join(repo.parent, fileBackups[0]!);
        // The backup is a bare repo; query it via an explicit --git-dir so it
        // works under safe.bareRepository=explicit (from any cwd).
        const backupPaths = await gitCmd(repo.parent, [
          "--git-dir",
          backupPath,
          "log",
          "--all",
          "--pretty=format:",
          "--name-only",
        ]);
        assert(
          backupPaths.split("\n").some((p) => p.trim() === ".claude/settings.json"),
          "the file backup retains the original .claude artifact",
        );
        const backupMessages = await gitCmd(repo.parent, [
          "--git-dir",
          backupPath,
          "log",
          "--all",
          "--format=%B",
        ]);
        assert(
          backupMessages.includes("Co-Authored-By: Claude <noreply@anthropic.com>"),
          "the file backup retains the original trailers",
        );

        // Recovery point 2: the commit backup branch retains the original
        // trailers on the live repo.
        const commitBackups = await commitBackupBranches(repo.path);
        assertEquals(
          commitBackups.length,
          1,
          `one commit backup branch expected, got: ${commitBackups.join(", ")}`,
        );
        const commitBackupMessage = await gitCmd(repo.path, [
          "log",
          "-1",
          "--format=%B",
          commitBackups[0]!,
        ]);
        assert(
          commitBackupMessage.includes("Co-Authored-By: Claude <noreply@anthropic.com>"),
          "the commit backup branch retains the original trailers",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "does not leak the internal manifest temp dir after a successful rewrite",
    async () => {
      const repo = await createIsolatedRepo("full-noleak");
      try {
        await setupFullFixture(repo.path);

        // Isolate the CLI subprocess's temp root so the tool's manifest temp
        // dir (Deno.makeTempDir prefix "claude-cleaner-") lands here and can
        // be checked for leaks. The bare-clone backup is a sibling of the
        // repo, not under TMPDIR, so it never pollutes this directory.
        const tmphome = join(repo.parent, "tmphome");
        await Deno.mkdir(tmphome);

        const result = await runCli(["--files-only", "--execute", repo.path], {
          env: { TMPDIR: tmphome },
        });
        assert(result.success, `execute failed: ${result.stderr}`);
        assert(
          !(await historyHasClaudeFile(repo.path)),
          "sanity: the artifact was actually removed (so the manifest path ran)",
        );

        const leaked = await entriesWithPrefix(tmphome, "claude-cleaner-");
        assertEquals(
          leaked,
          [],
          `no claude-cleaner manifest temp dir should remain, found: ${leaked.join(", ")}`,
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Integration - already-clean repository is handled gracefully", async (t) => {
  await t.step("full-mode execute succeeds without rewriting history", async () => {
    const repo = await createIsolatedRepo("full-clean");
    try {
      await Deno.writeTextFile(join(repo.path, "README.md"), "# clean\n");
      await gitCmd(repo.path, ["add", "-A"]);
      await gitCmd(repo.path, ["commit", "-m", "clean initial commit"]);
      const headBefore = (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim();

      const result = await runCli(["--execute", repo.path]);
      assert(result.success, `clean-repo execute failed: ${result.stderr}`);
      assert(
        result.stdout.includes("No Claude files found") ||
          result.stdout.includes("No Claude files found in repository"),
        `expected a no-files message, got: ${result.stdout}`,
      );

      assertEquals(
        (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim(),
        headBefore,
        "a clean repo's history must be left untouched",
      );
      assertEquals(
        (await fileBackupDirs(repo)).length,
        0,
        "no file backup is created when there are no files to remove",
      );
    } finally {
      await repo.cleanup();
    }
  });
});
