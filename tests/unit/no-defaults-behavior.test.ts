/**
 * Unit tests for --no-defaults flag behavior
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { FileCleaner, type FileCleanerOptions } from "../../src/file-cleaner.ts";
import { ConsoleLogger } from "../../src/utils.ts";

async function createMockRepo(tempDir: string): Promise<string> {
  const repoPath = join(tempDir, "mock-repo");
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

async function commitAllFiles(repoPath: string) {
  const git = async (args: string[]) => {
    const process = new Deno.Command("git", {
      args,
      cwd: repoPath,
      stdout: "null",
      stderr: "null",
    });
    await process.output();
  };

  await git(["add", "-A", "--force"]);
  await git(["commit", "-m", "Add test files"]);
}

Deno.test("No Defaults Flag Behavior", async (t) => {
  const tempDir = await Deno.makeTempDir({
    prefix: "claude-cleaner-no-defaults",
  });
  const logger = new ConsoleLogger(false);

  await t.step(
    "should include default patterns when excludeDefaults is false",
    async () => {
      const repoPath = await createMockRepo(tempDir);

      // Create both Claude defaults and user patterns
      await ensureDir(join(repoPath, ".claude"));
      await Deno.writeTextFile(join(repoPath, ".claude", "config.json"), "{}");
      await Deno.writeTextFile(join(repoPath, "CLAUDE.md"), "# Claude config");
      await ensureDir(join(repoPath, ".serena"));
      await Deno.writeTextFile(join(repoPath, ".serena", "data.json"), "{}");
      await ensureDir(join(repoPath, "claudedocs"));
      await Deno.writeTextFile(join(repoPath, "claudedocs", "doc.md"), "# Doc");

      // Commit files to git history
      await commitAllFiles(repoPath);

      const options: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [".serena", "claudedocs"],
        excludeDefaults: false, // Should include defaults
        includeAllCommonPatterns: false,
      };

      const fileCleaner = new FileCleaner(options, logger);
      const claudeFiles = await fileCleaner.detectClaudeFiles();

      const paths = claudeFiles.map((f) => f.path).sort();
      const reasons = claudeFiles.map((f) => f.reason);

      // Should find both user patterns AND defaults
      assert(paths.includes(".serena"));
      assert(paths.includes("claudedocs"));
      assert(paths.includes(".claude"));
      assert(paths.includes("CLAUDE.md"));

      // Check reasons
      assert(reasons.includes("User-specified directory pattern"));
      assert(reasons.includes("Claude configuration directory"));
      assert(reasons.includes("Claude project configuration file"));

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step(
    "should exclude default patterns when excludeDefaults is true",
    async () => {
      const repoPath = await createMockRepo(tempDir);

      // Create both Claude defaults and user patterns
      await ensureDir(join(repoPath, ".claude"));
      await Deno.writeTextFile(join(repoPath, ".claude", "config.json"), "{}");
      await Deno.writeTextFile(join(repoPath, "CLAUDE.md"), "# Claude config");
      await ensureDir(join(repoPath, ".vscode"));
      await Deno.writeTextFile(join(repoPath, ".vscode", "claude.json"), "{}");
      await ensureDir(join(repoPath, ".serena"));
      await Deno.writeTextFile(join(repoPath, ".serena", "data.json"), "{}");
      await ensureDir(join(repoPath, "claudedocs"));
      await Deno.writeTextFile(join(repoPath, "claudedocs", "doc.md"), "# Doc");

      // Commit files to git history
      await commitAllFiles(repoPath);

      const options: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [".serena", "claudedocs"],
        excludeDefaults: true, // Should exclude defaults
        includeAllCommonPatterns: false,
      };

      const fileCleaner = new FileCleaner(options, logger);
      const claudeFiles = await fileCleaner.detectClaudeFiles();

      const paths = claudeFiles.map((f) => f.path).sort();
      const reasons = claudeFiles.map((f) => f.reason);

      // Should find ONLY user patterns
      assert(paths.includes(".serena"));
      assert(paths.includes("claudedocs"));

      // Should NOT find defaults
      assert(!paths.includes(".claude"));
      assert(!paths.includes("CLAUDE.md"));
      assert(!paths.includes(".vscode/claude.json"));

      // All reasons should be user-specified
      for (const reason of reasons) {
        assertEquals(reason, "User-specified directory pattern");
      }

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step(
    "should return empty when excludeDefaults is true and no user patterns",
    async () => {
      const repoPath = await createMockRepo(tempDir);

      // Create only Claude defaults
      await ensureDir(join(repoPath, ".claude"));
      await Deno.writeTextFile(join(repoPath, "CLAUDE.md"), "# Claude config");

      // Commit files to git history
      await commitAllFiles(repoPath);

      const options: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [], // No user patterns
        excludeDefaults: true, // Exclude defaults
        includeAllCommonPatterns: false,
      };

      const fileCleaner = new FileCleaner(options, logger);
      const claudeFiles = await fileCleaner.detectClaudeFiles();

      // Should find nothing
      assertEquals(claudeFiles.length, 0);

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step(
    "should handle nested Claude patterns with excludeDefaults",
    async () => {
      const repoPath = await createMockRepo(tempDir);

      // Create nested Claude patterns
      await ensureDir(join(repoPath, "project", ".claude"));
      await Deno.writeTextFile(
        join(repoPath, "project", ".claude", "config.json"),
        "{}",
      );
      await ensureDir(join(repoPath, "docs"));
      await Deno.writeTextFile(
        join(repoPath, "docs", "CLAUDE.md"),
        "# Docs Claude config",
      );
      await ensureDir(join(repoPath, "src", ".vscode"));
      await Deno.writeTextFile(
        join(repoPath, "src", ".vscode", "claude.json"),
        "{}",
      );

      // Create user pattern at same location
      await ensureDir(join(repoPath, "project", ".serena"));
      await Deno.writeTextFile(
        join(repoPath, "project", ".serena", "data.json"),
        "{}",
      );

      // Commit files to git history
      await commitAllFiles(repoPath);

      const options: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [".serena"],
        excludeDefaults: true,
        includeAllCommonPatterns: false,
      };

      const fileCleaner = new FileCleaner(options, logger);
      const claudeFiles = await fileCleaner.detectClaudeFiles();

      const paths = claudeFiles.map((f) => f.path).sort();

      // Should find only user pattern (directory and its files)
      assert(paths.includes("project/.serena"));
      assert(paths.includes("project/.serena/data.json"));

      // Should not find nested Claude patterns
      assert(!paths.includes("project/.claude"));
      assert(!paths.includes("docs/CLAUDE.md"));
      assert(!paths.includes("src/.vscode/claude.json"));

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step(
    "should handle VS Code claude.json files correctly",
    async () => {
      const repoPath = await createMockRepo(tempDir);

      // Create VS Code claude.json (default pattern)
      await ensureDir(join(repoPath, ".vscode"));
      await Deno.writeTextFile(join(repoPath, ".vscode", "claude.json"), "{}");

      // Create nested VS Code claude.json
      await ensureDir(join(repoPath, "project", ".vscode"));
      await Deno.writeTextFile(
        join(repoPath, "project", ".vscode", "claude.json"),
        "{}",
      );

      // Commit files to git history
      await commitAllFiles(repoPath);

      // Test with defaults enabled
      const optionsWithDefaults: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: false,
        includeAllCommonPatterns: false,
      };

      const fileCleanerWithDefaults = new FileCleaner(
        optionsWithDefaults,
        logger,
      );
      const claudeFilesWithDefaults = await fileCleanerWithDefaults.detectClaudeFiles();

      // Should find VS Code claude.json files
      const pathsWithDefaults = claudeFilesWithDefaults
        .map((f) => f.path)
        .sort();
      assert(pathsWithDefaults.some((p) => p.includes(".vscode/claude.json")));

      // Test with defaults disabled
      const optionsWithoutDefaults: FileCleanerOptions = {
        dryRun: true,
        verbose: false,
        repoPath,
        createBackup: false,
        includeDirectories: [],
        excludeDefaults: true,
        includeAllCommonPatterns: false,
      };

      const fileCleanerWithoutDefaults = new FileCleaner(
        optionsWithoutDefaults,
        logger,
      );
      const claudeFilesWithoutDefaults = await fileCleanerWithoutDefaults.detectClaudeFiles();

      // Should not find VS Code claude.json files
      assertEquals(claudeFilesWithoutDefaults.length, 0);

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step("should handle Claude temporary files correctly", async () => {
    const repoPath = await createMockRepo(tempDir);

    // Create Claude temporary files (default patterns)
    await Deno.writeTextFile(join(repoPath, "claude-temp-123.log"), "temp log");
    await Deno.writeTextFile(join(repoPath, ".claude.tmp"), "temp file");
    await Deno.writeTextFile(
      join(repoPath, "claude-session.temp"),
      "session temp",
    );

    // Commit files to git history
    await commitAllFiles(repoPath);

    // Test with defaults enabled
    const optionsWithDefaults: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: false,
    };

    const fileCleanerWithDefaults = new FileCleaner(
      optionsWithDefaults,
      logger,
    );
    const claudeFilesWithDefaults = await fileCleanerWithDefaults.detectClaudeFiles();

    // Should find Claude temp files
    const pathsWithDefaults = claudeFilesWithDefaults.map((f) => f.path).sort();
    assert(pathsWithDefaults.includes("claude-temp-123.log"));
    assert(pathsWithDefaults.includes(".claude.tmp"));
    assert(pathsWithDefaults.includes("claude-session.temp"));

    // Test with defaults disabled
    const optionsWithoutDefaults: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: true,
      includeAllCommonPatterns: false,
    };

    const fileCleanerWithoutDefaults = new FileCleaner(
      optionsWithoutDefaults,
      logger,
    );
    const claudeFilesWithoutDefaults = await fileCleanerWithoutDefaults.detectClaudeFiles();

    // Should not find Claude temp files
    assertEquals(claudeFilesWithoutDefaults.length, 0);

    await Deno.remove(repoPath, { recursive: true });
  });

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
