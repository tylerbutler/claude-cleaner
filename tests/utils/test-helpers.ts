/**
 * Test utilities and helper functions for Claude Cleaner testing
 */

import { assert, assertExists } from "@std/assert";
import { ensureDir, exists } from "@std/fs";
import { dirname, join } from "@std/path";
import { $ } from "dax";

export interface TestRepo {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * A test repository created inside its own dedicated parent directory. The
 * repo lives at `<parent>/repo`, so the tool's external bare-clone backup —
 * which is written as a *sibling* of the repo (`<repo>/../<backup>`) — lands
 * inside `parent` and is removed together with it on `cleanup()`. Integration
 * tests that run `--execute` must use this (rather than {@link createTestRepo},
 * whose repo is the temp-dir root) so backups never leak.
 */
export interface IsolatedRepo extends TestRepo {
  /** The dedicated parent directory containing the repo and any sibling backup. */
  parent: string;
}

/**
 * Creates an isolated, initialized Git repository at `<parent>/repo` (see
 * {@link IsolatedRepo}). Use for any test that executes history rewriting so
 * the sibling bare-clone backup is contained and cleaned up.
 */
export async function createIsolatedRepo(name: string): Promise<IsolatedRepo> {
  const parent = await Deno.makeTempDir({
    prefix: `claude-cleaner-test-${name}-`,
  });
  const repoPath = join(parent, "repo");
  await ensureDir(repoPath);
  await gitCmd(repoPath, ["init", "-b", "main"]);
  await gitCmd(repoPath, ["config", "user.email", "test@example.com"]);
  await gitCmd(repoPath, ["config", "user.name", "Test User"]);
  // Neutralize any developer/CI global gitignore (e.g. one ignoring *.log or
  // *.tmp) so tests that assert on tracked/detected files are hermetic and
  // reproducible regardless of the host's core.excludesFile. Uses a real
  // empty file for cross-platform safety.
  const emptyExcludes = join(parent, ".empty-gitignore");
  await Deno.writeTextFile(emptyExcludes, "");
  await gitCmd(repoPath, ["config", "core.excludesFile", emptyExcludes]);
  return {
    path: repoPath,
    parent,
    cleanup: async () => {
      try {
        await Deno.remove(parent, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Runs a `git` command in `repoPath`, returning stdout and throwing with the
 * captured stderr on failure. Shared by integration tests so each does not
 * re-implement the same spawn/decode/throw boilerplate.
 */
export async function gitCmd(
  repoPath: string,
  args: string[],
): Promise<string> {
  const result = await new Deno.Command("git", {
    args,
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`,
    );
  }
  return new TextDecoder().decode(result.stdout);
}

export interface CliResult {
  stdout: string;
  stderr: string;
  success: boolean;
  code: number;
}

/**
 * Runs the claude-cleaner CLI (`src/main.ts`) as a real subprocess — the same
 * production entry point compiled binaries use. `src/main.ts` is resolved to
 * an absolute path so the CLI can be launched from an arbitrary `cwd` (e.g.
 * the relative-repo-path backup test). `env` values are merged over the
 * inherited environment.
 */
export async function runCli(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  const mainModule = join(Deno.cwd(), "src", "main.ts");
  const cmdOptions: Deno.CommandOptions = {
    args: ["run", "--allow-all", mainModule, ...args],
    stdout: "piped",
    stderr: "piped",
  };
  if (options.cwd) {
    cmdOptions.cwd = options.cwd;
  }
  if (options.env) {
    cmdOptions.env = { ...Deno.env.toObject(), ...options.env };
  }
  const output = await new Deno.Command(Deno.execPath(), cmdOptions).output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
    code: output.code,
  };
}

/**
 * Resolves the operating system's temp-dir root (where `Deno.makeTempDir`
 * places entries). Used to isolate and inspect the tool's manifest temp dir
 * for leak checks by pointing the CLI subprocess's `TMPDIR` at a scratch dir.
 */
export async function osTempDir(): Promise<string> {
  const probe = await Deno.makeTempDir({ prefix: "cc-probe-" });
  const root = dirname(probe);
  await Deno.remove(probe, { recursive: true }).catch(() => {});
  return root;
}

/** Lists directory entry names in `dir` whose name starts with `prefix`. */
export async function entriesWithPrefix(
  dir: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.startsWith(prefix)) {
        names.push(entry.name);
      }
    }
  } catch {
    // Directory may not exist; treat as empty.
  }
  return names;
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
  await $`git init -b main`.cwd(tempDir);
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

  // On Windows, .bat and .cmd files must be executed through a shell
  const isWindowsBatch = Deno.build.os === "windows" &&
    (cmdName.endsWith(".bat") || cmdName.endsWith(".cmd"));

  let finalCmd: string;
  let finalArgs: string[];

  if (isWindowsBatch) {
    // Use cmd.exe to execute batch files on Windows
    finalCmd = "cmd";
    finalArgs = ["/c", cmdName, ...command.slice(1)];
  } else {
    finalCmd = cmdName;
    finalArgs = command.slice(1);
  }

  const options: Deno.CommandOptions = {
    args: finalArgs,
    env: { ...Deno.env.toObject(), PATH: newPath },
    stdout: "piped",
    stderr: "piped",
  };

  if (cwd) {
    options.cwd = cwd;
  }

  const proc = new Deno.Command(finalCmd, options);

  const result = await proc.output();

  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}
