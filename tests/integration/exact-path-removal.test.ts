/**
 * Integration tests for exact-path history rewriting.
 *
 * These exercise the real CLI (`src/main.ts`), which rewrites history with
 * `git filter-branch --index-filter` self-invoking the program's internal
 * index-filter mode against a NUL-delimited exact-path manifest. Unlike the
 * previous BFG basename approach, removal is by exact repository path, so
 * files that merely share a basename with a Claude artifact elsewhere in the
 * tree are preserved, and directory entries prune their descendants.
 */

import { assert } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";

/** Runs a git command in the given repo, throwing on failure. */
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

async function writeFile(repoPath: string, rel: string, content: string): Promise<void> {
  const full = join(repoPath, rel);
  await ensureDir(join(full, ".."));
  await Deno.writeTextFile(full, content);
}

/** Tracked paths for a given ref. */
async function trackedFiles(repoPath: string, ref: string): Promise<string[]> {
  const out = await git(repoPath, ["ls-tree", "-r", "--name-only", ref]);
  return out.trim().split("\n").filter(Boolean);
}

/** Every path that ever appeared across all refs (post-cleanup). */
async function allHistoricalPaths(repoPath: string): Promise<string[]> {
  const out = await git(repoPath, ["log", "--all", "--pretty=format:", "--name-only"]);
  return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
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

/**
 * Creates a repo inside a dedicated parent temp dir so the external bare-clone
 * backup (written as a sibling of the repo) is cleaned up along with it.
 */
async function makeRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const parent = await Deno.makeTempDir({ prefix: "claude-cleaner-exact-" });
  const repoPath = join(parent, "repo");
  await ensureDir(repoPath);
  await git(repoPath, ["init"]);
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

Deno.test("Integration - Exact-path history rewriting", async (t) => {
  await t.step(
    "removes exact Claude paths across all refs while preserving same-basename siblings",
    async () => {
      const repo = await makeRepo();
      try {
        // main: a Claude dir plus an unrelated file sharing the basename config.json.
        await writeFile(repo.path, ".claude/config.json", "claude");
        await writeFile(repo.path, ".claude/nested/deep.json", "claude nested");
        await writeFile(repo.path, "src/config.json", "app config");
        await writeFile(repo.path, "src/main.ts", "console.log('hi')");
        await git(repo.path, ["add", "-A"]);
        await git(repo.path, ["commit", "-m", "main files"]);

        // feature branch: a different Claude directory (claudedocs).
        await git(repo.path, ["checkout", "-b", "feature"]);
        await writeFile(repo.path, "claudedocs/api.md", "# api");
        await writeFile(repo.path, "feature.txt", "feature work");
        await git(repo.path, ["add", "-A"]);
        await git(repo.path, ["commit", "-m", "feature files"]);
        await git(repo.path, ["checkout", "main"]);

        const result = await runCli([
          "--files-only",
          "--execute",
          "--auto-install",
          repo.path,
        ]);
        assert(result.success, `CLI failed: ${result.stderr}`);

        // main: Claude paths gone, same-basename sibling and code preserved.
        const main = await trackedFiles(repo.path, "main");
        assert(!main.includes(".claude/config.json"), "main .claude/config.json removed");
        assert(!main.includes(".claude/nested/deep.json"), "nested descendant removed");
        assert(main.includes("src/config.json"), "same-basename sibling preserved");
        assert(main.includes("src/main.ts"), "unrelated code preserved");

        // feature: claudedocs gone, unrelated file preserved.
        const feature = await trackedFiles(repo.path, "feature");
        assert(!feature.some((f) => f.startsWith("claudedocs/")), "feature claudedocs removed");
        assert(feature.includes("feature.txt"), "feature file preserved");

        // Nothing Claude survives anywhere in rewritten history.
        const historical = await allHistoricalPaths(repo.path);
        assert(
          !historical.some((p) => p.startsWith(".claude/") || p.startsWith("claudedocs/")),
          `Claude paths still present in history: ${historical.join(", ")}`,
        );
        assert(historical.includes("src/config.json"), "sibling retained in history");
      } finally {
        await repo.cleanup();
      }
    },
  );

  await t.step(
    "dry-run reports the exact paths, refs, and command without modifying history",
    async () => {
      const repo = await makeRepo();
      try {
        await writeFile(repo.path, ".claude/config.json", "claude");
        await writeFile(repo.path, "src/config.json", "app config");
        await git(repo.path, ["add", "-A"]);
        await git(repo.path, ["commit", "-m", "files"]);

        const result = await runCli(["--files-only", repo.path]);
        assert(result.success, `CLI failed: ${result.stderr}`);

        // The removal plan (deduped, descendant-pruned exact paths) is surfaced.
        assert(
          result.stdout.includes("Exact paths that would be rewritten"),
          "dry-run lists exact paths",
        );
        assert(result.stdout.includes(".claude"), "plan includes the Claude directory");
        assert(
          result.stdout.includes("Refs that would be rewritten"),
          "dry-run lists refs",
        );
        assert(
          result.stdout.includes("git filter-branch -f --index-filter"),
          "dry-run shows the filter-branch command",
        );

        // Repository history is untouched.
        const tracked = await trackedFiles(repo.path, "HEAD");
        assert(tracked.includes(".claude/config.json"), "dry-run leaves file tracked");
        assert(tracked.includes("src/config.json"));
      } finally {
        await repo.cleanup();
      }
    },
  );
});
