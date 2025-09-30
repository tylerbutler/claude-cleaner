/**
 * Tests for the testing framework itself
 */

import { assert, assertExists } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import {
  createCleanRepo,
  createFullTestRepo,
  createMinimalRepo,
  createRepoWithClaudeCommits,
  createRepoWithClaudeFiles,
} from "../utils/fixtures.ts";
import {
  assertNoClaudeArtifacts,
  assertValidGitRepo,
  createTestRepo,
  getCommitMessages,
  getRepoFiles,
  hasClaudeArtifacts,
} from "../utils/test-helpers.ts";

Deno.test("Test Helpers", async (t) => {
  await t.step("createTestRepo creates valid Git repository", async () => {
    const repo = await createTestRepo("test");

    try {
      assertExists(repo.path);
      await assertValidGitRepo(repo.path);
      assert(await exists(join(repo.path, ".git")));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("hasClaudeArtifacts detects Claude content", () => {
    assert(
      hasClaudeArtifacts(
        "🤖 Generated with [Claude Code](https://claude.ai/code)",
      ),
    );
    assert(
      hasClaudeArtifacts("Co-Authored-By: Claude <noreply@anthropic.com>"),
    );
    assert(hasClaudeArtifacts("Generated with Claude"));
    assert(!hasClaudeArtifacts("This is clean content"));
    assert(!hasClaudeArtifacts("Regular commit message"));
  });

  await t.step("assertNoClaudeArtifacts throws on Claude content", () => {
    let threw = false;
    try {
      assertNoClaudeArtifacts("🤖 Generated with [Claude Code]");
    } catch {
      threw = true;
    }
    assert(threw);

    // Should not throw on clean content
    assertNoClaudeArtifacts("This is clean content");
  });

  await t.step("getRepoFiles returns all files", async () => {
    const repo = await createTestRepo("files-test");

    try {
      // Add some files
      await Deno.writeTextFile(join(repo.path, "file1.txt"), "content1");
      await Deno.writeTextFile(join(repo.path, "file2.txt"), "content2");

      const { $ } = await import("dax");
      await $`git add file1.txt`.cwd(repo.path);
      await $`git commit -m "Add file1"`.cwd(repo.path);

      const files = await getRepoFiles(repo.path);
      assert(files.includes("file1.txt"));
      assert(files.includes("file2.txt")); // untracked
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("getCommitMessages returns commit messages", async () => {
    const repo = await createTestRepo("commits-test");

    try {
      await Deno.writeTextFile(join(repo.path, "test.txt"), "content");

      const { $ } = await import("dax");
      await $`git add .`.cwd(repo.path);
      await $`git commit -m "Test commit message"`.cwd(repo.path);

      const messages = await getCommitMessages(repo.path);
      assert(messages.length > 0);
      assert(messages.some((msg) => msg.includes("Test commit message")));
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Fixtures", async (t) => {
  await t.step("createMinimalRepo creates basic repository", async () => {
    const repo = await createMinimalRepo();

    try {
      await assertValidGitRepo(repo.path);
      assert(await exists(join(repo.path, "README.md")));
      assert(await exists(join(repo.path, "package.json")));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step(
    "createRepoWithClaudeFiles includes Claude artifacts",
    async () => {
      const repo = await createRepoWithClaudeFiles();

      try {
        await assertValidGitRepo(repo.path);
        assert(await exists(join(repo.path, "CLAUDE.md")));
        assert(await exists(join(repo.path, ".claude")));
        assert(await exists(join(repo.path, ".vscode", "claude.json")));
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step("createRepoWithClaudeCommits has Claude trailers", async () => {
    const repo = await createRepoWithClaudeCommits();

    try {
      await assertValidGitRepo(repo.path);

      const messages = await getCommitMessages(repo.path);
      assert(messages.length > 0);

      // All commits should have Claude trailers
      const hasTrailers = messages.some((msg) => hasClaudeArtifacts(msg));
      assert(hasTrailers);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("createFullTestRepo has both files and commits", async () => {
    const repo = await createFullTestRepo();

    try {
      await assertValidGitRepo(repo.path);

      // Check for Claude files
      assert(await exists(join(repo.path, "CLAUDE.md")));
      assert(await exists(join(repo.path, ".claude")));

      // Check for Claude commit trailers
      const messages = await getCommitMessages(repo.path);
      const hasTrailers = messages.some((msg) => hasClaudeArtifacts(msg));
      assert(hasTrailers);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("createCleanRepo has no Claude artifacts", async () => {
    const repo = await createCleanRepo();

    try {
      await assertValidGitRepo(repo.path);

      // Should not have Claude files
      assert(!(await exists(join(repo.path, "CLAUDE.md"))));
      assert(!(await exists(join(repo.path, ".claude"))));

      // Should not have Claude commit trailers
      const messages = await getCommitMessages(repo.path);
      const hasTrailers = messages.some((msg) => hasClaudeArtifacts(msg));
      assert(!hasTrailers);
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("Cross-platform compatibility", async (t) => {
  await t.step("handles different path separators", async () => {
    const repo = await createTestRepo("cross-platform");

    try {
      // Test with nested directories
      await Deno.mkdir(join(repo.path, "deep", "nested", "path"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(repo.path, "deep", "nested", "path", "file.txt"),
        "content",
      );

      assert(
        await exists(join(repo.path, "deep", "nested", "path", "file.txt")),
      );
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("handles special characters in paths", async () => {
    const repo = await createTestRepo("special-chars");

    try {
      // Create directory with spaces
      await Deno.mkdir(join(repo.path, "folder with spaces"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(repo.path, "folder with spaces", "file.txt"),
        "content",
      );

      assert(await exists(join(repo.path, "folder with spaces", "file.txt")));
    } finally {
      await repo.cleanup();
    }
  });
});
