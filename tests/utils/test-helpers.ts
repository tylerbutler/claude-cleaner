/**
 * Test utilities and helper functions for Claude Cleaner testing
 */

import { assert, assertExists } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { join } from "@std/path";
import { $ } from "dax";

export interface TestRepo {
  path: string;
  cleanup: () => Promise<void>;
}

export interface ClaudeArtifact {
  type: "file" | "directory";
  path: string;
  content?: string;
}

/**
 * Creates a temporary Git repository for testing
 */
export async function createTestRepo(name: string): Promise<TestRepo> {
  const tempDir = await Deno.makeTempDir({
    prefix: `claude-cleaner-test-${name}-`,
  });

  // Initialize Git repository
  await $`git init`.cwd(tempDir);
  await $`git config user.email "test@example.com"`.cwd(tempDir);
  await $`git config user.name "Test User"`.cwd(tempDir);

  return {
    path: tempDir,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Adds Claude artifacts to a test repository
 */
export async function addClaudeArtifacts(
  repoPath: string,
  artifacts: ClaudeArtifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    const fullPath = join(repoPath, artifact.path);

    if (artifact.type === "directory") {
      await ensureDir(fullPath);
      // Add a file inside the directory so Git tracks it
      await Deno.writeTextFile(join(fullPath, ".gitkeep"), "");
    } else {
      // Ensure parent directory exists
      const parentDir = join(fullPath, "..");
      await ensureDir(parentDir);
      await Deno.writeTextFile(fullPath, artifact.content || "");
    }
  }
}

/**
 * Creates commits with Claude trailers for testing
 */
export async function createCommitsWithClaudeTrailers(
  repoPath: string,
  commits: Array<{ message: string; files?: string[] }>,
): Promise<void> {
  for (const commit of commits) {
    // Create or modify files if specified
    if (commit.files) {
      for (const file of commit.files) {
        const filePath = join(repoPath, file);
        const parentDir = join(filePath, "..");
        await ensureDir(parentDir);
        await Deno.writeTextFile(filePath, `Content for ${file}\n`);
      }
      await $`git add .`.cwd(repoPath);
    }

    // Create commit with Claude trailer
    const commitMessage = `${commit.message}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`;

    await $`git commit --allow-empty -m ${commitMessage}`.cwd(repoPath);
  }
}

/**
 * Verifies that a Git repository exists and is valid
 */
export async function assertValidGitRepo(repoPath: string): Promise<void> {
  assertExists(repoPath);
  assert(await exists(join(repoPath, ".git")));

  // Verify we can run git commands
  const result = await $`git status`.cwd(repoPath);
  assert(result.code === 0);
}

/**
 * Gets all files in a Git repository (tracked and untracked)
 */
export async function getRepoFiles(repoPath: string): Promise<string[]> {
  const result = await $`git ls-files`.cwd(repoPath).stdout("piped");
  const trackedFiles = result.stdout.trim().split("\n").filter(Boolean);

  // Also get untracked files
  const untrackedResult = await $`git ls-files --others --exclude-standard`
    .cwd(repoPath)
    .stdout("piped");
  const untrackedFiles = untrackedResult.stdout
    .trim()
    .split("\n")
    .filter(Boolean);

  return [...trackedFiles, ...untrackedFiles];
}

/**
 * Gets all commit messages in the repository
 */
export async function getCommitMessages(repoPath: string): Promise<string[]> {
  const result = await $`git log --pretty=format:%B%n---COMMIT-END---`
    .cwd(repoPath)
    .stdout("piped");
  return result.stdout
    .split("---COMMIT-END---")
    .map((msg) => msg.trim())
    .filter(Boolean);
}

/**
 * Checks if a file contains Claude artifacts
 */
export function hasClaudeArtifacts(content: string): boolean {
  const claudePatterns = [
    /🤖 Generated with \[Claude Code\]/,
    /Co-Authored-By: Claude <noreply@anthropic\.com>/,
    /Generated with Claude/i,
  ];

  return claudePatterns.some((pattern) => pattern.test(content));
}

/**
 * Assertion helper for verifying Claude artifacts are removed
 */
export function assertNoClaudeArtifacts(
  content: string,
  context?: string,
): void {
  if (hasClaudeArtifacts(content)) {
    throw new Error(
      `Found Claude artifacts in ${context || "content"}: ${content.substring(0, 200)}...`,
    );
  }
}

/**
 * Creates a mock external tool for testing
 */
export async function createMockTool(
  name: string,
  script: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir({ prefix: `mock-tool-${name}-` });
  const toolPath = join(tempDir, name);

  await Deno.writeTextFile(toolPath, script);
  await Deno.chmod(toolPath, 0o755);

  return {
    path: toolPath,
    cleanup: async () => {
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Cross-platform helper to run commands with specific PATH
 */
export async function runWithPath(
  command: string[],
  additionalPaths: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const currentPath = Deno.env.get("PATH") || "";
  const newPath = [...additionalPaths, currentPath].join(
    Deno.build.os === "windows" ? ";" : ":",
  );

  const cmdName = command[0];
  if (!cmdName) {
    throw new Error("Command name is required");
  }

  const options: Deno.CommandOptions = {
    args: command.slice(1),
    env: { ...Deno.env.toObject(), PATH: newPath },
    stdout: "piped",
    stderr: "piped",
  };

  if (cwd) {
    options.cwd = cwd;
  }

  const proc = new Deno.Command(cmdName, options);

  const result = await proc.output();

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
