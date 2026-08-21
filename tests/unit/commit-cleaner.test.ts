/**
 * Unit tests for commit cleaner module
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { CommitCleaner } from "../../src/commit-cleaner.ts";
import { AppError, ConsoleLogger } from "../../src/utils.ts";
import { createCleanRepo, createRepoWithClaudeCommits } from "../utils/fixtures.ts";
import { getCommitMessages, hasClaudeArtifacts } from "../utils/test-helpers.ts";

// These tests will be implemented when commit-cleaner.ts is available
// For now, they serve as specifications for the expected behavior

Deno.test("Commit Cleaner - Claude Trailer Detection", async (t) => {
  await t.step("should detect Claude Code trailers", () => {
    const testMessage = `Add new feature

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

    assert(hasClaudeArtifacts(testMessage));
  });

  await t.step("should detect partial Claude trailers", () => {
    const testMessage = `Fix bug

Co-Authored-By: Claude <noreply@anthropic.com>`;

    assert(hasClaudeArtifacts(testMessage));
  });

  await t.step("should not detect false positives", () => {
    const cleanMessage = `Clean commit message

No Claude artifacts here.`;

    assert(!hasClaudeArtifacts(cleanMessage));
  });
});

Deno.test("Commit Cleaner - Text Processing", async (t) => {
  await t.step(
    "should remove Claude trailers from commit messages",
    async () => {
      // TODO: Implement when src/commit-cleaner.ts exists
      // const cleaner = new CommitCleaner();
      // const cleaned = await cleaner.cleanMessage(dirtyMessage);
      // assertNoClaudeArtifacts(cleaned);
    },
  );

  await t.step("should handle Unicode in commit messages", () => {
    const unicodeMessage = `Add 文档 support

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

    // TODO: Test Unicode handling
    assert(hasClaudeArtifacts(unicodeMessage));
  });

  await t.step("should preserve commit message structure", async () => {
    // TODO: Test that cleaning preserves message structure
  });

  await t.step("should handle empty trailers", async () => {
    // TODO: Test edge cases with empty or malformed trailers
  });
});

Deno.test("Commit Cleaner - Git Filter-Branch Integration", async (t) => {
  await t.step("should generate correct filter-branch command", async () => {
    // TODO: Test git filter-branch command generation
  });

  await t.step("should execute filter-branch safely", async () => {
    // TODO: Test filter-branch execution
  });

  await t.step("should handle filter-branch errors", async () => {
    // TODO: Test error handling
  });

  await t.step("should validate commit history after cleaning", async () => {
    // TODO: Test history validation
  });
});

Deno.test("Commit Cleaner - Dry Run Mode", async (t) => {
  await t.step("should show commit changes in dry run", async () => {
    const repo = await createRepoWithClaudeCommits();

    try {
      // TODO: Test dry run mode
      // const cleaner = new CommitCleaner(repo.path);
      // const preview = await cleaner.dryRun();
      // assert(preview.changes.length > 0);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should not modify commits in dry run", async () => {
    const repo = await createRepoWithClaudeCommits();

    try {
      // Get original messages
      const originalMessages = await getCommitMessages(repo.path);
      const hasOriginalTrailers = originalMessages.some((msg) => hasClaudeArtifacts(msg));
      assert(hasOriginalTrailers);

      // TODO: Run dry run mode
      // const cleaner = new CommitCleaner(repo.path);
      // await cleaner.dryRun();

      // Verify messages unchanged
      const unchangedMessages = await getCommitMessages(repo.path);
      assertEquals(originalMessages.length, unchangedMessages.length);
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Commit Cleaner - Edge Cases", async (t) => {
  await t.step("should handle commits with no trailers", async () => {
    const repo = await createCleanRepo();

    try {
      // TODO: Test cleaning repo with no Claude artifacts
      const messages = await getCommitMessages(repo.path);
      assert(messages.length > 0);
      assert(!messages.some((msg) => hasClaudeArtifacts(msg)));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should handle very long commit messages", async () => {
    // TODO: Test with long commit messages
  });

  await t.step("should handle binary data in commit messages", async () => {
    // TODO: Test with unusual commit message content
  });

  await t.step("should handle merge commits", async () => {
    // TODO: Test merge commit handling
  });
});

Deno.test("Commit Cleaner - Branch Resolution", async (t) => {
  const logger = new ConsoleLogger(false);

  await t.step("resolves to HEAD when no branch is specified", async () => {
    const repo = await createCleanRepo();
    try {
      const cleaner = new CommitCleaner(logger, repo.path);
      const resolved = await cleaner.resolveBranch(undefined);
      assertEquals(resolved, "HEAD");
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("resolves an explicit, existing branch name as-is", async () => {
    const repo = await createCleanRepo();
    try {
      const { $ } = await import("dax");
      await $`git checkout -b feature`.cwd(repo.path).stdout("piped").stderr("piped");

      const cleaner = new CommitCleaner(logger, repo.path);
      const resolved = await cleaner.resolveBranch("feature");
      assertEquals(resolved, "feature");
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("rejects a branch that does not exist, before any mutation", async () => {
    const repo = await createCleanRepo();
    try {
      const cleaner = new CommitCleaner(logger, repo.path);
      await assertRejects(
        () => cleaner.resolveBranch("does-not-exist"),
        AppError,
      );
    } finally {
      await repo.cleanup();
    }
  });
});

// NOTE: The "un-checked-out branch targeting" behavior check formerly lived
// here and called `cleaner.cleanCommits({ dryRun: false, ... })` in-process.
// That is unsound: `resolveSelfInvocation` derives the `--msg-filter`
// self-invocation command from `Deno.mainModule`, which under `deno test`
// resolves to *this test file*, not `src/main.ts`. The `git filter-branch
// --msg-filter` subprocess therefore never runs the real filter, and its
// (effectively empty/no-op) output made `hasClaudeArtifacts(...)` pass for
// the wrong reason. The check now runs through the real CLI subprocess seam
// (the same seam `src/main.ts` and compiled binaries use) so it exercises
// production code and asserts the exact cleaned message; see
// "Un-checked-out branch targeting (subprocess CLI seam)" in
// tests/integration/commit-branch-scoping.test.ts.
