/**
 * Unit tests for file cleaner module
 */

import { assert } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { createCleanRepo, createRepoWithClaudeFiles } from "../utils/fixtures.ts";
import { assertValidGitRepo, getRepoFiles } from "../utils/test-helpers.ts";

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

Deno.test("File Cleaner - BFG Integration", async (t) => {
  await t.step("should generate correct BFG command", async () => {
    // TODO: Test BFG command generation
  });

  await t.step("should handle BFG execution", async () => {
    // TODO: Test BFG execution wrapper
  });

  await t.step("should parse BFG output", async () => {
    // TODO: Test BFG output parsing
  });

  await t.step("should handle BFG errors", async () => {
    // TODO: Test BFG error handling
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

Deno.test("File Cleaner - BFG Filename Validation", async (t) => {
  const { FileCleaner } = await import("../../src/file-cleaner.ts");
  const { ConsoleLogger } = await import("../../src/utils.ts");

  await t.step("should reject filenames with commas", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    // Access private method via type assertion for testing
    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    try {
      validateFn(["file,with,comma.txt"]);
      assert(false, "Should have thrown error for comma in filename");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("special character ','"));
      assert(error.message.includes("file,with,comma.txt"));
    }
  });

  await t.step("should reject filenames with opening brace", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    try {
      validateFn(["file{1}.txt"]);
      assert(false, "Should have thrown error for opening brace in filename");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("special character '{'"));
    }
  });

  await t.step("should reject filenames with closing brace", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    try {
      validateFn(["file}1.txt"]);
      assert(false, "Should have thrown error for closing brace in filename");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("special character '}'"));
    }
  });

  await t.step("should accept valid filenames", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    // Should not throw for valid filenames
    validateFn(["CLAUDE.md", ".claude", "file.txt", "my-file_name.log"]);
  });

  await t.step("should accept filenames with spaces", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    // Spaces are allowed (though may have limitations with batching)
    validateFn(["my file.txt", "another file.log"]);
  });

  await t.step("should provide actionable error messages", () => {
    const logger = new ConsoleLogger(false);
    const cleaner = new FileCleaner(
      {
        dryRun: true,
        verbose: false,
        repoPath: "/tmp/test",
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      },
      logger,
    );

    const validateFn = (cleaner as any).validateFilenamesForBFG.bind(cleaner);

    try {
      validateFn(["bad,file.txt"]);
      assert(false, "Should have thrown error");
    } catch (error) {
      assert(error instanceof Error);
      assert(
        error.message.includes("Cannot batch BFG operations"),
        "Should mention batching limitation",
      );
      assert(
        error.message.includes("Remove this file manually"),
        "Should provide actionable guidance",
      );
    }
  });
});
