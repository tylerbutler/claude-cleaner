/**
 * Integration tests for commit-message filtering through the REAL CLI and a
 * REAL `git filter-branch` rewrite.
 *
 * These prove the end-to-end, self-contained path: `src/main.ts --commits-only
 * --execute` wires `git filter-branch --msg-filter` directly to the program's
 * hidden `__internal-filter msg-filter` self-invocation (no generated
 * TypeScript, no Bash wrapper, no `chmod`, no external Deno script on disk).
 * Git calls back into the same program once per commit to clean each message.
 *
 * Coverage: canonical trailers, a body line that mentions Claude and 🤖 (false
 * positive that must survive), a non-Claude trailer that must survive, an
 * attribution-only commit that must fall back to the fixed placeholder, and
 * the dry-run preview that must advertise the self-invocation command.
 */

import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { ATTRIBUTION_ONLY_FALLBACK_MESSAGE } from "../../src/commit-message-filter.ts";

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

async function commit(repoPath: string, message: string, file: string): Promise<void> {
  await Deno.writeTextFile(join(repoPath, file), `content for ${file}\n`);
  await git(repoPath, ["add", "-A"]);
  await git(repoPath, ["commit", "-m", message]);
}

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const output = await new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
    success: output.success,
  };
}

async function makeRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const parent = await Deno.makeTempDir({ prefix: "claude-cleaner-msg-filter-" });
  const repoPath = join(parent, "repo");
  await ensureDir(repoPath);
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.email", "test@example.com"]);
  await git(repoPath, ["config", "user.name", "Test User"]);
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

const CANONICAL_TRAILER = "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
  "Co-Authored-By: Claude <noreply@anthropic.com>";

/** Builds a repo whose history exercises every filtering scenario. */
async function setupHistory(repoPath: string): Promise<void> {
  await commit(repoPath, "Initial clean commit", "README.md");

  await commit(repoPath, `Canonical trailer commit\n\n${CANONICAL_TRAILER}`, "a.txt");

  await commit(
    repoPath,
    "Prose commit\n\n" +
      "Body mentions Claude 🤖 in prose and must survive.\n\n" +
      "Signed-off-by: Human <human@example.com>\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    "b.txt",
  );

  // A commit whose entire message is nothing but removable attribution.
  await commit(repoPath, CANONICAL_TRAILER, "c.txt");
}

Deno.test("Integration - commit message filtering via real filter-branch", async (t) => {
  await t.step(
    "dry-run reports precise per-line counts and advertises the self-invocation msg-filter",
    async () => {
      const repo = await makeRepo();
      try {
        await setupHistory(repo.path);

        const result = await runCli(["--commits-only", repo.path]);
        assert(result.success, `CLI failed: ${result.stderr}\n${result.stdout}`);

        // 3 commits carry attribution (canonical=2 lines, prose=1 line,
        // attribution-only=2 lines) => 5 removed lines, each counted once.
        assert(
          result.stdout.includes("Commits with Claude trailers: 3"),
          `expected 3 commits, got: ${result.stdout}`,
        );
        assert(
          result.stdout.includes("Total trailers to remove: 5"),
          `expected 5 trailer lines, got: ${result.stdout}`,
        );

        // The advertised command must be the hidden self-invocation, not a
        // generated Bash/TypeScript temp script.
        assert(
          result.stdout.includes("__internal-filter") && result.stdout.includes("msg-filter"),
          `dry-run should advertise the self-invocation, got: ${result.stdout}`,
        );
        assert(
          !result.stdout.includes("clean-msg.sh") && !result.stdout.includes("<clean-script>"),
          "dry-run must not reference a generated Bash wrapper or placeholder script",
        );

        // Nothing was mutated by the dry run.
        const log = await git(repo.path, ["log", "--format=%B"]);
        assert(log.includes("Co-Authored-By: Claude <noreply@anthropic.com>"));
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "execute rewrites every message, preserving prose and non-Claude trailers, with a fallback for attribution-only commits",
    async () => {
      const repo = await makeRepo();
      try {
        await setupHistory(repo.path);

        const branchBefore = (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        const branchesBefore = new Set(
          (await git(repo.path, ["branch", "--format=%(refname:short)"]))
            .trim().split("\n").filter(Boolean),
        );

        const result = await runCli(["--commits-only", "--execute", repo.path]);
        assert(result.success, `CLI failed: ${result.stderr}\n${result.stdout}`);

        const log = await git(repo.path, ["log", "--format=%B"]);

        // Every recognized attribution line is gone from history.
        assert(
          !log.includes("Co-Authored-By: Claude <noreply@anthropic.com>"),
          `Claude co-author trailer should be gone, got:\n${log}`,
        );
        assert(
          !log.includes("🤖 Generated with [Claude Code]"),
          `Claude generation line should be gone, got:\n${log}`,
        );

        // Ordinary content is preserved: subjects, the Claude-mentioning prose
        // line, and the non-Claude trailer.
        assert(log.includes("Canonical trailer commit"), "canonical subject preserved");
        assert(log.includes("Prose commit"), "prose subject preserved");
        assert(
          log.includes("Body mentions Claude 🤖 in prose and must survive."),
          `body prose mentioning Claude must survive, got:\n${log}`,
        );
        assert(
          log.includes("Signed-off-by: Human <human@example.com>"),
          `non-Claude trailer must survive, got:\n${log}`,
        );

        // The attribution-only commit falls back to the fixed placeholder.
        assert(
          log.includes(ATTRIBUTION_ONLY_FALLBACK_MESSAGE),
          `attribution-only commit should use the fallback, got:\n${log}`,
        );

        // Task 3 behavior unchanged: HEAD stays on the same branch and a
        // single backup branch was created.
        const branchAfter = (await git(repo.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        assertEquals(branchAfter, branchBefore, "checkout must not change");
        const newBranches = (await git(repo.path, ["branch", "--format=%(refname:short)"]))
          .trim().split("\n").filter(Boolean)
          .filter((b) => !branchesBefore.has(b));
        const backups = newBranches.filter((b) => b.startsWith("backup/pre-claude-clean-"));
        assertEquals(
          backups.length,
          1,
          `expected one backup branch, got: ${newBranches.join(", ")}`,
        );

        // The backup preserves the original, un-rewritten trailers.
        const backupLog = await git(repo.path, ["log", "--format=%B", backups[0]!]);
        assert(
          backupLog.includes("Co-Authored-By: Claude <noreply@anthropic.com>"),
          "backup must preserve original trailers",
        );
      } finally {
        await repo.cleanup();
      }
    },
  );
});
