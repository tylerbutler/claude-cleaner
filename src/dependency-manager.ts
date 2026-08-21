import { $ } from "dax";
import type { Logger } from "./utils.ts";

export interface DependencyCheckResult {
  tool: string;
  available: boolean;
  version?: string | undefined;
  path?: string | undefined;
  error?: string | undefined;
}

/**
 * Validates the external runtime dependencies Claude Cleaner needs.
 *
 * History rewriting is now performed entirely through Git plus this program's
 * own self-invoked `git filter-branch` filters (see `internal-filter.ts`), so
 * **Git is the only external tool required**. The previous Java + BFG + `sd` +
 * mise toolchain — along with all of its download, cache, and install
 * machinery — has been removed. This class therefore no longer installs
 * anything; it only reports whether Git is available. `--auto-install` is
 * retained solely as a deprecated no-op in `main.ts`.
 */
export class DependencyManager {
  constructor(private readonly logger: Logger) {}

  /** Checks that Git is available and reports its version and resolved path. */
  async checkGit(): Promise<DependencyCheckResult> {
    try {
      const result = await $`git --version`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      if (result.code === 0) {
        const version = result.stdout.trim().replace(/^git version\s+/i, "") ||
          "unknown";
        this.logger.verbose(`git detected: ${version}`);
        return {
          tool: "git",
          available: true,
          version,
          path: await this.findExecutablePath("git"),
        };
      }

      return {
        tool: "git",
        available: false,
        error: result.stderr.trim() || "git not found",
      };
    } catch (error) {
      return {
        tool: "git",
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Returns the status of every external dependency Claude Cleaner requires.
   * Git is currently the only one, so this is a single-element list — the
   * array shape is kept so callers (and `check-deps`) can iterate uniformly.
   */
  async checkAllDependencies(): Promise<DependencyCheckResult[]> {
    return [await this.checkGit()];
  }

  /**
   * Resolves the on-disk path of an executable for informational output only.
   * Failure is non-fatal: the availability decision is made by actually
   * running the tool, not by locating it on `PATH`.
   */
  private async findExecutablePath(
    command: string,
  ): Promise<string | undefined> {
    try {
      const isWindows = Deno.build.os === "windows";
      const locator = isWindows ? "where" : "which";
      const result = await $`${locator} ${command}`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      if (result.code === 0) {
        const output = result.stdout.trim();
        // `where` on Windows can return multiple lines; take the first.
        const path = isWindows ? output.split(/\r?\n/)[0]?.trim() : output;
        return path && path.length > 0 ? path : undefined;
      }
    } catch {
      // Non-fatal: path resolution is informational only.
    }
    return undefined;
  }
}
