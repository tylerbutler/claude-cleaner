/**
 * Unit tests for the file cleaner.
 *
 * These exercise the file cleaner's public behavior against real Git repos:
 *   - `detectClaudeFiles()` scans *history* (not just the working tree) and
 *     recognizes Claude artifacts by exact path/basename while preserving
 *     unrelated files — including files that merely share a basename with a
 *     Claude artifact, and non-ASCII / space-containing paths (a regression
 *     guard for Git's default C-style `--name-only` quoting).
 *   - `buildRemovalPlan()` canonicalizes, de-duplicates, sorts, and
 *     descendant-prunes detected paths into an exact-path plan.
 *   - repository validation and pattern validation propagate `AppError`s.
 *   - dry-run planning surfaces the plan without mutating the repository.
 *   - `cleanFiles()` refuses to rewrite a dirty tracked working tree.
 *
 * Execute-mode history rewriting is covered end-to-end through the real CLI in
 * `tests/integration/exact-path-removal.test.ts` (the internal `--index-filter`
 * self-invocation resolves `src/main.ts`, not the test module, so it cannot be
 * driven in-process here).
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { createIsolatedRepo, gitCmd } from "../utils/test-helpers.ts";
import { type ClaudeFile, FileCleaner, type FileCleanerOptions } from "../../src/file-cleaner.ts";
import { AppError, type Logger } from "../../src/utils.ts";

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  verbose() {},
  debug() {},
};

function makeCleaner(
  repoPath: string,
  overrides: Partial<FileCleanerOptions> = {},
): FileCleaner {
  return new FileCleaner(
    {
      dryRun: true,
      verbose: false,
      repoPath,
      createBackup: false,
      includeDirectories: [],
      excludeDefaults: false,
      includeAllCommonPatterns: false,
      includeInstructionFiles: false,
      ...overrides,
    },
    silentLogger,
  );
}

/** Writes a file (creating parent dirs), stages everything, and commits. */
async function commitFiles(
  repoPath: string,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, rel);
    await Deno.mkdir(join(full, ".."), { recursive: true });
    await Deno.writeTextFile(full, content);
  }
  await gitCmd(repoPath, ["add", "-A"]);
  await gitCmd(repoPath, ["commit", "-m", message]);
}

