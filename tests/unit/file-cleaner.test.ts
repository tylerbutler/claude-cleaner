/**
 * Unit tests for file cleaner module
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { createCleanRepo, createRepoWithClaudeFiles } from "../utils/fixtures.ts";
import { assertValidGitRepo, getRepoFiles } from "../utils/test-helpers.ts";
import { type ClaudeFile, FileCleaner } from "../../src/file-cleaner.ts";
import { AppError, ConsoleLogger } from "../../src/utils.ts";

// These tests will be implemented when file-cleaner.ts is available
// For now, they serve as specifications for the expected behavior

Deno.test("File Cleaner - Claude File Detection", async (t) => {
  await t.step("should detect CLAUDE.md files", async () => {
    const repo = await createRepoWithClaudeFiles();

    try {
      // TODO: Implement when src/file-cleaner.ts exists
      // const cleaner = new FileCleaner(repo.path);
      // const claudeFiles = await cleaner.detectClaudeFiles();
      // assert(claudeFiles.some(f => f.includes("CLAUDE.md")));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should detect .claude directories", async () => {
    const repo = await createRepoWithClaudeFiles();

    try {
      // TODO: Test .claude directory detection
      assert(await exists(join(repo.path, ".claude")));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should detect .vscode/claude.json", async () => {
    const repo = await createRepoWithClaudeFiles();

    try {
      // TODO: Test VS Code Claude config detection
      assert(await exists(join(repo.path, ".vscode", "claude.json")));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should not detect false positives", async () => {
    const repo = await createCleanRepo();

    try {
      // TODO: Test that clean repo has no Claude files detected
      const files = await getRepoFiles(repo.path);
      assert(!files.some((f) => f.includes("CLAUDE.md")));
      assert(!files.some((f) => f.includes(".claude")));
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("File Cleaner - Git Repository Handling", async (t) => {
  await t.step("should validate Git repository", async () => {
    const repo = await createCleanRepo();

    try {
      await assertValidGitRepo(repo.path);
      // TODO: Test repository validation in file cleaner
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should create backup before cleaning", async () => {
    // TODO: Test backup creation
  });

  await t.step("should verify Git history after cleaning", async () => {
    // TODO: Test history verification
  });

  await t.step("should provide rollback capability", async () => {
    // TODO: Test rollback functionality
  });
});

Deno.test("File Cleaner - Dry Run Mode", async (t) => {
  await t.step("should show files that would be removed", async () => {
    const repo = await createRepoWithClaudeFiles();

    try {
      // TODO: Test dry run mode
      // const cleaner = new FileCleaner(repo.path);
      // const preview = await cleaner.dryRun();
      // assert(preview.files.length > 0);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should not modify repository in dry run", async () => {
    const repo = await createRepoWithClaudeFiles();

    try {
      // Verify Claude files exist before dry run
      assert(await exists(join(repo.path, "CLAUDE.md")));

      // TODO: Run dry run mode
      // const cleaner = new FileCleaner(repo.path);
      // await cleaner.dryRun();

      // Verify files still exist after dry run
      assert(await exists(join(repo.path, "CLAUDE.md")));
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("File Cleaner - Removal Plan (exact-path normalization)", async (t) => {
  const makeCleaner = () =>
    new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: ".",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
        includeInstructionFiles: false,
      },
      new ConsoleLogger(false),
    );

  const file = (path: string, type: "file" | "directory" = "file"): ClaudeFile => ({
    path,
    type,
    reason: "test",
  });

  await t.step("drops descendant entries covered by a selected directory", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file(".claude", "directory"),
      file(".claude/config.json"),
      file(".claude/nested/deep.json"),
    ]);
    // Only the covering directory survives; nested descendants are pruned.
    assertEquals(plan, [".claude"]);
  });

  await t.step("keeps exact paths that share a basename (no basename expansion)", () => {
    // A Claude artifact and an unrelated file share the basename config.json.
    // Only the exact Claude path is planned; the sibling is never included.
    const plan = makeCleaner().buildRemovalPlan([
      file(".claude/config.json"),
    ]);
    assertEquals(plan, [".claude/config.json"]);
    assert(!plan.includes("src/config.json"));
  });

  await t.step("keeps distinct same-basename artifacts at different paths", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file("docs/CLAUDE.md"),
      file("CLAUDE.md"),
    ]);
    // Both exact paths are preserved (sorted), not collapsed to one basename.
    assertEquals(plan, ["CLAUDE.md", "docs/CLAUDE.md"]);
  });

  await t.step("does not prune sibling paths that merely share a prefix", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file(".claude", "directory"),
      file(".clauderc"),
    ]);
    // ".clauderc" is not a descendant of ".claude/" and must be retained.
    assertEquals(plan, [".claude", ".clauderc"]);
  });

  await t.step("deduplicates repeated paths", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file("claudedocs", "directory"),
      file("claudedocs", "directory"),
      file("claudedocs/notes.md"),
    ]);
    assertEquals(plan, ["claudedocs"]);
  });

  await t.step("normalizes ./ prefixes and trailing slashes before deduping", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file("./.claude/", "directory"),
      file(".claude"),
    ]);
    assertEquals(plan, [".claude"]);
  });

  await t.step("keeps independent directories and prunes each one's descendants", () => {
    const plan = makeCleaner().buildRemovalPlan([
      file(".serena", "directory"),
      file(".serena/data.json"),
      file(".claude", "directory"),
      file(".claude/config.json"),
    ]);
    assertEquals(plan, [".claude", ".serena"]);
  });

  await t.step("returns an empty plan for no files", () => {
    assertEquals(makeCleaner().buildRemovalPlan([]), []);
  });
});

Deno.test("File Cleaner - Working tree safety", async (t) => {
  await t.step(
    "cleanFiles refuses to rewrite history when tracked files are dirty",
    async () => {
      const repo = await createRepoWithClaudeFiles();
      try {
        // Commit the Claude artifacts so they exist in history.
        await new Deno.Command("git", { args: ["add", "-A"], cwd: repo.path }).output();
        await new Deno.Command("git", {
          args: ["commit", "-m", "add claude artifacts"],
          cwd: repo.path,
        }).output();

        // Dirty a tracked file (unstaged change) so filter-branch would refuse.
        await Deno.writeTextFile(join(repo.path, "README.md"), "# changed\n");

        const cleaner = new FileCleaner(
          {
            dryRun: false,
            verbose: false,
            repoPath: repo.path,
            createBackup: false,
            includeDirectories: [],
            excludeDefaults: false,
            includeAllCommonPatterns: false,
            includeInstructionFiles: false,
          },
          new ConsoleLogger(false),
        );

        let thrown: unknown;
        try {
          await cleaner.cleanFiles();
        } catch (error) {
          thrown = error;
        }
        assert(thrown instanceof AppError, "expected an AppError");
        assertEquals((thrown as AppError).code, "WORKING_TREE_DIRTY");
      } finally {
        await repo.cleanup();
      }
    },
  );
});
