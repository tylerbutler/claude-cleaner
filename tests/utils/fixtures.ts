/**
 * Git repository fixtures for testing Claude Cleaner
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { ClaudeArtifact, TestRepo } from "./test-helpers.ts";
import {
  addClaudeArtifacts,
  createCommitsWithClaudeTrailers,
  createTestRepo,
} from "./test-helpers.ts";

/**
 * Common Claude artifacts found in repositories
 */
export const COMMON_CLAUDE_ARTIFACTS: ClaudeArtifact[] = [
  {
    type: "file",
    path: "CLAUDE.md",
    content: `# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Guidelines
- Use TypeScript for all development
- Follow existing code patterns
`,
  },
  {
    type: "directory",
    path: ".claude",
  },
  {
    type: "file",
    path: ".claude/config.json",
    content: `{
  "version": "1.0",
  "settings": {
    "autoFormat": true,
    "linting": "enabled"
  }
}`,
  },
  {
    type: "file",
    path: ".vscode/claude.json",
    content: `{
  "claude.autoComplete": true,
  "claude.suggestions": "enabled"
}`,
  },
  {
    type: "file",
    path: "src/temp-claude-file.tmp",
    content: "Temporary file created by Claude",
  },
  {
    type: "file",
    path: ".clauderc",
    content: "# Claude configuration\nauto_format=true\n",
  },
];

/**
 * Creates a minimal test repository with basic structure
 */
export async function createMinimalRepo(): Promise<TestRepo> {
  const repo = await createTestRepo("minimal");

  // Add basic files
  await Deno.writeTextFile(join(repo.path, "README.md"), "# Test Repository\n");
  await Deno.writeTextFile(
    join(repo.path, "package.json"),
    `{
  "name": "test-repo",
  "version": "1.0.0"
}`,
  );

  return repo;
}

/**
 * Creates a repository with Claude artifacts but no commits
 */
export async function createRepoWithClaudeFiles(): Promise<TestRepo> {
  const repo = await createTestRepo("with-claude-files");

  // Add basic project structure
  await Deno.writeTextFile(join(repo.path, "README.md"), "# Test Repository\n");
  await ensureDir(join(repo.path, "src"));
  await Deno.writeTextFile(
    join(repo.path, "src/main.ts"),
    "console.log('Hello');\n",
  );

  // Add Claude artifacts
  await addClaudeArtifacts(repo.path, COMMON_CLAUDE_ARTIFACTS);

  return repo;
}

/**
 * Creates a repository with commits containing Claude trailers
 */
export async function createRepoWithClaudeCommits(): Promise<TestRepo> {
  const repo = await createTestRepo("with-claude-commits");

  // Add initial commit
  await Deno.writeTextFile(join(repo.path, "README.md"), "# Test Repository\n");

  // Create commits with Claude trailers
  await createCommitsWithClaudeTrailers(repo.path, [
    {
      message: "Initial commit",
      files: ["README.md"],
    },
    {
      message: "Add main functionality",
      files: ["src/main.ts"],
    },
    {
      message: "Fix bug in parsing logic",
      files: ["src/parser.ts"],
    },
    {
      message: "Update documentation",
      files: ["docs/api.md"],
    },
  ]);

  return repo;
}

/**
 * Creates a comprehensive test repository with both files and commits
 */
export async function createFullTestRepo(): Promise<TestRepo> {
  const repo = await createTestRepo("full-test");

  // Add basic project structure
  await ensureDir(join(repo.path, "src"));
  await ensureDir(join(repo.path, "docs"));
  await ensureDir(join(repo.path, ".vscode"));

  // Add regular project files
  await Deno.writeTextFile(
    join(repo.path, "README.md"),
    "# Full Test Repository\n",
  );
  await Deno.writeTextFile(
    join(repo.path, "package.json"),
    `{
  "name": "full-test-repo",
  "version": "1.0.0",
  "scripts": {
    "test": "deno test"
  }
}`,
  );

  // Add Claude artifacts
  await addClaudeArtifacts(repo.path, COMMON_CLAUDE_ARTIFACTS);

  // Create commits with Claude trailers
  await createCommitsWithClaudeTrailers(repo.path, [
    {
      message: "Initial project setup",
      files: ["README.md", "package.json"],
    },
    {
      message: "Add core functionality",
      files: ["src/main.ts", "src/utils.ts"],
    },
    {
      message: "Implement advanced features",
      files: ["src/advanced.ts"],
    },
    {
      message: "Add comprehensive documentation",
      files: ["docs/README.md", "docs/api.md"],
    },
    {
      message: "Fix critical security vulnerability",
      files: ["src/security.ts"],
    },
  ]);

  return repo;
}

