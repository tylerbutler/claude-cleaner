/**
 * Integration tests for dependency reporting and the deprecated
 * `--auto-install` flag, exercised through the real CLI (`src/main.ts`).
 *
 * Claude Cleaner now requires only Git; the previous Java/BFG/`sd`/mise
 * toolchain and its installer were removed. These tests assert that
 * `check-deps` reports Git alone, the cleaning path tells users to install
 * Git and ensure it is on their PATH, and `--auto-install` is accepted as a
 * clearly-announced no-op that neither installs anything nor fails the run.
 */

import { assert } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

async function runCLI(
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    stdout: "piped",
    stderr: "piped",
    env: { ...Deno.env.toObject(), ...envOverrides },
  }).output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

async function makeRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const parent = await Deno.makeTempDir({ prefix: "claude-cleaner-deps-" });
  const repoPath = join(parent, "repo");
  await ensureDir(repoPath);
  const git = async (args: string[]) => {
    const r = await new Deno.Command("git", {
      args,
      cwd: repoPath,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!r.success) {
      throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(r.stderr)}`);
    }
  };
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test User"]);
  await Deno.writeTextFile(join(repoPath, "README.md"), "# Test\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "initial"]);
  return {
    path: repoPath,
    cleanup: async () => {
      try {
        await Deno.remove(parent, { recursive: true });
      } catch {
        // ignore
      }
    },
  };
}

const RETIRED_TOOLS = ["java", "bfg", "sd", "mise"];

Deno.test("Integration - check-deps reports Git only", async (t) => {
  await t.step("lists git and none of the retired tools", async () => {
    const result = await runCLI(["check-deps"]);

    assert(result.success, `check-deps failed: ${result.stderr}`);
    const combined = `${result.stdout}\n${result.stderr}`;

    assert(
      /✓\s*git:/.test(result.stdout),
      `check-deps should report git as available, got: ${result.stdout}`,
    );
    assert(
      result.stdout.includes("All dependencies are available!"),
      "check-deps should confirm all dependencies are present",
    );

    for (const tool of RETIRED_TOOLS) {
      assert(
        !new RegExp(`\\b${tool}\\b`, "i").test(combined),
        `check-deps must not mention the retired tool "${tool}", got: ${combined}`,
      );
    }
  });
});

Deno.test("Integration - deprecated --auto-install is a no-op", async (t) => {
  await t.step(
    "warns, installs nothing, and still completes the run",
    async () => {
      const repo = await makeRepo();
      try {
        const result = await runCLI(["--files-only", "--auto-install", repo.path]);

        assert(
          result.success,
          `--auto-install run should succeed: ${result.stderr}`,
        );

        const combined = `${result.stdout}\n${result.stderr}`;

        // A clear deprecation notice is shown.
        assert(
          /--auto-install is deprecated/i.test(combined),
          `expected a deprecation warning, got: ${combined}`,
        );

        // It must not attempt to install anything or reference the old
        // installer/toolchain.
        assert(
          !/installing dependencies/i.test(combined),
          "deprecated --auto-install must not attempt installation",
        );
        for (const tool of RETIRED_TOOLS) {
          assert(
            !new RegExp(`installing[^\\n]*${tool}`, "i").test(combined),
            `--auto-install must not install the retired tool "${tool}"`,
          );
        }

        // The run still proceeds normally (dry-run for a repo with no Claude
        // files reports nothing to remove).
        assert(
          result.stdout.includes("Running in dry-run mode"),
          "the run should proceed after the deprecation notice",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Integration - missing Git in the cleaning path", async (t) => {
  await t.step("reports Git/PATH guidance instead of auto-install", async () => {
    const repo = await makeRepo();
    try {
      const result = await runCLI(
        ["--files-only", "--execute", repo.path],
        { PATH: "", Path: "" },
      );

      assert(
        !result.success,
        "the run should fail when Git is unavailable",
      );

      const combined = `${result.stdout}\n${result.stderr}`;
      assert(
        combined.includes("Missing required dependencies:"),
        `expected the cleaning path to report missing dependencies, got: ${combined}`,
      );
      assert(
        combined.includes(
          "Please install Git and ensure it is available on your PATH.",
        ),
        `expected Git/PATH guidance, got: ${combined}`,
      );
      assert(
        !combined.includes("--auto-install"),
        `cleaning path must not recommend --auto-install, got: ${combined}`,
      );
    } finally {
      await repo.cleanup();
    }
  });
});
