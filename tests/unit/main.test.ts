/**
 * Unit tests for the main CLI entry point (`src/main.ts`), driven through the
 * real subprocess so they exercise production argument parsing and dispatch.
 *
 * Scope kept to what `main.ts` alone owns: mutually-exclusive/argument
 * validation, `--help`/`--version`, the dry-run default banner, and mode
 * *dispatch* (files-only / commits-only / full) surfaced in dry-run so nothing
 * is mutated. Execute-mode mode *coordination* (which engine actually rewrites
 * what) is proven end-to-end in `tests/integration/cli-orchestration.test.ts`;
 * Git-only dependency reporting and the `--auto-install` no-op behavior are
 * proven in `tests/integration/dependency-management.test.ts`. Those are not
 * duplicated here.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createIsolatedRepo, gitCmd, runCli } from "../utils/test-helpers.ts";

Deno.test("Main CLI - argument validation", async (t) => {
  // A path argument that exists but need not be a Git repo: option validation
  // runs before repository validation.
  const dir = await Deno.makeTempDir({ prefix: "claude-cleaner-main-args-" });

  await t.step("rejects --files-only together with --commits-only", async () => {
    const result = await runCli(["--files-only", "--commits-only", dir]);
    assert(!result.success, "conflicting mode flags must fail");
    assertStringIncludes(result.stderr, "INVALID_OPTIONS");
    assertStringIncludes(
      result.stderr,
      "--files-only and --commits-only cannot be used together",
    );
  });

  await t.step(
    "rejects --include-all-common-patterns together with --no-defaults",
    async () => {
      const result = await runCli([
        "--include-all-common-patterns",
        "--no-defaults",
        dir,
      ]);
      assert(!result.success, "conflicting pattern flags must fail");
      assertStringIncludes(result.stderr, "INVALID_OPTIONS");
      assertStringIncludes(
        result.stderr,
        "--include-all-common-patterns and --no-defaults cannot be used together",
      );
    },
  );

  await t.step("requires a repository path argument", async () => {
    const noPath = await runCli(["--files-only"]);
    assert(!noPath.success);
    assertStringIncludes(noPath.stderr, "REPO_PATH_REQUIRED");
    assertStringIncludes(noPath.stderr, "Repository path is required");

    const noArgs = await runCli([]);
    assert(!noArgs.success);
    assertStringIncludes(noArgs.stderr, "REPO_PATH_REQUIRED");
  });

  await t.step("cleanup", async () => {
    await Deno.remove(dir, { recursive: true });
  });
});

Deno.test("Main CLI - help and version", async (t) => {
  await t.step("--help lists the public options and hides the internal marker", async () => {
    const result = await runCli(["--help"]);
    assert(result.success, `--help should exit 0: ${result.stderr}`);
    assertStringIncludes(result.stdout, "claude-cleaner");
    assertStringIncludes(result.stdout, "--execute");
    assertStringIncludes(result.stdout, "--files-only");
    assertStringIncludes(result.stdout, "--commits-only");
    assertStringIncludes(result.stdout, "check-deps");
    // The hidden self-invocation marker must never surface in user help.
    assert(
      !result.stdout.includes("__internal-filter"),
      "the internal filter marker must not appear in --help",
    );
  });

  await t.step("--version prints the version", async () => {
    const result = await runCli(["--version"]);
    assert(result.success, `--version should exit 0: ${result.stderr}`);
    assertStringIncludes(result.stdout, "0.2.0");
  });
});

Deno.test("Main CLI - dry-run default and mode dispatch", async (t) => {
  const repo = await createIsolatedRepo("main-modes");
  await gitCmd(repo.path, ["commit", "--allow-empty", "-m", "initial"]);

  await t.step("defaults to dry-run mode when --execute is omitted", async () => {
    const result = await runCli([repo.path]);
    assert(result.success, `dry-run default should succeed: ${result.stderr}`);
    assertStringIncludes(
      result.stdout,
      "Running in dry-run mode - no changes will be made",
    );
  });

  await t.step("--files-only dispatches to files-only mode", async () => {
    const result = await runCli(["--files-only", repo.path]);
    assert(result.success, result.stderr);
    assertStringIncludes(result.stdout, "Files-only mode");
  });

  await t.step("--commits-only dispatches to commits-only mode", async () => {
    const result = await runCli(["--commits-only", repo.path]);
    assert(result.success, result.stderr);
    assertStringIncludes(result.stdout, "Commits-only mode");
  });

  await t.step("no mode flag dispatches to full cleaning mode", async () => {
    const result = await runCli([repo.path]);
    assert(result.success, result.stderr);
    assertStringIncludes(result.stdout, "Full cleaning mode");
  });

  await t.step("cleanup", async () => {
    // No backups are created in dry-run, so history and refs are untouched.
    const refs = (await gitCmd(repo.path, ["branch", "--format=%(refname:short)"])).trim();
    assertEquals(refs.split("\n").filter(Boolean).some((b) => b.startsWith("backup/")), false);
    await repo.cleanup();
  });
});

Deno.test("Main CLI - deprecated --auto-install is accepted with a warning", async (t) => {
  const repo = await createIsolatedRepo("main-auto-install");
  await gitCmd(repo.path, ["commit", "--allow-empty", "-m", "initial"]);

  await t.step("emits a deprecation warning and still runs the dry-run", async () => {
    const result = await runCli(["--files-only", "--auto-install", repo.path]);
    assert(result.success, `--auto-install run should succeed: ${result.stderr}`);
    const combined = `${result.stdout}\n${result.stderr}`;
    assertStringIncludes(combined, "--auto-install is deprecated");
    assertStringIncludes(result.stdout, "Running in dry-run mode");
  });

  await t.step("cleanup", async () => {
    await repo.cleanup();
  });
});