Deno.test("File Cleaner - detectClaudeFiles scans history by exact path", async (t) => {
  await t.step(
    "detects the .claude directory (and its contents) and .vscode/claude.json",
    async () => {
      const repo = await createIsolatedRepo("detect-basic");
      try {
        await commitFiles(repo.path, {
          "README.md": "# project\n",
          "src/main.ts": "console.log('hi')\n",
          ".claude/config.json": "{}\n",
          ".claude/state/session.json": "{}\n",
          ".vscode/claude.json": "{}\n",
        }, "add files");

        const detected = (await makeCleaner(repo.path).detectClaudeFiles())
          .map((f) => f.path);

        assert(detected.includes(".claude"), "the .claude directory is detected");
        assert(
          detected.includes(".claude/config.json"),
          "files inside .claude are detected",
        );
        assert(
          detected.includes(".vscode/claude.json"),
          ".vscode/claude.json is detected",
        );
        // Unrelated project files are never detected.
        assert(!detected.includes("README.md"), "README.md preserved");
        assert(!detected.includes("src/main.ts"), "source files preserved");
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "preserves CLAUDE.md by default and detects it only with --include-instruction-files",
    async () => {
      const repo = await createIsolatedRepo("detect-claudemd");
      try {
        await commitFiles(repo.path, {
          "CLAUDE.md": "# instructions\n",
          "docs/CLAUDE.md": "# nested instructions\n",
          "README.md": "# project\n",
        }, "add docs");

        const byDefault = (await makeCleaner(repo.path).detectClaudeFiles())
          .map((f) => f.path);
        assert(
          !byDefault.includes("CLAUDE.md") && !byDefault.includes("docs/CLAUDE.md"),
          "CLAUDE.md instruction files are preserved by default",
        );

        const withFlag = (await makeCleaner(repo.path, {
          includeInstructionFiles: true,
        }).detectClaudeFiles()).map((f) => f.path);
        assert(withFlag.includes("CLAUDE.md"), "root CLAUDE.md detected with the flag");
        assert(
          withFlag.includes("docs/CLAUDE.md"),
          "nested CLAUDE.md detected with the flag",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "does not flag unrelated files that merely share a basename with a Claude artifact",
    async () => {
      const repo = await createIsolatedRepo("detect-basename");
      try {
        await commitFiles(repo.path, {
          ".claude/config.json": "{}\n",
          "src/config.json": "{}\n", // same basename, unrelated location
          "claude.txt": "not an artifact\n", // explicitly excluded generic name
        }, "add files");

        const detected = (await makeCleaner(repo.path).detectClaudeFiles())
          .map((f) => f.path);

        assert(detected.includes(".claude/config.json"), "the Claude file is detected");
        assert(
          !detected.includes("src/config.json"),
          "the same-basename sibling is preserved",
        );
        assert(!detected.includes("claude.txt"), "a generic claude.txt is preserved");
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "detects artifacts that were deleted from the working tree but remain in history",
    async () => {
      const repo = await createIsolatedRepo("detect-history");
      try {
        await commitFiles(repo.path, { ".claude/config.json": "{}\n" }, "add claude");
        // Remove the artifact from the current tree and commit the deletion.
        await gitCmd(repo.path, ["rm", "-r", ".claude"]);
        await gitCmd(repo.path, ["commit", "-m", "remove claude from tree"]);

        const detected = (await makeCleaner(repo.path).detectClaudeFiles())
          .map((f) => f.path);
        assert(
          detected.includes(".claude/config.json"),
          "history-only artifacts are still detected for rewriting",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "handles non-ASCII and space-containing paths verbatim (Git quoting regression)",
    async () => {
      const repo = await createIsolatedRepo("detect-special");
      try {
        await commitFiles(repo.path, {
          ".claude/café.json": "x\n", // non-ASCII, only file inside .claude
          "spéc/CLAUDE.md": "y\n", // non-ASCII directory
          "claude-temp draft.txt": "z\n", // space in the name
          "src/keep.txt": "keep\n",
        }, "add special-character files");

        const detected = (await makeCleaner(repo.path, {
          includeInstructionFiles: true,
        }).detectClaudeFiles()).map((f) => f.path);

        // Paths are literal UTF-8, never Git's quoted/escaped form
        // (e.g. `".claude/caf\303\251.json"`).
        assert(
          detected.includes(".claude/café.json"),
          `non-ASCII path under .claude detected literally, got: ${detected.join(", ")}`,
        );
        assert(
          detected.includes("spéc/CLAUDE.md"),
          `CLAUDE.md in a non-ASCII directory detected literally, got: ${detected.join(", ")}`,
        );
        assert(
          detected.includes("claude-temp draft.txt"),
          `space-containing path detected literally, got: ${detected.join(", ")}`,
        );
        for (const p of detected) {
          assert(
            !p.startsWith('"') && !/\\\d{3}/.test(p),
            `detected path must not be Git-quoted/escaped: ${p}`,
          );
        }
        assert(!detected.includes("src/keep.txt"), "unrelated file preserved");
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step("finds nothing in a repository with no Claude artifacts", async () => {
    const repo = await createIsolatedRepo("detect-clean");
    try {
      await commitFiles(repo.path, {
        "README.md": "# clean\n",
        "src/main.ts": "export const x = 1;\n",
      }, "clean commit");

      const detected = await makeCleaner(repo.path).detectClaudeFiles();
      assertEquals(detected, [], "a clean repo yields an empty detection set");
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("File Cleaner - Removal Plan (exact-path normalization)", async (t) => {
  const cleaner = makeCleaner(".");

  const file = (path: string, type: "file" | "directory" = "file"): ClaudeFile => ({
    path,
    type,
    reason: "test",
  });

  await t.step("drops descendant entries covered by a selected directory", () => {
    const plan = cleaner.buildRemovalPlan([
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
    const plan = cleaner.buildRemovalPlan([
      file(".claude/config.json"),
    ]);
    assertEquals(plan, [".claude/config.json"]);
    assert(!plan.includes("src/config.json"));
  });

  await t.step("keeps distinct same-basename artifacts at different paths", () => {
    const plan = cleaner.buildRemovalPlan([
      file("docs/CLAUDE.md"),
      file("CLAUDE.md"),
    ]);
    // Both exact paths are preserved (sorted), not collapsed to one basename.
    assertEquals(plan, ["CLAUDE.md", "docs/CLAUDE.md"]);
  });

  await t.step("does not prune sibling paths that merely share a prefix", () => {
    const plan = cleaner.buildRemovalPlan([
      file(".claude", "directory"),
      file(".clauderc"),
    ]);
    // ".clauderc" is not a descendant of ".claude/" and must be retained.
    assertEquals(plan, [".claude", ".clauderc"]);
  });

  await t.step("deduplicates repeated paths", () => {
    const plan = cleaner.buildRemovalPlan([
      file("claudedocs", "directory"),
      file("claudedocs", "directory"),
      file("claudedocs/notes.md"),
    ]);
    assertEquals(plan, ["claudedocs"]);
  });

  await t.step("normalizes ./ prefixes and trailing slashes before deduping", () => {
    const plan = cleaner.buildRemovalPlan([
      file("./.claude/", "directory"),
      file(".claude"),
    ]);
    assertEquals(plan, [".claude"]);
  });

  await t.step("keeps independent directories and prunes each one's descendants", () => {
    const plan = cleaner.buildRemovalPlan([
      file(".serena", "directory"),
      file(".serena/data.json"),
      file(".claude", "directory"),
      file(".claude/config.json"),
    ]);
    assertEquals(plan, [".claude", ".serena"]);
  });

  await t.step("returns an empty plan for no files", () => {
    assertEquals(cleaner.buildRemovalPlan([]), []);
  });
});

Deno.test("File Cleaner - repository and pattern validation errors", async (t) => {
  await t.step("validateRepository throws NOT_GIT_REPO for a non-Git directory", async () => {
    const dir = await Deno.makeTempDir({ prefix: "claude-cleaner-nonrepo-" });
    try {
      await assertRejects(
        () => makeCleaner(dir).validateRepository(),
        AppError,
        "Not a Git repository",
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("validateRepository throws EMPTY_REPO for a repo with no commits", async () => {
    const repo = await createIsolatedRepo("empty");
    try {
      const error = await assertRejects(
        () => makeCleaner(repo.path).validateRepository(),
        AppError,
      );
      assertEquals((error as AppError).code, "EMPTY_REPO");
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("detectClaudeFiles rejects unsafe --include-dirs patterns", async () => {
    const repo = await createIsolatedRepo("bad-pattern");
    try {
      await commitFiles(repo.path, { "README.md": "# x\n" }, "init");
      for (const bad of ["../escape", "/abs", "nested/dir", "*"]) {
        const error = await assertRejects(
          () => makeCleaner(repo.path, { includeDirectories: [bad] }).detectClaudeFiles(),
          AppError,
        );
        assertEquals((error as AppError).code, "INVALID_PATTERN");
      }
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("File Cleaner - dry-run planning does not mutate the repository", async (t) => {
  await t.step(
    "removeFiles(dry-run) leaves history and tracked files untouched",
    async () => {
      const repo = await createIsolatedRepo("dry-run");
      try {
        await commitFiles(repo.path, {
          ".claude/config.json": "{}\n",
          "src/config.json": "{}\n",
        }, "add files");

        const headBefore = (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim();
        const cleaner = makeCleaner(repo.path, { dryRun: true });
        const detected = await cleaner.detectClaudeFiles();
        await cleaner.removeFiles(detected); // dry-run: preview only

        // No new commits, no rewrite, and every file still tracked.
        assertEquals(
          (await gitCmd(repo.path, ["rev-parse", "HEAD"])).trim(),
          headBefore,
          "dry-run must not rewrite history",
        );
        const tracked = (await gitCmd(repo.path, ["ls-files"])).trim().split("\n");
        assert(tracked.includes(".claude/config.json"), "artifact still tracked in dry-run");
        assert(tracked.includes("src/config.json"), "sibling still tracked in dry-run");
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("File Cleaner - Working tree safety", async (t) => {
  await t.step(
    "cleanFiles refuses to rewrite history when tracked files are dirty",
    async () => {
      const repo = await createIsolatedRepo("dirty");
      try {
        await commitFiles(repo.path, {
          "README.md": "# readme\n",
          ".claude/config.json": "{}\n",
        }, "add claude artifacts");

        // Dirty a tracked file (unstaged change) so filter-branch would refuse.
        await Deno.writeTextFile(join(repo.path, "README.md"), "# changed\n");

        const cleaner = makeCleaner(repo.path, { dryRun: false });

        const error = await assertRejects(
          () => cleaner.cleanFiles(),
          AppError,
        );
        assertEquals((error as AppError).code, "WORKING_TREE_DIRTY");
      } finally {
        await repo.cleanup();
      }
    },
  );
});
