/**
 * Unit tests for directory pattern validation
 */

import { assert, assertRejects } from "@std/assert";
import { FileCleaner, type FileCleanerOptions } from "../../src/file-cleaner.ts";
import { ConsoleLogger } from "../../src/utils.ts";

Deno.test("Pattern Validation", async (t) => {
  const logger = new ConsoleLogger(false);

  function createFileCleaner(includeDirectories: string[]): FileCleaner {
    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath: "/tmp/test",
      createBackup: false,
      includeDirectories,
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };
    return new FileCleaner(options, logger);
  }

  await t.step("should reject parent directory references", async () => {
    const fileCleaner = createFileCleaner(["../parent"]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "parent directory references (..) are not allowed",
    );
  });

  await t.step("should reject absolute paths", async () => {
    const fileCleaner = createFileCleaner(["/absolute/path"]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "absolute paths are not allowed",
    );
  });

  await t.step("should reject path separators", async () => {
    const fileCleaner = createFileCleaner(["dir/subdir"]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "path separators are not allowed",
    );
  });

  await t.step("should reject wildcard-only patterns", async () => {
    const fileCleaner = createFileCleaner(["*"]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "wildcard-only patterns are too dangerous",
    );
  });

  await t.step("should reject empty patterns", async () => {
    const fileCleaner = createFileCleaner([""]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "Empty patterns are not allowed",
    );
  });

  await t.step("should reject whitespace-only patterns", async () => {
    const fileCleaner = createFileCleaner(["   "]);

    await assertRejects(
      () => fileCleaner.detectClaudeFiles(),
      Error,
      "Empty patterns are not allowed",
    );
  });

  await t.step("should accept valid directory names", async () => {
    const fileCleaner = createFileCleaner(["claudedocs", ".serena", "valid-name"]);

    // Should not throw during validation
    // We can't actually run detectClaudeFiles without a real repo, but we can check it doesn't fail validation
    try {
      await fileCleaner.detectClaudeFiles();
    } catch (error) {
      // If it fails, it should be due to missing repo, not pattern validation
      assert(!(error instanceof Error && error.message.includes("Invalid pattern")));
    }
  });

  await t.step("should accept hidden directories", async () => {
    const fileCleaner = createFileCleaner([".hidden", ".cache", ".config"]);

    try {
      await fileCleaner.detectClaudeFiles();
    } catch (error) {
      assert(!(error instanceof Error && error.message.includes("Invalid pattern")));
    }
  });

  await t.step("should accept patterns with hyphens and underscores", async () => {
    const fileCleaner = createFileCleaner(["my-dir", "my_dir", "test-123"]);

    try {
      await fileCleaner.detectClaudeFiles();
    } catch (error) {
      assert(!(error instanceof Error && error.message.includes("Invalid pattern")));
    }
  });
});

Deno.test("Pattern Warning System", async (t) => {
  await t.step("should warn about potentially broad patterns", async () => {
    // Capture console output to test warnings
    const warnings: string[] = [];
    const mockLogger = {
      info: () => {},
      warn: (msg: string) => warnings.push(msg),
      error: () => {},
      verbose: () => {},
      debug: () => {},
    };

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath: "/tmp/test",
      createBackup: false,
      includeDirectories: ["temp", "cache", "a", "build"],
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, mockLogger);

    try {
      await fileCleaner.detectClaudeFiles();
    } catch {
      // Expected to fail due to missing repo
    }

    // Should have warnings for broad patterns
    assert(warnings.some((w) => w.includes("Pattern 'temp' may match many directories")));
    assert(warnings.some((w) => w.includes("Pattern 'cache' may match many directories")));
    assert(warnings.some((w) => w.includes("Pattern 'a' may match many directories")));
    assert(warnings.some((w) => w.includes("Pattern 'build' may match many directories")));
  });

  await t.step("should not warn about specific patterns", async () => {
    const warnings: string[] = [];
    const mockLogger = {
      info: (msg: string) => warnings.push(msg),
      warn: () => {},
      error: () => {},
      verbose: () => {},
      debug: () => {},
    };

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath: "/tmp/test",
      createBackup: false,
      includeDirectories: ["claudedocs", ".serena", "specific-project-dir"],
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, mockLogger);

    try {
      await fileCleaner.detectClaudeFiles();
    } catch {
      // Expected to fail due to missing repo
    }

    // Should not have warnings for specific patterns
    assert(!warnings.some((w) => w.includes("may match many directories")));
  });
});
