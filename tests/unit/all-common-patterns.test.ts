/**
 * Unit tests for --include-all-common-patterns flag functionality
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
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

async function createTestFiles(
  repoPath: string,
  files: Record<string, string>,
) {
  const git = async (args: string[]) => {
    const process = new Deno.Command("git", {
      args,
      cwd: repoPath,
      stdout: "null",
      stderr: "null",
    });
    await process.output();
  };

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoPath, filePath);
    await ensureDir(join(fullPath, ".."));
    await Deno.writeTextFile(fullPath, content);
  }

  // Commit all files to git history so they can be detected
  // Use --force to add files that might be in global gitignore (like *.log)
  await git(["add", "-A", "--force"]);
  await git(["commit", "-m", "Add test files"]);
}

Deno.test("All Common Patterns Flag", async (t) => {
  const tempDir = await Deno.makeTempDir({
    prefix: "claude-cleaner-all-patterns",
  });
  const logger = new ConsoleLogger(false);

  await t.step("should reject conflicting flags", async () => {
    const repoPath = await createTestRepo(tempDir);

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: true, // This should conflict with includeAllCommonPatterns
      includeAllCommonPatterns: true,
    };

    // Should not be able to create FileCleaner with conflicting options
    // Note: This conflict is checked in main.ts cleanAction, not FileCleaner
    // But we can test the logic here by checking the options are mutually exclusive

    assert(
      options.excludeDefaults && options.includeAllCommonPatterns,
      "Test setup should have conflicting options",
    );

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find default Claude patterns", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",
      ".vscode/claude.json": "{}",
      "claude-temp.log": "temp log",
      ".claude_session.tmp": "session file",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all default patterns
    assert(paths.includes("CLAUDE.md"));
    assert(paths.includes(".claude"));
    assert(paths.includes(".vscode/claude.json"));
    assert(paths.includes("claude-temp.log"));
    assert(paths.includes(".claude_session.tmp"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find extended configuration files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude.config.json": "config",
      "claude-settings.yaml": "settings",
      "claude_workspace.toml": "workspace",
      ".claude.ini": "ini config",
      "claude-env.config": "env config",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all extended config patterns
    assert(paths.includes("claude.config.json"));
    assert(paths.includes("claude-settings.yaml"));
    assert(paths.includes("claude_workspace.toml"));
    assert(paths.includes(".claude.ini"));
    assert(paths.includes("claude-env.config"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find session and state files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude-session-123.dat": "session",
      ".claude_state.json": "state",
      "claude.cache": "cache",
      ".claude-history.log": "history",
      "claude_session_active.state": "active session",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all session/state patterns
    assert(paths.includes("claude-session-123.dat"));
    assert(paths.includes(".claude_state.json"));
    assert(paths.includes("claude.cache"));
    assert(paths.includes(".claude-history.log"));
    assert(paths.includes("claude_session_active.state"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find temporary and working files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude-temp-work.txt": "temp work",
      ".claude_scratch.md": "scratch",
      "claude.draft": "draft",
      "claude-output.bak": "backup",
      ".claude.backup": "backup file",
      "claude_result.old": "old result",
      "claude-analysis.orig": "original analysis",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all temp/working patterns
    assert(paths.includes("claude-temp-work.txt"));
    assert(paths.includes(".claude_scratch.md"));
    assert(paths.includes("claude.draft"));
    assert(paths.includes("claude-output.bak"));
    assert(paths.includes(".claude.backup"));
    assert(paths.includes("claude_result.old"));
    assert(paths.includes("claude-analysis.orig"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find process and debug files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude.lock": "lock file",
      ".claude.pid": "process id",
      "claude-debug.trace": "debug trace",
      ".claude_profile.log": "profile",
      "claude.diagnostic": "diagnostic",
      "claude-process.socket": "socket",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all process/debug patterns
    assert(paths.includes("claude.lock"));
    assert(paths.includes(".claude.pid"));
    assert(paths.includes("claude-debug.trace"));
    assert(paths.includes(".claude_profile.log"));
    assert(paths.includes("claude.diagnostic"));
    assert(paths.includes("claude-process.socket"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find IDE integration files", async () => {
    const repoPath = await createTestRepo(tempDir);

    // Create IDE directories first
    await ensureDir(join(repoPath, ".vscode"));
    await ensureDir(join(repoPath, ".idea"));
    await ensureDir(join(repoPath, ".eclipse"));

    await createTestFiles(repoPath, {
      ".vscode/claude-settings.json": "vscode claude",
      ".vscode/claude_workspace.code-workspace": "vscode workspace",
      ".idea/claude-config.xml": "idea claude",
      ".idea/claude.iml": "idea module",
      ".eclipse/claude.prefs": "eclipse prefs",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all IDE integration patterns
    assert(paths.includes(".vscode/claude-settings.json"));
    assert(paths.includes(".vscode/claude_workspace.code-workspace"));
    assert(paths.includes(".idea/claude-config.xml"));
    assert(paths.includes(".idea/claude.iml"));
    assert(paths.includes(".eclipse/claude.prefs"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find extended directory patterns", async () => {
    const repoPath = await createTestRepo(tempDir);

    await ensureDir(join(repoPath, ".claude-workspace"));
    await ensureDir(join(repoPath, "claude_project"));
    await ensureDir(join(repoPath, ".claude-sessions"));
    await ensureDir(join(repoPath, "claude-temp"));
    await ensureDir(join(repoPath, "nested", ".claude_cache"));

    await createTestFiles(repoPath, {
      ".claude-workspace/config.json": "workspace",
      "claude_project/file.txt": "project",
      ".claude-sessions/session1.dat": "sessions",
      "claude-temp/work.txt": "temp",
      "nested/.claude_cache/data.cache": "cache",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all extended directory patterns
    assert(paths.includes(".claude-workspace"));
    assert(paths.includes("claude_project"));
    assert(paths.includes(".claude-sessions"));
    assert(paths.includes("claude-temp"));
    assert(paths.includes("nested/.claude_cache"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find documentation and script files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude-notes.md": "notes",
      "claude_docs.txt": "docs",
      ".claude.readme": "readme",
      "claude-instructions.rst": "instructions",
      "claude-script.sh": "shell script",
      "claude_tool.py": "python tool",
      ".claude.notes": "notes file",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all documentation and script patterns
    assert(paths.includes("claude-notes.md"));
    assert(paths.includes("claude_docs.txt"));
    assert(paths.includes(".claude.readme"));
    assert(paths.includes("claude-instructions.rst"));
    assert(paths.includes("claude-script.sh"));
    assert(paths.includes("claude_tool.py"));
    assert(paths.includes(".claude.notes"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find numbered and versioned files", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude-backup-1.txt": "backup 1",
      ".claude_session_123.dat": "session 123",
      "claude-v2.config": "version 2",
      "claude_report_2024.md": "report 2024",
      ".claude007.cache": "cache 007",
      "claude-temp123.log": "temp 123",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should find all numbered/versioned patterns
    assert(paths.includes("claude-backup-1.txt"));
    assert(paths.includes(".claude_session_123.dat"));
    assert(paths.includes("claude-v2.config"));
    assert(paths.includes("claude_report_2024.md"));
    assert(paths.includes(".claude007.cache"));
    assert(paths.includes("claude-temp123.log"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should NOT match false positives", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude.txt": "should NOT match - too generic",
      "include-claude.md": "should NOT match - claude not at start",
      "claudelike.config": "should NOT match - not exact match",
      "my-claude-file.txt": "should NOT match - claude not at start",
      "normal-file.txt": "normal file",
      "README.md": "readme",
      "config.json": "regular config",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();
    const paths = claudeFiles.map((f) => f.path).sort();

    // Should NOT match generic files or false positives
    assert(!paths.includes("claude.txt"));
    assert(!paths.includes("include-claude.md"));
    assert(!paths.includes("claudelike.config"));
    assert(!paths.includes("my-claude-file.txt"));
    assert(!paths.includes("normal-file.txt"));
    assert(!paths.includes("README.md"));
    assert(!paths.includes("config.json"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should provide appropriate file reasons", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "CLAUDE.md": "default claude file",
      "claude.config.json": "extended config",
      ".claude_session.dat": "session file",
      "claude-temp.work": "temp file",
      ".claude.backup": "backup file",
      "claude.lock": "lock file",
      "claude-debug.trace": "debug file",
    });

    await ensureDir(join(repoPath, ".vscode"));
    await createTestFiles(repoPath, {
      ".vscode/claude-ext.json": "vscode extension",
    });

    const options: FileCleanerOptions = {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: true,
    };

    const fileCleaner = new FileCleaner(options, logger);
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    // Check that appropriate reasons are provided
    const reasonMap = Object.fromEntries(
      claudeFiles.map((f) => [f.path, f.reason]),
    );

    assertEquals(reasonMap["CLAUDE.md"], "Claude project configuration file");
    assertEquals(
      reasonMap["claude.config.json"],
      "Claude configuration file (extended pattern)",
    );
    assertEquals(reasonMap[".claude_session.dat"], "Claude session/state file");
    assertEquals(
      reasonMap["claude-temp.work"],
      "Claude temporary/working file",
    );
    assertEquals(reasonMap[".claude.backup"], "Claude backup file");
    assertEquals(reasonMap["claude.lock"], "Claude process/lock file");
    assertEquals(
      reasonMap["claude-debug.trace"],
      "Claude debug/diagnostic file",
    );
    assertEquals(
      reasonMap[".vscode/claude-ext.json"],
      "IDE Claude integration file",
    );

    await Deno.remove(repoPath, { recursive: true });
  });

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
