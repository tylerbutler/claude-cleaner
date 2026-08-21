/**
 * Unit tests for the internal filter dispatch/self-invocation seam
 * (src/internal-filter.ts).
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  batchExactPaths,
  buildSelfInvocationCommand,
  buildSelfInvocationCommandForMode,
  filterCommitMessage,
  INTERNAL_FILTER_MARKER,
  isInternalFilterInvocation,
  parseInternalFilterArgs,
  readManifestFile,
  removeExactPaths,
  resolveSelfInvocation,
  runInternalFilter,
} from "../../src/internal-filter.ts";
import { AppError, escapeShellArg } from "../../src/utils.ts";
import { addClaudeArtifacts, createTestRepo } from "../utils/test-helpers.ts";

/** `git rm --cached` only untracks a path from the index; it deliberately
 * leaves the working tree file in place (matching `git filter-branch
 * --index-filter` semantics). Assertions must therefore check the tracked
 * file list, not the working tree. */
async function getTrackedFiles(repoPath: string): Promise<string[]> {
  const cmd = new Deno.Command("git", { args: ["ls-files"], cwd: repoPath, stdout: "piped" });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean);
}

Deno.test("isInternalFilterInvocation", async (t) => {
  await t.step("detects the internal marker as the first argument", () => {
    assert(isInternalFilterInvocation([INTERNAL_FILTER_MARKER, "msg-filter"]));
  });

  await t.step("returns false for normal user-facing arguments", () => {
    assert(!isInternalFilterInvocation([]));
    assert(!isInternalFilterInvocation(["check-deps"]));
    assert(!isInternalFilterInvocation(["--execute", "."]));
    assert(!isInternalFilterInvocation(["."]));
  });
});

Deno.test("parseInternalFilterArgs", async (t) => {
  await t.step("parses msg-filter mode with no extra args", () => {
    const parsed = parseInternalFilterArgs(["msg-filter"]);
    assertEquals(parsed.mode, "msg-filter");
    assertEquals(parsed.rest, []);
  });

  await t.step("parses index-filter mode with a manifest path", () => {
    const parsed = parseInternalFilterArgs(["index-filter", "/tmp/manifest"]);
    assertEquals(parsed.mode, "index-filter");
    assertEquals(parsed.rest, ["/tmp/manifest"]);
  });

  await t.step("throws AppError for an unknown mode", () => {
    assertThrows(
      () => parseInternalFilterArgs(["bogus-mode"]),
      AppError,
      "Unknown internal filter mode",
    );
  });

  await t.step("throws AppError when no mode is provided", () => {
    assertThrows(
      () => parseInternalFilterArgs([]),
      AppError,
      "Unknown internal filter mode",
    );
  });
});

/** `resolveSelfInvocation` converts a `file://` main-module URL into a native
 * path via `fromFileUrl`, so the expected script argument is platform-specific:
 * `\repo\src\main.ts` on Windows, `/repo/src/main.ts` elsewhere. */
const MAIN_MODULE_URL = "file:///repo/src/main.ts";
const EXPECTED_SCRIPT_PATH = Deno.build.os === "windows"
  ? "\\repo\\src\\main.ts"
  : "/repo/src/main.ts";

Deno.test("resolveSelfInvocation - deno run (non-standalone)", async (t) => {
  await t.step("re-supplies the deno executable, run, permissions, and script path", () => {
    const invocation = resolveSelfInvocation("msg-filter", [], {
      execPath: "/usr/bin/deno",
      mainModuleUrl: MAIN_MODULE_URL,
      standalone: false,
    });

    assertEquals(invocation.execPath, "/usr/bin/deno");
    assertEquals(invocation.args, [
      "run",
      "--allow-all",
      EXPECTED_SCRIPT_PATH,
      INTERNAL_FILTER_MARKER,
      "msg-filter",
    ]);
  });

  await t.step("passes through extra args (e.g. a manifest path) after the mode", () => {
    const invocation = resolveSelfInvocation("index-filter", ["/tmp/manifest"], {
      execPath: "/usr/bin/deno",
      mainModuleUrl: MAIN_MODULE_URL,
      standalone: false,
    });

    assertEquals(invocation.args, [
      "run",
      "--allow-all",
      EXPECTED_SCRIPT_PATH,
      INTERNAL_FILTER_MARKER,
      "index-filter",
      "/tmp/manifest",
    ]);
  });

  await t.step("keeps non-file mainModule specifiers as-is (e.g. remote script URLs)", () => {
    const invocation = resolveSelfInvocation("msg-filter", [], {
      execPath: "/usr/bin/deno",
      mainModuleUrl: "https://example.com/main.ts",
      standalone: false,
    });

    assert(invocation.args.includes("https://example.com/main.ts"));
  });
});

