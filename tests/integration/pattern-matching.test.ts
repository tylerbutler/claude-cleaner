/**
 * Integration tests for FileCleaner pattern matching functionality
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { FileCleaner, type FileCleanerOptions } from "../../src/file-cleaner.ts";
import { ConsoleLogger } from "../../src/utils.ts";

async function createTestRepo(tempDir: string): Promise<string> {
  const repoPath = join(tempDir, "test-repo");
  await ensureDir(repoPath);

  // Initialize Git repo
  const git = async (cmd: string) => {
    const process = new Deno.Command("git", {
      args: cmd.split(" "),
      cwd: repoPath,
      stdout: "null",
      stderr: "null",
    });
    await process.output();
  };

  await git("init");
  await git("config user.name Test");
  await git("config user.email test@example.com");

  // Create initial commit
  await Deno.writeTextFile(join(repoPath, "README.md"), "# Test Repo");
  await git("add README.md");
  await git("commit -m Initial commit");

  return repoPath;
}

async function createDirectoryStructure(
  repoPath: string,
  structure: Record<string, string | Record<string, string>>,
) {
  for (const [path, content] of Object.entries(structure)) {
    const fullPath = join(repoPath, path);

    if (typeof content === "string") {
      // It's a file
      await ensureDir(join(fullPath, ".."));
      await Deno.writeTextFile(fullPath, content);
    } else {
      // It's a directory with contents
      await ensureDir(fullPath);
      for (const [subPath, subContent] of Object.entries(content)) {
        await Deno.writeTextFile(join(fullPath, subPath), subContent as string);
      }
    }
  }
}

Deno.test("FileCleaner Pattern Matching Integration", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-integration" });
  const logger = new ConsoleLogger(false);

  await t.step("should match user-specified directories", async () => {
    const repoPath = await createTestRepo(tempDir);

    // Create directory structure
    await createDirectoryStructure(repoPath, {
      "claudedocs/index.md": "# Documentation",
      ".serena/config.json": "{}",
      "docs/claudedocs/api.md": "# API docs", // nested claudedocs
      "project/.serena/data.txt": "data", // nested .serena
      "other/normal-dir/file.txt": "normal",
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: ["claudedocs", ".serena"],
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    // Should find user patterns + default Claude files
    const paths = claudeFiles.map((f) => f.path).sort();
    const reasons = claudeFiles.map((f) => f.reason);

    // Check that user patterns are found
    assert(paths.includes("claudedocs"));
    assert(paths.includes(".serena"));
    assert(paths.includes("docs/claudedocs"));
    assert(paths.includes("project/.serena"));

    // Check that default patterns are still found
    assert(paths.includes("CLAUDE.md"));
    assert(paths.includes(".claude"));

    // Check reasons are correct
    assert(reasons.includes("User-specified directory pattern"));
    assert(reasons.includes("Claude project configuration file"));
    assert(reasons.includes("Claude configuration directory"));

    // Should not find normal directories
    assert(!paths.includes("other"));
    assert(!paths.includes("docs"));
    assert(!paths.includes("project"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should work with excludeDefaults option", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createDirectoryStructure(repoPath, {
      "claudedocs/index.md": "# Documentation",
      ".serena/config.json": "{}",
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [".serena"],
      excludeDefaults: true, // Should skip Claude defaults
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    const paths = claudeFiles.map((f) => f.path).sort();

    // Should only find .serena (user pattern)
    assertEquals(paths, [".serena"]);

    // Should NOT find default Claude patterns
    assert(!paths.includes("CLAUDE.md"));
    assert(!paths.includes(".claude"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should handle empty includeDirectories", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createDirectoryStructure(repoPath, {
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",
      "docs/readme.md": "# Normal docs",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [], // No user patterns
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    const paths = claudeFiles.map((f) => f.path).sort();

    // Should only find default Claude patterns
    assert(paths.includes("CLAUDE.md"));
    assert(paths.includes(".claude"));

    // Should not find normal dirs
    assert(!paths.includes("docs"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should match basename only, not full paths", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createDirectoryStructure(repoPath, {
      "temp/file1.txt": "temp file",
      "project/temp/file2.txt": "nested temp file",
      "other/temp-backup/file3.txt": "temp-backup file", // should NOT match 'temp'
      "temporary/file4.txt": "temporary file", // should NOT match 'temp'
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: ["temp"],
      excludeDefaults: true,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    const paths = claudeFiles.map((f) => f.path).sort();

    // Should match exact basename only
    assert(paths.includes("temp"));
    assert(paths.includes("project/temp"));

    // Should NOT match partial matches
    assert(!paths.includes("other/temp-backup"));
    assert(!paths.includes("temporary"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should handle nested directory structures", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createDirectoryStructure(repoPath, {
      "level1/level2/level3/target/file.txt": "deep file",
      "another/target/file.txt": "another file",
      "target/file.txt": "root file",
      "not-target/file.txt": "should not match",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: ["target"],
      excludeDefaults: true,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all 'target' directories at any depth
    assert(paths.includes("target"));
    assert(paths.includes("another/target"));
    assert(paths.includes("level1/level2/level3/target"));

    // Should not find non-matches
    assert(!paths.includes("not-target"));
    assert(!paths.includes("level1"));
    assert(!paths.includes("another"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should handle multiple patterns", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createDirectoryStructure(repoPath, {
      "build/output.js": "built file",
      "dist/bundle.js": "distribution file",
      "cache/data.json": "cached data",
      "src/index.ts": "source file",
      "docs/build/html/index.html": "nested build",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: ["build", "dist", "cache"],
      excludeDefaults: true,
      includeAllCommonPatterns: false,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all specified patterns
    assert(paths.includes("build"));
    assert(paths.includes("dist"));
    assert(paths.includes("cache"));
    assert(paths.includes("docs/build"));

    // Should not find non-specified patterns
    assert(!paths.includes("src"));
    assert(!paths.includes("docs"));

    await Deno.remove(repoPath, { recursive: true });
  });

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
