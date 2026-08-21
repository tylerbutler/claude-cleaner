/**
 * Unit tests for the commit cleaner.
 *
 * These exercise `CommitCleaner` against real Git repositories through its
 * public, in-process seams: `resolveBranch()`, `planCleaning()`, and
 * dry-run `cleanCommits()`. Together these drive the real analysis pipeline
 * (`git rev-list` -> `git log -1 --format=%B` -> the shared attribution
 * parser), proving the cleaner reports precise per-commit counts and previews
 * and never mutates history in dry-run mode.
 *
 * The exact line-level parser semantics (false-positive prose, Unicode,
 * overlapping patterns, spacing, non-Claude trailers, attribution-only
 * fallback) are unit-tested directly in
 * `tests/unit/commit-message-filter.test.ts`; execute-mode rewriting is
 * covered end-to-end through the real CLI in
 * `tests/integration/commit-message-filtering.test.ts` and
 * `tests/integration/commit-branch-scoping.test.ts` (the internal
 * `--msg-filter` self-invocation resolves `src/main.ts`, not the test module,
 * so execute mode cannot be driven in-process here).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CommitCleaner } from "../../src/commit-cleaner.ts";
import { AppError, type Logger } from "../../src/utils.ts";
import { createIsolatedRepo, gitCmd } from "../utils/test-helpers.ts";

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  verbose() {},
  debug() {},
};

const CANONICAL_TRAILER = "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
  "Co-Authored-By: Claude <noreply@anthropic.com>";

async function commit(repoPath: string, message: string): Promise<string> {
  await gitCmd(repoPath, ["commit", "--allow-empty", "-m", message]);
  return (await gitCmd(repoPath, ["rev-parse", "HEAD"])).trim();
}

Deno.test("Commit Cleaner - analysis via dry-run reports precise counts and previews", async (t) => {
  await t.step(
    "counts commits and per-line trailers exactly, preserving prose and non-Claude trailers",
    async () => {
      const repo = await createIsolatedRepo("analysis");
      try {
        // A: canonical two-line attribution. B: one Claude co-author amid
        // prose + a non-Claude trailer. C: entirely clean.
        await commit(repo.path, `Add feature\n\n${CANONICAL_TRAILER}`);
        await commit(
          repo.path,
          "Fix bug\n\n" +
            "Mentions Claude 🤖 in prose and must survive.\n\n" +
            "Signed-off-by: Human <human@example.com>\n" +
            "Co-Authored-By: Claude <noreply@anthropic.com>",
        );
        await commit(repo.path, "Clean commit\n\nNo attribution here.");

        const cleaner = new CommitCleaner(silentLogger, repo.path);
        const result = await cleaner.cleanCommits({ dryRun: true });

        assertEquals(result.totalCommits, 3, "all three commits analyzed");
        assertEquals(
          result.commitsWithClaudeTrailers,
          2,
          "only the two attributed commits are counted",
        );
        // A contributes 2 lines, B contributes 1 (each counted once despite
        // the emoji line historically matching multiple patterns).
        assertEquals(result.trailersRemoved, 3, "exact per-line trailer count");

        const previews = result.preview ?? [];
        const featurePreview = previews.find((p) => p.originalMessage.startsWith("Add feature"));
        assert(featurePreview, "canonical commit is previewed");
        assertEquals(featurePreview!.trailersFound.length, 2);
        assertEquals(featurePreview!.cleanedMessage, "Add feature\n");

        const bugPreview = previews.find((p) => p.originalMessage.startsWith("Fix bug"));
        assert(bugPreview, "prose commit is previewed");
        assertEquals(bugPreview!.trailersFound.length, 1);
        assert(
          bugPreview!.cleanedMessage.includes("Mentions Claude 🤖 in prose and must survive."),
          "body prose mentioning Claude is preserved in the preview",
        );
        assert(
          bugPreview!.cleanedMessage.includes("Signed-off-by: Human <human@example.com>"),
          "the non-Claude trailer is preserved in the preview",
        );
        assert(
          !bugPreview!.cleanedMessage.includes("Co-Authored-By: Claude"),
          "the Claude co-author is removed in the preview",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step("reports nothing to clean for a repository with no trailers", async () => {
    const repo = await createIsolatedRepo("analysis-clean");
    try {
      await commit(repo.path, "Initial commit");
      await commit(repo.path, "Second commit\n\nA normal body.");

      const cleaner = new CommitCleaner(silentLogger, repo.path);
      const result = await cleaner.cleanCommits({ dryRun: true });

      assertEquals(result.totalCommits, 2);
      assertEquals(result.commitsWithClaudeTrailers, 0);
      assertEquals(result.trailersRemoved, 0);
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Commit Cleaner - dry-run never mutates history", async (t) => {
  await t.step("leaves every commit sha and message unchanged", async () => {
    const repo = await createIsolatedRepo("dry-run");
    try {
      await commit(repo.path, `First\n\n${CANONICAL_TRAILER}`);
      await commit(repo.path, `Second\n\n${CANONICAL_TRAILER}`);

      const shasBefore = (await gitCmd(repo.path, ["rev-list", "HEAD"])).trim();
      const messagesBefore = await gitCmd(repo.path, ["log", "--format=%B"]);

      const cleaner = new CommitCleaner(silentLogger, repo.path);
      const result = await cleaner.cleanCommits({ dryRun: true });
      assertEquals(result.commitsWithClaudeTrailers, 2);

      assertEquals(
        (await gitCmd(repo.path, ["rev-list", "HEAD"])).trim(),
        shasBefore,
        "dry-run must not rewrite commits",
      );
      assertEquals(
        await gitCmd(repo.path, ["log", "--format=%B"]),
        messagesBefore,
        "dry-run must leave messages (including trailers) intact",
      );
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Commit Cleaner - planCleaning preflight", async (t) => {
  await t.step(
    "returns the analysis for a feasible rewrite without mutating history",
    async () => {
      const repo = await createIsolatedRepo("plan");
      try {
        await commit(repo.path, "Root commit");
        await commit(repo.path, `Trailer commit\n\n${CANONICAL_TRAILER}`);
        const shasBefore = (await gitCmd(repo.path, ["rev-list", "HEAD"])).trim();

        const cleaner = new CommitCleaner(silentLogger, repo.path);
        const analysis = await cleaner.planCleaning("HEAD");

        assertEquals(analysis.commitsWithClaudeTrailers, 1);
        assert(analysis.earliestCommitWithTrailer, "earliest offending commit is recorded");
        assertEquals(
          (await gitCmd(repo.path, ["rev-list", "HEAD"])).trim(),
          shasBefore,
          "planCleaning must not mutate history",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Commit Cleaner - Branch Resolution", async (t) => {
  await t.step("resolves to HEAD when no branch is specified", async () => {
    const repo = await createIsolatedRepo("branch-head");
    try {
      await commit(repo.path, "init");
      const cleaner = new CommitCleaner(silentLogger, repo.path);
      assertEquals(await cleaner.resolveBranch(undefined), "HEAD");
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("resolves an explicit, existing branch name as-is", async () => {
    const repo = await createIsolatedRepo("branch-explicit");
    try {
      await commit(repo.path, "init");
      await gitCmd(repo.path, ["checkout", "-b", "feature"]);
      const cleaner = new CommitCleaner(silentLogger, repo.path);
      assertEquals(await cleaner.resolveBranch("feature"), "feature");
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("rejects a branch that does not exist, before any mutation", async () => {
    const repo = await createIsolatedRepo("branch-missing");
    try {
      await commit(repo.path, "init");
      const cleaner = new CommitCleaner(silentLogger, repo.path);
      const error = await assertRejects(
        () => cleaner.resolveBranch("does-not-exist"),
        AppError,
      );
      assertEquals((error as AppError).code, "GET_BRANCH_FAILED");
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Commit Cleaner - repository validation", async (t) => {
  await t.step("validateGitRepository rejects outside a Git repository", async () => {
    const dir = await Deno.makeTempDir({ prefix: "claude-cleaner-nonrepo-commit-" });
    try {
      const cleaner = new CommitCleaner(silentLogger, dir);
      // The public wrapper fails cleanly on a non-repo; it currently reports
      // GIT_VALIDATION_FAILED (its try/catch re-wraps the inner NOT_GIT_REPO),
      // so this pins only the stable contract: an AppError is raised.
      await assertRejects(() => cleaner.validateGitRepository(), AppError);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
