/**
 * Integration tests for branch-scoped commit message rewriting.
 *
 * These exercise the real CLI (`src/main.ts`) end to end: HEAD stays on
 * `main` (which has no Claude trailers) while an un-checked-out `feature`
 * branch carries a commit with Claude trailers. Running
 * `--commits-only --execute --branch feature` must:
 *   - rewrite only `feature`'s history (not `main`'s, and not whatever is
 *     checked out),
 *   - never switch the user's checked-out branch away from `main`,
 *   - preserve the *original* `feature` history (including its trailers) on
 *     the automatically created backup branch.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

/** Runs a git command in the given repo, throwing on failure. */
async function git(repoPath: string, args: string[]): Promise<string> {
  const result = await new Deno.Command("git", {
    args,
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

async function gitNoThrow(
  repoPath: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await new Deno.Command("git", {
    args,
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

async function writeFile(repoPath: string, rel: string, content: string): Promise<void> {
  const full = join(repoPath, rel);
  await ensureDir(join(full, ".."));
  await Deno.writeTextFile(full, content);
}

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const output = await new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

async function makeRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const parent = await Deno.makeTempDir({ prefix: "claude-cleaner-branch-scope-" });
  const repoPath = join(parent, "repo");
  await ensureDir(repoPath);
  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
  return {
    path: repoPath,
    cleanup: async () => {
      try {
        await Deno.remove(parent, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

/** Builds the standard main+feature fixture, leaving HEAD checked out on main. */
async function setupMainAndFeature(repoPath: string): Promise<{
  mainSha: string;
  featureSha: string;
}> {
  await writeFile(repoPath, "main.txt", "main content\n");
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, ["commit", "-m", "main commit, clean history"]);
  const mainSha = (await git(repoPath, ["rev-parse", "HEAD"])).trim();

  await git(repoPath, ["checkout", "-b", "feature"]);
  await writeFile(repoPath, "feature.txt", "feature content\n");
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, [
    "commit",
    "-m",
    "feature commit with trailer\n\n" +
    "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
    "Co-Authored-By: Claude <noreply@anthropic.com>",
  ]);
  const featureSha = (await git(repoPath, ["rev-parse", "HEAD"])).trim();

  // Return to main; feature is deliberately left un-checked-out.
  await git(repoPath, ["checkout", "main"]);

  return { mainSha, featureSha };
}

Deno.test("Integration - Branch-scoped commit rewriting", async (t) => {
  await t.step(
    "cleans only the un-checked-out feature branch, never switches HEAD, and preserves original history in the backup",
    async () => {
      const repo = await makeRepo();
      try {
        const { mainSha } = await setupMainAndFeature(repo.path);

        const checkedOutBefore = (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        assertEquals(checkedOutBefore, "main", "test setup should leave HEAD on main");

        const existingBranches = new Set(
          (await git(repo.path, ["branch", "--format=%(refname:short)"]))
            .trim()
            .split("\n")
            .filter(Boolean),
        );

        const result = await runCli([
          "--commits-only",
          "--execute",
          "--branch",
          "feature",
          repo.path,
        ]);
        assert(result.success, `CLI failed: ${result.stderr}\n${result.stdout}`);

        // HEAD must still be on main — the user's checkout was never switched.
        const checkedOutAfter = (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        assertEquals(
          checkedOutAfter,
          "main",
          "commit cleaning must not switch the checked-out branch",
        );

        // main's own commit is untouched (same sha, same message).
        const mainShaAfter = (await git(repo.path, ["rev-parse", "main"])).trim();
        assertEquals(mainShaAfter, mainSha, "main branch must not be rewritten");
        const mainMessage = await git(repo.path, ["log", "-1", "--format=%B", "main"]);
        assert(!mainMessage.includes("Claude"), "main never had Claude trailers");

        // feature's tip changed (rewritten) and no longer contains trailers.
        const featureMessage = await git(repo.path, ["log", "-1", "--format=%B", "feature"]);
        assert(
          !featureMessage.includes("Co-Authored-By: Claude") &&
            !featureMessage.includes("Generated with [Claude Code]"),
          `feature trailers should be removed, got: ${featureMessage}`,
        );
        assert(
          featureMessage.startsWith("feature commit with trailer"),
          "feature's non-trailer message content must be preserved",
        );

        // A single new backup branch was created, and it preserves the
        // *original* (pre-rewrite) feature history verbatim.
        const branchesAfter = (await git(repo.path, ["branch", "--format=%(refname:short)"]))
          .trim()
          .split("\n")
          .filter(Boolean);
        const newBranches = branchesAfter.filter((b) => !existingBranches.has(b));
        const backupBranches = newBranches.filter((b) => b.startsWith("backup/pre-claude-clean-"));
        assertEquals(
          backupBranches.length,
          1,
          `expected exactly one backup branch, got: ${newBranches.join(", ")}`,
        );
        const backupBranch = backupBranches[0]!;

        const backupSha = (await git(repo.path, ["rev-parse", backupBranch])).trim();
        const backupMessage = await git(repo.path, ["log", "-1", "--format=%B", backupBranch]);
        assert(
          backupMessage.includes("Co-Authored-By: Claude <noreply@anthropic.com>") &&
            backupMessage.includes("🤖 Generated with [Claude Code]"),
          `backup must preserve the original trailers, got: ${backupMessage}`,
        );
        assertNotEquals(
          backupSha,
          (await git(repo.path, ["rev-parse", "feature"])).trim(),
          "backup tip should differ from the rewritten feature tip",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "dry-run analyzes the requested branch without mutating history or switching HEAD",
    async () => {
      const repo = await makeRepo();
      try {
        const { mainSha, featureSha } = await setupMainAndFeature(repo.path);

        const result = await runCli(["--commits-only", "--branch", "feature", repo.path]);
        assert(result.success, `CLI failed: ${result.stderr}\n${result.stdout}`);
        assert(
          result.stdout.includes("Commits with Claude trailers: 1"),
          `dry-run should report the feature branch's trailer commit, got: ${result.stdout}`,
        );

        const checkedOutAfter = (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        assertEquals(checkedOutAfter, "main", "dry-run must not switch the checked-out branch");

        const mainShaAfter = (await git(repo.path, ["rev-parse", "main"])).trim();
        const featureShaAfter = (await git(repo.path, ["rev-parse", "feature"])).trim();
        assertEquals(mainShaAfter, mainSha, "dry-run must not modify main");
        assertEquals(featureShaAfter, featureSha, "dry-run must not modify feature");
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "fails fast with a clear error when the requested branch does not exist, without creating a backup",
    async () => {
      const repo = await makeRepo();
      try {
        await setupMainAndFeature(repo.path);

        const branchesBefore = (await git(repo.path, ["branch", "--format=%(refname:short)"]))
          .trim()
          .split("\n")
          .filter(Boolean);

        const result = await runCli([
          "--commits-only",
          "--execute",
          "--branch",
          "does-not-exist",
          repo.path,
        ]);
        assert(!result.success, "CLI should fail for a non-existent branch");
        assert(
          result.stderr.includes("does-not-exist") || result.stdout.includes("does-not-exist"),
          `error output should mention the missing branch, got stdout=${result.stdout} stderr=${result.stderr}`,
        );

        const branchesAfter = (await git(repo.path, ["branch", "--format=%(refname:short)"]))
          .trim()
          .split("\n")
          .filter(Boolean);
        assertEquals(
          branchesAfter,
          branchesBefore,
          "no backup branch should be created when branch resolution fails",
        );

        const checkedOutAfter = (await gitNoThrow(repo.path, ["symbolic-ref", "--short", "HEAD"]))
          .stdout.trim();
        assertEquals(checkedOutAfter, "main", "a failed resolution must not touch the checkout");
      } finally {
        await repo.cleanup();
      }
    },
  );
});