Deno.test("resolveSelfInvocation - deno compile (standalone)", async (t) => {
  await t.step("re-invokes the compiled binary directly with no run/script args", () => {
    const invocation = resolveSelfInvocation("msg-filter", [], {
      execPath: "/opt/claude-cleaner",
      standalone: true,
    });

    assertEquals(invocation.execPath, "/opt/claude-cleaner");
    assertEquals(invocation.args, [INTERNAL_FILTER_MARKER, "msg-filter"]);
  });

  await t.step("does not require a mainModuleUrl override", () => {
    const invocation = resolveSelfInvocation("index-filter", ["/tmp/manifest"], {
      execPath: "/opt/claude-cleaner",
      standalone: true,
    });

    assertEquals(invocation.args, [
      INTERNAL_FILTER_MARKER,
      "index-filter",
      "/tmp/manifest",
    ]);
  });
});

Deno.test("buildSelfInvocationCommand", async (t) => {
  await t.step("shell-escapes every token of the resolved invocation", () => {
    const invocation = resolveSelfInvocation("index-filter", ["/tmp/my manifest"], {
      execPath: "/usr/bin/deno",
      mainModuleUrl: MAIN_MODULE_URL,
      standalone: false,
    });

    const command = buildSelfInvocationCommand(invocation);
    const expected = [invocation.execPath, ...invocation.args]
      .map(escapeShellArg)
      .join(" ");

    assertEquals(command, expected);
    // The path containing a space must be escaped as a single shell token.
    assert(command.includes(escapeShellArg("/tmp/my manifest")));
  });

  await t.step("buildSelfInvocationCommandForMode matches resolve + build composition", () => {
    const overrides = {
      execPath: "/usr/bin/deno",
      mainModuleUrl: MAIN_MODULE_URL,
      standalone: false,
    };
    const composed = buildSelfInvocationCommandForMode("msg-filter", [], overrides);
    const manual = buildSelfInvocationCommand(
      resolveSelfInvocation("msg-filter", [], overrides),
    );
    assertEquals(composed, manual);
  });
});

