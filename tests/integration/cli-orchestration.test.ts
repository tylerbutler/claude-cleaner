/**
 * Integration tests for CLI orchestration, exercised through the real CLI
 * (`src/main.ts`) end to end.
 *
 * Coverage:
 *  - Full-mode **preflight**: a predictable commit-phase failure (a
 *    non-existent `--branch`, or a dirty tracked working tree) must be caught
 *    *before* the file-cleaning pass rewrites history, so history and refs are
 *    left completely untouched and no backup is created.
 *  - **Relative repo paths**: a relative path argument (resolved against a
 *    different process cwd) must still produce a correct sibling bare-clone
 *    backup and rewrite — the path is normalized before any `git`/clone runs.
 *  - **Mode coordination**: `--files-only` only rewrites files (commit
 *    messages untouched), `--commits-only` only rewrites messages (tracked
 *    files untouched), and full mode does both.
 */

import { assert, assertEquals } from "@std/assert";
import { basename, dirname, join } from "@std/path";

// Absolute path to the CLI entry point, captured before any test changes cwd
// so the CLI can be launched from an arbitrary working directory.
const MAIN = join(Deno.cwd(), "src", "main.ts");

const TRAILER_MESSAGE = "add files\n\n" +
  "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
  "Co-Authored-By: Claude <noreply@anthropic.com>";

