/**
 * Integration tests for --include-all-common-patterns CLI flag
 */

import { assert } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

async function createTestRepo(tempDir: string): Promise<string> {
  const repoPath = join(tempDir, "test-repo");
  await ensureDir(repoPath);

  // Initialize Git repo
  const git = async (cmd: string) => {
    const process = new Deno.Command("git", {
      args: cmd.split(" "),
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await process.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Git command failed: ${cmd}\n${stderr}`);
    }
  };

  await git("init");
  await git("config user.name Test");
  await git("config user.email test@example.com");

  // Create initial commit
  await Deno.writeTextFile(join(repoPath, "README.md"), "# Test Repo");
  await git("add README.md");
  await git("commit -m Initial");

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
      stdout: "piped",
      stderr: "piped",
    });
    const result = await process.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      throw new Error(`Git command failed: ${args.join(" ")}\n${stderr}`);
    }
  };

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(repoPath, filePath);
    await ensureDir(join(fullPath, ".."));
    await Deno.writeTextFile(fullPath, content);
  }

  // Commit all files to git history so they can be detected
  await git(["add", "-A"]);
  await git(["commit", "-m", "Add test files"]);
}

async function runClaude(
  args: string[],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await cmd.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);

  return {
    stdout,
    stderr,
    success: result.success,
  };
}

Deno.test("CLI --include-all-common-patterns Integration", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-cli-test" });

  await t.step("should reject conflicting flags", async () => {
    const repoPath = await createTestRepo(tempDir);

    const result = await runClaude(
      [repoPath, "--include-all-common-patterns", "--no-defaults", "--files-only"],
    );

    assert(!result.success, "Should fail with conflicting flags");
    assert(
      result.stderr.includes("cannot be used together"),
      "Should show conflict error message",
    );

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find comprehensive patterns in dry-run", async () => {
    const repoPath = await createTestRepo(tempDir);

    // Create various Claude files
    await createTestFiles(repoPath, {
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",
      "claude.config.json": "{}",
      "claude-session-123.dat": "session",
      ".claude_temp.work": "temp work",
      "claude.lock": "lock file",
      "claude-debug.trace": "debug",
      ".vscode/claude.json": "{}",
    });

    // Ensure .vscode dir exists
    await ensureDir(join(repoPath, ".vscode"));
    await Deno.writeTextFile(join(repoPath, ".vscode/claude.json"), "{}");

    const result = await runClaude(
      [repoPath, "--include-all-common-patterns", "--files-only", "--verbose"],
    );

    assert(result.success, `Command should succeed. stderr: ${result.stderr}`);

    // Should show it's using comprehensive patterns
    assert(
      result.stdout.includes("comprehensive pattern matching"),
      "Should indicate comprehensive pattern matching",
    );

    // Should find all the different types of patterns
    assert(result.stdout.includes("CLAUDE.md"));
    assert(result.stdout.includes(".claude"));
    assert(result.stdout.includes("claude.config.json"));
    assert(result.stdout.includes("claude-session-123.dat"));
    assert(result.stdout.includes(".claude_temp.work"));
    assert(result.stdout.includes("claude.lock"));
    assert(result.stdout.includes("claude-debug.trace"));
    assert(result.stdout.includes(".vscode/claude.json"));

    // Should show appropriate reasons for different pattern types
    assert(result.stdout.includes("Claude project configuration file"));
    assert(
      result.stdout.includes("Claude configuration file (extended pattern)"),
    );
    assert(result.stdout.includes("Claude session/state file"));
    assert(result.stdout.includes("Claude temporary/working file"));
    assert(result.stdout.includes("Claude process/lock file"));

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step(
    "should work with regular defaults when flag not used",
    async () => {
      const repoPath = await createTestRepo(tempDir);

      // Create both default and extended patterns
      await createTestFiles(repoPath, {
        "CLAUDE.md": "# Claude config",
        ".claude/settings.json": "{}",
        "claude.config.json": "{}", // This should NOT be found without the flag
        "claude-session-123.dat": "session", // This should NOT be found without the flag
      });

      const result = await runClaude(
        [repoPath, "--files-only", "--verbose"],
      );

      assert(
        result.success,
        `Command should succeed. stderr: ${result.stderr}`,
      );

      // Should find default patterns
      assert(result.stdout.includes("CLAUDE.md"));
      assert(result.stdout.includes(".claude"));

      // Should NOT find extended patterns
      assert(!result.stdout.includes("claude.config.json"));
      assert(!result.stdout.includes("claude-session-123.dat"));

      await Deno.remove(repoPath, { recursive: true });
    },
  );

  await t.step("should show help for the new flag", async () => {
    const result = await runClaude(["--help"]);

    assert(result.success, "Help command should succeed");
    assert(
      result.stdout.includes("--include-all-common-patterns"),
      "Should show the new flag in help",
    );
    assert(
      result.stdout.includes("ALL known common Claude patterns"),
      "Should show descriptive help text",
    );
    assert(
      result.stdout.includes("complete cleanup"),
      "Should mention complete cleanup use case",
    );

    // Should not conflict with other options in help display
    assert(result.stdout.includes("--no-defaults"));
    assert(result.stdout.includes("--files-only"));
    assert(result.stdout.includes("--commits-only"));
  });

  await t.step("should work with other compatible flags", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      "claude.config.json": "{}",
      "claude-session.dat": "session",
      "normal-file.txt": "normal",
    });

    // Test with --verbose
    const result1 = await runClaude(
      [repoPath, "--include-all-common-patterns", "--files-only", "--verbose"],
    );

    assert(result1.success, "Should work with --verbose");
    assert(result1.stdout.includes("claude.config.json"));

    // Test with --files-only
    const result2 = await runClaude(
      [repoPath, "--include-all-common-patterns", "--files-only"],
    );

    assert(result2.success, "Should work with --files-only");

    await Deno.remove(repoPath, { recursive: true });
  });

  await t.step("should find more files than default mode", async () => {
    const repoPath = await createTestRepo(tempDir);

    await createTestFiles(repoPath, {
      // Default patterns
      "CLAUDE.md": "# Claude config",
      ".claude/settings.json": "{}",

      // Extended patterns (only found with --include-all-common-patterns)
      "claude.config.json": "{}",
      "claude-session-active.dat": "session",
      ".claude_temp.work": "temp",
      "claude.lock": "lock",
      "claude-debug.log": "debug",
    });

    // Run without the flag
    const resultDefault = await runClaude(
      [repoPath, "--files-only", "--verbose"],
    );

    // Run with the flag
    const resultAll = await runClaude(
      [repoPath, "--include-all-common-patterns", "--files-only", "--verbose"],
    );

    assert(
      resultDefault.success && resultAll.success,
      "Both commands should succeed",
    );

    // Count files found
    const defaultFileCount = (resultDefault.stdout.match(/📄|📂/g) || [])
      .length;
    const allFileCount = (resultAll.stdout.match(/📄|📂/g) || []).length;

    assert(
      allFileCount > defaultFileCount,
      `All patterns mode should find more files. Default: ${defaultFileCount}, All: ${allFileCount}`,
    );

    // Verify specific extended patterns are only found with the flag
    assert(!resultDefault.stdout.includes("claude.config.json"));
    assert(resultAll.stdout.includes("claude.config.json"));

    assert(!resultDefault.stdout.includes("claude-session-active.dat"));
    assert(resultAll.stdout.includes("claude-session-active.dat"));

    await Deno.remove(repoPath, { recursive: true });
  });

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});