Deno.test("readManifestFile", async (t) => {
  await t.step("parses NUL-separated exact paths and drops trailing empties", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-manifest-" });
    try {
      const manifestPath = join(tempDir, "manifest");
      const paths = ["a/b.txt", "with space.txt", "unicode-☕.md"];
      await Deno.writeTextFile(manifestPath, paths.join("\0") + "\0");

      const parsed = await readManifestFile(manifestPath);
      assertEquals(parsed, paths);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("throws AppError when the manifest file cannot be read", async () => {
    await assertRejects(
      () => readManifestFile("/nonexistent/manifest-path-for-test"),
      AppError,
      "Failed to read exact-path manifest",
    );
  });
});

Deno.test("filterCommitMessage (re-exported shared parser)", async (t) => {
  await t.step("removes terminal Claude attribution and preserves the subject", () => {
    const message = "Some commit message\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
    assertEquals(filterCommitMessage(message), "Some commit message\n");
  });

  await t.step("leaves a message with no Claude attribution unchanged", () => {
    const message = "Just a normal commit\n\nWith a body.\n";
    assertEquals(filterCommitMessage(message), message);
  });
});

Deno.test("batchExactPaths", async (t) => {
  await t.step("returns no batches for an empty input", () => {
    assertEquals(batchExactPaths([]), []);
  });

  await t.step("keeps a small path list in a single batch", () => {
    const paths = ["a.txt", "b/c.txt", ".claude"];
    assertEquals(batchExactPaths(paths), [paths]);
  });

  await t.step("splits by the maximum path count while preserving order", () => {
    const paths = ["p0", "p1", "p2", "p3", "p4"];
    const batches = batchExactPaths(paths, 2, 10_000);
    assertEquals(batches, [["p0", "p1"], ["p2", "p3"], ["p4"]]);
    // Every input path appears exactly once, in order.
    assertEquals(batches.flat(), paths);
  });

  await t.step("splits by the maximum argument length", () => {
    // Each path is 5 chars; +1 separator => 6 units each. maxLength 13 fits two.
    const paths = ["aaaaa", "bbbbb", "ccccc"];
    const batches = batchExactPaths(paths, 1000, 13);
    assertEquals(batches, [["aaaaa", "bbbbb"], ["ccccc"]]);
  });

  await t.step("emits an oversized single path in its own batch", () => {
    const long = "x".repeat(50);
    const batches = batchExactPaths(["short", long, "tiny"], 1000, 10);
    assertEquals(batches, [["short"], [long], ["tiny"]]);
    assertEquals(batches.flat(), ["short", long, "tiny"]);
  });
});

Deno.test("removeExactPaths", async (t) => {
  await t.step("removes exact tracked paths from the index via argument array", async () => {
    const repo = await createTestRepo("remove-exact-paths");
    try {
      await addClaudeArtifacts(repo.path, [
        { type: "file", path: "CLAUDE.md", content: "claude instructions" },
        { type: "file", path: "keep-me.txt", content: "keep" },
      ]);
      const add = new Deno.Command("git", { args: ["add", "."], cwd: repo.path });
      await add.output();
      const commit = new Deno.Command("git", {
        args: ["commit", "-m", "add files"],
        cwd: repo.path,
      });
      await commit.output();

      await removeExactPaths(["CLAUDE.md"], repo.path);

      const files = await getTrackedFiles(repo.path);
      assert(!files.includes("CLAUDE.md"));
      assert(files.includes("keep-me.txt"));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("removes many paths across multiple batches", async () => {
    const repo = await createTestRepo("remove-exact-paths-batched");
    try {
      const artifacts = Array.from({ length: 12 }, (_, i) => ({
        type: "file" as const,
        path: `dir${i}/file${i}.txt`,
        content: `content-${i}`,
      }));
      artifacts.push({ type: "file", path: "keep-me.txt", content: "keep" });
      await addClaudeArtifacts(repo.path, artifacts);
      const add = new Deno.Command("git", { args: ["add", "."], cwd: repo.path });
      await add.output();
      const commit = new Deno.Command("git", {
        args: ["commit", "-m", "add many files"],
        cwd: repo.path,
      });
      await commit.output();

      // Remove all artifact paths; internal batching must remove every one.
      await removeExactPaths(artifacts.slice(0, 12).map((a) => a.path), repo.path);

      const files = await getTrackedFiles(repo.path);
      for (let i = 0; i < 12; i++) {
        assert(!files.includes(`dir${i}/file${i}.txt`), `dir${i} should be removed`);
      }
      assert(files.includes("keep-me.txt"));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("is a no-op for an empty path list", async () => {
    const repo = await createTestRepo("remove-exact-paths-empty");
    try {
      await removeExactPaths([], repo.path);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("ignores paths that are not present (--ignore-unmatch)", async () => {
    const repo = await createTestRepo("remove-exact-paths-unmatch");
    try {
      await removeExactPaths(["does/not/exist.txt"], repo.path);
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test("runInternalFilter - dispatch", async (t) => {
  await t.step("msg-filter reads injected stdin and writes filtered output", async () => {
    const input = "Fix bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
    let written = "";
    const exitCode = await runInternalFilter(["msg-filter"], {
      readStdin: () => Promise.resolve(input),
      writeStdout: (data) => {
        written = data;
        return Promise.resolve();
      },
    });

    assertEquals(exitCode, 0);
    assertEquals(written, filterCommitMessage(input));
  });

  await t.step("index-filter reads the manifest and invokes the exact-path remover", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-dispatch-" });
    try {
      const manifestPath = join(tempDir, "manifest");
      await Deno.writeTextFile(manifestPath, ["CLAUDE.md", "claudedocs/notes.md"].join("\0"));

      let receivedPaths: readonly string[] = [];
      let receivedRepoPath = "";
      const exitCode = await runInternalFilter(["index-filter", manifestPath], {
        repoPath: "/some/repo",
        removeExactPaths: (paths, repoPath) => {
          receivedPaths = paths;
          receivedRepoPath = repoPath;
          return Promise.resolve();
        },
      });

      assertEquals(exitCode, 0);
      assertEquals(receivedPaths, ["CLAUDE.md", "claudedocs/notes.md"]);
      assertEquals(receivedRepoPath, "/some/repo");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  await t.step("index-filter without a manifest path fails cleanly", async () => {
    const exitCode = await runInternalFilter(["index-filter"], {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        verbose: () => {},
        debug: () => {},
      },
    });
    assertEquals(exitCode, 1);
  });

  await t.step("unknown mode fails cleanly with a non-zero exit code", async () => {
    const exitCode = await runInternalFilter(["not-a-real-mode"], {
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
        verbose: () => {},
        debug: () => {},
      },
    });
    assertEquals(exitCode, 1);
  });
});