async function git(repoPath: string, args: string[]): Promise<string> {
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

async function runCLI(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const options: Deno.CommandOptions = {
    args: ["run", "--allow-all", MAIN, ...args],
    stdout: "piped",
    stderr: "piped",
  };
  if (cwd) {
    options.cwd = cwd;
  }
  const output = await new Deno.Command("deno", options).output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

/**
 * Creates a repo (named `repo` under a fresh parent dir) with a single commit
 * that contains BOTH a `.claude/` artifact and a Claude trailer, so the same
 * fixture exercises file removal and commit-message cleaning independently.
 */
async function makeRepo(): Promise<
  { parent: string; path: string; cleanup: () => Promise<void> }
> {
  const parent = await Deno.makeTempDir({ prefix: "claude-cleaner-orch-" });
  const repoPath = join(parent, "repo");
  await Deno.mkdir(repoPath);
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);

  await Deno.writeTextFile(join(repoPath, "README.md"), "# Test\n");
  await Deno.mkdir(join(repoPath, ".claude"));
  await Deno.writeTextFile(join(repoPath, ".claude", "settings.json"), "{}\n");
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, ["commit", "-m", TRAILER_MESSAGE]);

  return {
    parent,
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

async function historyHasClaudeFile(repoPath: string): Promise<boolean> {
  const out = await git(repoPath, [
    "log",
    "--all",
    "--pretty=format:",
    "--name-only",
  ]);
  return out.split("\n").some((p) => p.trim().startsWith(".claude"));
}

async function trackedFiles(repoPath: string, ref = "HEAD"): Promise<string[]> {
  const out = await git(repoPath, ["ls-tree", "-r", "--name-only", ref]);
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

async function headMessage(repoPath: string, ref = "HEAD"): Promise<string> {
  return await git(repoPath, ["log", "-1", "--format=%B", ref]);
}

async function backupDirs(parent: string): Promise<string[]> {
  const dirs: string[] = [];
  for await (const entry of Deno.readDir(parent)) {
    if (entry.isDirectory && entry.name.startsWith("claude-cleaner-backup-")) {
      dirs.push(entry.name);
    }
  }
  return dirs;
}

async function backupBranches(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, ["branch", "--format=%(refname:short)"]);
  return out
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("backup/pre-claude-clean-"));
}

Deno.test("Integration - full-mode preflight fails before any mutation", async (t) => {
  await t.step(
    "a non-existent --branch is rejected before file cleaning rewrites history",
    async () => {
      const repo = await makeRepo();
      try {
        const branchesBefore = (await git(repo.path, [
          "branch",
          "--format=%(refname:short)",
        ])).trim();
        const headBefore = (await git(repo.path, ["rev-parse", "HEAD"])).trim();

        const result = await runCLI([
          "--execute",
          "--branch",
          "does-not-exist",
          repo.path,
        ]);

        assert(!result.success, "run should fail for a non-existent branch");
        assert(
          result.stderr.includes("does-not-exist"),
          `error should name the missing branch, got: ${result.stderr}`,
        );

        // File cleaning must NOT have run: the .claude artifact is still in
        // history, HEAD is unmoved, and no backups (branch or bare clone)
        // were created.
        assert(
          await historyHasClaudeFile(repo.path),
          "history must be untouched — file cleaning must not run before the preflight passes",
        );
        assertEquals(
          (await git(repo.path, ["rev-parse", "HEAD"])).trim(),
          headBefore,
          "HEAD must be unchanged",
        );
        assertEquals(
          (await git(repo.path, ["branch", "--format=%(refname:short)"])).trim(),
          branchesBefore,
          "no backup branch should be created",
        );
        assertEquals(
          (await backupDirs(repo.parent)).length,
          0,
          "no bare-clone backup should be created",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "a dirty tracked working tree is rejected before any history rewrite",
    async () => {
      const repo = await makeRepo();
      try {
        // Dirty a tracked file without committing.
        await Deno.writeTextFile(join(repo.path, "README.md"), "# Dirty\n");

        const result = await runCLI(["--execute", repo.path]);

        assert(!result.success, "run should fail on a dirty tracked tree");
        assert(
          result.stderr.includes("WORKING_TREE_DIRTY"),
          `error should be WORKING_TREE_DIRTY, got: ${result.stderr}`,
        );

        assert(
          await historyHasClaudeFile(repo.path),
          "history must be untouched when the working tree is dirty",
        );
        assertEquals(
          (await backupBranches(repo.path)).length,
          0,
          "no backup branch should be created",
        );
        assertEquals(
          (await backupDirs(repo.parent)).length,
          0,
          "no bare-clone backup should be created",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Integration - relative repo path is normalized for backups", async (t) => {
  await t.step(
    "files-only --execute with a relative path produces a correct sibling backup and rewrite",
    async () => {
      const repo = await makeRepo();
      try {
        // Run from the repo's PARENT and pass just the repo's basename, so the
        // argument is relative to a cwd that is not the repo itself. Without
        // path normalization, the bare-clone backup (git clone --bare <repo>
        // <repo>/../backup) would fail.
        const result = await runCLI(
          ["--files-only", "--execute", basename(repo.path)],
          dirname(repo.path),
        );

        assert(
          result.success,
          `relative-path run should succeed: ${result.stderr}`,
        );
        assert(
          !(await historyHasClaudeFile(repo.path)),
          "the .claude artifact should be rewritten out of history",
        );

        const backups = await backupDirs(repo.parent);
        assertEquals(
          backups.length,
          1,
          `exactly one sibling bare-clone backup should exist, got: ${backups.join(", ")}`,
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});

Deno.test("Integration - mode coordination", async (t) => {
  await t.step("--files-only rewrites files but leaves commit messages", async () => {
    const repo = await makeRepo();
    try {
      const result = await runCLI(["--files-only", "--execute", repo.path]);
      assert(result.success, `files-only failed: ${result.stderr}`);

      assert(
        !(await historyHasClaudeFile(repo.path)),
        "files-only should remove the .claude artifact from history",
      );
      assert(
        (await headMessage(repo.path)).includes(
          "Co-Authored-By: Claude <noreply@anthropic.com>",
        ),
        "files-only must NOT alter commit messages",
      );
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("--commits-only rewrites messages but leaves files", async () => {
    const repo = await makeRepo();
    try {
      const result = await runCLI(["--commits-only", "--execute", repo.path]);
      assert(result.success, `commits-only failed: ${result.stderr}`);

      const message = await headMessage(repo.path);
      assert(
        !message.includes("Co-Authored-By: Claude") &&
          !message.includes("Generated with [Claude Code]"),
        `commits-only should strip trailers, got: ${message}`,
      );
      assert(
        (await trackedFiles(repo.path)).includes(".claude/settings.json"),
        "commits-only must NOT remove tracked files",
      );
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("full mode rewrites both files and messages", async () => {
    const repo = await makeRepo();
    try {
      const result = await runCLI(["--execute", repo.path]);
      assert(result.success, `full mode failed: ${result.stderr}`);

      assert(
        !(await historyHasClaudeFile(repo.path)),
        "full mode should remove the .claude artifact from history",
      );
      const message = await headMessage(repo.path);
      assert(
        !message.includes("Co-Authored-By: Claude") &&
          !message.includes("Generated with [Claude Code]"),
        `full mode should strip trailers, got: ${message}`,
      );
      assert(
        message.startsWith("add files"),
        "full mode must preserve the non-trailer subject",
      );
    } finally {
      await repo.cleanup();
    }
  });
});