/**
 * Creates a repository that simulates edge cases
 */
export async function createEdgeCaseRepo(): Promise<TestRepo> {
  const repo = await createTestRepo("edge-cases");

  // Files with special characters in names
  await ensureDir(join(repo.path, "special chars"));
  await Deno.writeTextFile(
    join(repo.path, "special chars", "file with spaces.txt"),
    "File with spaces in name",
  );

  // Unicode file names
  await Deno.writeTextFile(join(repo.path, "文件.txt"), "Unicode filename");

  // Large CLAUDE.md file
  const largeClaude = "# Large CLAUDE.md\n" + "A".repeat(10000) + "\n";
  await Deno.writeTextFile(join(repo.path, "CLAUDE.md"), largeClaude);

  // Nested .claude directories
  await ensureDir(join(repo.path, "deep", "nested", ".claude"));
  await Deno.writeTextFile(
    join(repo.path, "deep", "nested", ".claude", "config.json"),
    '{"nested": true}',
  );

  // Binary files that might confuse text processing
  const binaryData = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]);
  await Deno.writeFile(join(repo.path, "image.png"), binaryData);

  // Commit with very long message
  const longMessage = "A".repeat(1000);
  await createCommitsWithClaudeTrailers(repo.path, [
    {
      message: `Long commit message: ${longMessage}`,
      files: ["README.md"],
    },
  ]);

  return repo;
}

/**
 * Creates a repository that's already partially cleaned
 */
export async function createPartiallyCleanedRepo(): Promise<TestRepo> {
  const repo = await createTestRepo("partially-cleaned");

  // Add some files without Claude artifacts
  await Deno.writeTextFile(
    join(repo.path, "README.md"),
    "# Clean Repository\n",
  );
  await ensureDir(join(repo.path, "src"));
  await Deno.writeTextFile(
    join(repo.path, "src/main.ts"),
    "console.log('Clean code');\n",
  );

  // Add some Claude artifacts
  const claudeMd = COMMON_CLAUDE_ARTIFACTS[0];
  const claudeConfig = COMMON_CLAUDE_ARTIFACTS[2];

  if (claudeMd && claudeConfig) {
    await addClaudeArtifacts(repo.path, [
      claudeMd, // CLAUDE.md
      claudeConfig, // .claude/config.json
    ]);
  }

  // Mix of clean and Claude commits
  await createCommitsWithClaudeTrailers(repo.path, [
    {
      message: "Initial commit (clean)",
      files: ["README.md"],
    },
  ]);

  // Add a clean commit without trailers
  await Deno.writeTextFile(join(repo.path, "clean-file.txt"), "Clean content");
  const { $ } = await import("dax");
  await $`git add .`.cwd(repo.path);
  await $`git commit -m "Clean commit without trailers"`.cwd(repo.path);

  return repo;
}

/**
 * Creates a repository with no Claude artifacts (control case)
 */
export async function createCleanRepo(): Promise<TestRepo> {
  const repo = await createTestRepo("clean");

  // Add regular project files
  await Deno.writeTextFile(
    join(repo.path, "README.md"),
    "# Clean Repository\n",
  );
  await Deno.writeTextFile(
    join(repo.path, "package.json"),
    `{
  "name": "clean-repo",
  "version": "1.0.0"
}`,
  );

  await ensureDir(join(repo.path, "src"));
  await Deno.writeTextFile(
    join(repo.path, "src/main.ts"),
    `
export function main() {
  console.log("Hello, world!");
}
`,
  );

  // Create commits without any Claude artifacts
  const { $ } = await import("dax");
  await $`git add .`.cwd(repo.path);
  await $`git commit -m "Initial commit"`.cwd(repo.path);

  await Deno.writeTextFile(
    join(repo.path, "src/utils.ts"),
    `
export function add(a: number, b: number): number {
  return a + b;
}
`,
  );
  await $`git add .`.cwd(repo.path);
  await $`git commit -m "Add utility functions"`.cwd(repo.path);

  return repo;
}
