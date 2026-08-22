import { $ } from "dax";
import { filterClaudeAttribution } from "./commit-message-filter.ts";
import { buildSelfInvocationCommandForMode } from "./internal-filter.ts";
import type { Logger } from "./utils.ts";
import { AppError, formatGitRef } from "./utils.ts";

export interface CommitCleanOptions {
  dryRun?: boolean | undefined;
  verbose?: boolean | undefined;
  branchToClean?: string | undefined;
}

export interface CommitCleanResult {
  totalCommits: number;
  commitsWithClaudeTrailers: number;
  trailersRemoved: number;
  earliestCommitWithTrailer?: string | undefined;
  preview?: CommitPreview[] | undefined;
}

export interface CommitPreview {
  sha: string;
  shortSha: string;
  originalMessage: string;
  cleanedMessage: string;
  trailersFound: string[];
}

export class CommitCleaner {
  constructor(
    private readonly logger: Logger,
    private readonly repoPath: string = Deno.cwd(),
  ) {}

  /**
   * Resolves and validates the ref the caller wants cleaned, defaulting to
   * HEAD. This is the single source of truth for "which ref are we
   * operating on" for a given invocation — callers (including main.ts, for
   * backup creation) must reuse the exact string this returns rather than
   * independently re-deriving the currently checked-out branch, which is
   * what previously caused execution to silently target HEAD instead of an
   * explicitly requested, un-checked-out branch.
   */
  async resolveBranch(branchToClean?: string): Promise<string> {
    const requested = branchToClean?.trim() || "HEAD";
    const target = `${requested}^{commit}`;
    const result = await $`git rev-parse --verify --quiet ${target}`
      .cwd(this.repoPath)
      .stdout("piped")
      .stderr("piped")
      .noThrow();

    if (result.code !== 0) {
      throw new AppError(
        `Branch or revision "${requested}" does not exist in this repository`,
        "GET_BRANCH_FAILED",
      );
    }

    return requested;
  }

  async cleanCommits(
    options: CommitCleanOptions = {},
  ): Promise<CommitCleanResult> {
    // `branchToClean`, when provided, has already been resolved and validated
    // by the caller (main.ts calls resolveBranch() once, then reuses the
    // result for backup creation and cleaning). Reusing it here avoids a
    // redundant `git rev-parse --verify`. Only fall back to resolving HEAD
    // when no ref was supplied (e.g. a direct, standalone call).
    const branch = options.branchToClean ?? await this.resolveBranch();

    this.logger.info(`Starting commit cleaning for branch: ${branch}`);

    // Analyze what we would clean and confirm the rewrite range is feasible
    // (earliest offending commit is an ancestor of `branch`) before mutating.
    const analysis = await this.planCleaning(branch);

    if (options.dryRun) {
      this.logger.info("Dry-run mode: showing preview of changes");

      // Show commands that would be executed
      if (
        analysis.commitsWithClaudeTrailers > 0 &&
        analysis.earliestCommitWithTrailer
      ) {
        this.logger.info("\n[DRY RUN] Commands that would be executed:");

        const { revisionRange } = await this.buildRevisionRange(
          branch,
          analysis.earliestCommitWithTrailer,
        );

        const filterCommand = buildSelfInvocationCommandForMode("msg-filter");
        this.logger.info(
          `  git filter-branch -f --msg-filter '${filterCommand}' ${revisionRange}`,
        );
      }

      return {
        totalCommits: analysis.totalCommits,
        commitsWithClaudeTrailers: analysis.commitsWithClaudeTrailers,
        trailersRemoved: analysis.trailersRemoved,
        earliestCommitWithTrailer: analysis.earliestCommitWithTrailer,
        preview: analysis.preview,
      };
    }

    if (analysis.commitsWithClaudeTrailers === 0) {
      this.logger.info("No Claude trailers found in commit messages");
      return analysis;
    }

    const earliestCommitWithTrailer = analysis.earliestCommitWithTrailer;
    if (!earliestCommitWithTrailer) {
      // commitsWithClaudeTrailers > 0 always sets this together in
      // analyzeCommits(); guarded here only to satisfy the type checker.
      throw new AppError(
        "Inconsistent analysis: trailers were found but no earliest commit was recorded",
        "REVISION_RANGE_INVALID",
      );
    }

    // Ancestor feasibility (earliest offending commit is reachable from the
    // ref we're about to rewrite) was already asserted by planCleaning()
    // above, before any mutation.

    this.logger.info(
      `Found ${analysis.commitsWithClaudeTrailers} commits with Claude trailers`,
    );
    this.logger.info("Starting git filter-branch to clean commit messages...");

    const { revisionRange, parentSha } = await this.buildRevisionRange(
      branch,
      earliestCommitWithTrailer,
    );

    await this.executeCommitCleaning(
      branch,
      revisionRange,
      parentSha,
      earliestCommitWithTrailer,
    );

    // Verify the exact rewritten range's targeted trailers are actually gone
    // before reporting success.
    await this.verifyTrailersRemoved(revisionRange);

    this.logger.info("Commit cleaning completed successfully");
    return analysis;
  }

  /**
   * Validates — without mutating anything — that commit cleaning for an
   * already-resolved `branch` is feasible: it analyzes the reachable history
   * and, when Claude trailers are present, asserts that the earliest
   * offending commit is an ancestor of `branch` (so the rewrite range is
   * well-formed). Full-mode orchestration calls this in its preflight so a
   * predictable commit-phase failure surfaces *before* the file-cleaning pass
   * rewrites history. The returned analysis doubles as the dry-run preview and
   * is reused by {@link cleanCommits}.
   */
  async planCleaning(branch: string): Promise<CommitCleanResult> {
    const analysis = await this.analyzeCommits(branch);

    if (analysis.commitsWithClaudeTrailers > 0) {
      if (!analysis.earliestCommitWithTrailer) {
        // commitsWithClaudeTrailers > 0 always records this together in
        // analyzeCommits(); guarded here only to satisfy the type checker.
        throw new AppError(
          "Inconsistent analysis: trailers were found but no earliest commit was recorded",
          "REVISION_RANGE_INVALID",
        );
      }
      await this.assertAncestor(analysis.earliestCommitWithTrailer, branch);
    }

    return analysis;
  }

  private async analyzeCommits(branch: string): Promise<CommitCleanResult> {
    const commits = await this.getCommitList(branch);
    const preview: CommitPreview[] = [];
    let commitsWithTrailers = 0;
    let totalTrailersRemoved = 0;
    let earliestCommitWithTrailer: string | undefined;

    for (const commit of commits) {
      const originalMessage = await this.getCommitMessage(commit.sha);
      const { cleanedMessage, removedLines } = filterClaudeAttribution(originalMessage);

      if (removedLines.length > 0) {
        commitsWithTrailers++;
        // Each entry in removedLines is one physical attribution line, so the
        // count is exact (no double-counting from overlapping patterns).
        totalTrailersRemoved += removedLines.length;
        // Track the earliest commit (last in chronological order since rev-list returns newest-first)
        earliestCommitWithTrailer = commit.sha;

        preview.push({
          sha: commit.sha,
          shortSha: formatGitRef(commit.sha),
          originalMessage,
          cleanedMessage,
          trailersFound: removedLines,
        });
      }
    }

    return {
      totalCommits: commits.length,
      commitsWithClaudeTrailers: commitsWithTrailers,
      trailersRemoved: totalTrailersRemoved,
      earliestCommitWithTrailer,
      preview,
    };
  }

  /**
   * Confirms `sha` is actually reachable from `branch` before it is used to
   * bound a rewrite range. Guards against rewriting an inconsistent range if
   * analysis and execution ever drift apart (e.g. the ref moved between
   * calls, or a future change threads in a mismatched pair).
   */
  private async assertAncestor(sha: string, branch: string): Promise<void> {
    const result = await $`git merge-base --is-ancestor ${sha} ${branch}`
      .cwd(this.repoPath)
      .stdout("piped")
      .stderr("piped")
      .noThrow();

    if (result.code !== 0) {
      throw new AppError(
        `Earliest commit with Claude trailers (${
          formatGitRef(sha)
        }) is not an ancestor of ${branch}; refusing to rewrite an inconsistent range`,
        "REVISION_RANGE_INVALID",
      );
    }
  }

  /**
   * Builds the revision range to pass to `git filter-branch`, optimizing to
   * `<parent-of-earliest-trailer-commit>..<branch>` when possible so history
   * before the first offending commit is left untouched. Shared by the
   * dry-run preview and the real execution so both always describe/operate
   * on the identical range.
   */
  private async buildRevisionRange(
    branch: string,
    earliestCommitWithTrailer?: string,
  ): Promise<{ revisionRange: string; parentSha?: string }> {
    if (!earliestCommitWithTrailer) {
      return { revisionRange: branch };
    }

    const parentResult = await $`git rev-parse ${earliestCommitWithTrailer}^`
      .cwd(this.repoPath)
      .stdout("piped")
      .stderr("piped")
      .noThrow();

    if (parentResult.code === 0) {
      const parentSha = parentResult.stdout.trim();
      return { revisionRange: `${parentSha}..${branch}`, parentSha };
    }

    // No parent: the earliest offending commit is the repository root, so
    // the entire branch history must be rewritten.
    return { revisionRange: branch };
  }

  /**
   * Re-analyzes `revisionRangeOrRef` after execution and fails loudly if any
   * targeted trailers survived the rewrite, so a partial/failed cleanup is
   * never reported as a success. Scoped to the exact range that was
   * rewritten (rather than the whole branch) so verification is both
   * precise and cheap.
   */
  private async verifyTrailersRemoved(revisionRangeOrRef: string): Promise<void> {
    const verification = await this.analyzeCommits(revisionRangeOrRef);
    if (verification.commitsWithClaudeTrailers > 0) {
      throw new AppError(
        `Commit cleaning did not remove all Claude trailers from ${revisionRangeOrRef}: ` +
          `${verification.commitsWithClaudeTrailers} commit(s) still contain them`,
        "COMMIT_CLEANING_VERIFICATION_FAILED",
      );
    }
  }

  private async getCommitList(
    branch: string,
  ): Promise<Array<{ sha: string; subject: string }>> {
    try {
      const result = await $`git rev-list --format="%H|%s" ${branch}`
        .cwd(this.repoPath)
        .stdout("piped")
        .stderr("piped");

      const commits: Array<{ sha: string; subject: string }> = [];
      const lines = result.stdout.split("\n").filter((line) => line.trim());

      for (const line of lines) {
        if (line.startsWith("commit ")) continue; // Skip commit separator lines

        const [sha, ...subjectParts] = line.split("|");
        if (sha && subjectParts.length > 0) {
          commits.push({
            sha: sha.trim(),
            subject: subjectParts.join("|").trim(),
          });
        }
      }

      return commits;
    } catch (error) {
      throw new AppError(
        "Failed to get commit list",
        "COMMIT_LIST_FAILED",
        error as Error,
      );
    }
  }

  private async getCommitMessage(sha: string): Promise<string> {
    try {
      const result = await $`git log -1 --format=%B ${sha}`
        .cwd(this.repoPath)
        .stdout("piped")
        .stderr("piped");
      return result.stdout;
    } catch (error) {
      throw new AppError(
        `Failed to get commit message for ${sha}`,
        "COMMIT_MESSAGE_FAILED",
        error as Error,
      );
    }
  }

  private async executeCommitCleaning(
    branch: string,
    revisionRange: string,
    parentSha: string | undefined,
    earliestCommitWithTrailer?: string,
  ): Promise<void> {
    try {
      // `branch` and `revisionRange` were resolved once by the caller
      // (resolveBranch() + buildRevisionRange()) — they must never be
      // re-derived from the currently checked-out HEAD here, otherwise a
      // --branch pointing at a different, un-checked-out ref would silently
      // rewrite whatever happens to be checked out instead.
      if (earliestCommitWithTrailer) {
        if (parentSha) {
          this.logger.info(
            `Optimizing: rewriting from ${formatGitRef(earliestCommitWithTrailer)} to ${branch}`,
          );
        } else {
          this.logger.info(
            `Earliest commit ${
              formatGitRef(earliestCommitWithTrailer)
            } is the first commit, rewriting entire branch history`,
          );
        }
      }

      // Git evaluates the --msg-filter value as a shell command once per
      // rewritten commit; the self-invocation re-enters this program's hidden
      // msg-filter mode, which reads the commit message on stdin and writes the
      // cleaned message to stdout. This needs no temporary script, no chmod,
      // and no external Deno runtime for compiled binaries. Passing the
      // resolved ref (not HEAD) means filter-branch updates that ref directly
      // without touching the current checkout.
      const filterCommand = buildSelfInvocationCommandForMode("msg-filter");
      this.logger.info(
        `Running: git filter-branch -f --msg-filter '${filterCommand}' ${revisionRange}`,
      );
      const filterBranchResult =
        await $`git filter-branch -f --msg-filter ${filterCommand} ${revisionRange}`
          .cwd(this.repoPath)
          .env("FILTER_BRANCH_SQUELCH_WARNING", "1")
          .stdout("piped")
          .stderr("piped")
          .noThrow();

      if (filterBranchResult.code !== 0) {
        throw new AppError(
          "git filter-branch failed",
          "FILTER_BRANCH_FAILED",
          new Error(filterBranchResult.stderr),
        );
      }

      this.logger.verbose("git filter-branch completed successfully");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Failed to execute commit cleaning",
        "COMMIT_CLEANING_FAILED",
        error as Error,
      );
    }
  }

  async validateGitRepository(): Promise<void> {
    try {
      const result = await $`git rev-parse --git-dir`
        .cwd(this.repoPath)
        .stdout("piped")
        .stderr("piped")
        .noThrow();
      if (result.code !== 0) {
        throw new AppError("Not in a Git repository", "NOT_GIT_REPO");
      }
    } catch (error) {
      throw new AppError(
        "Failed to validate Git repository",
        "GIT_VALIDATION_FAILED",
        error as Error,
      );
    }
  }

  async checkWorkingTreeClean(): Promise<void> {
    try {
      const result = await $`git status --porcelain`
        .cwd(this.repoPath)
        .stdout("piped")
        .stderr("piped");
      if (result.stdout.trim()) {
        throw new AppError(
          "Working tree is not clean. Please commit or stash your changes before running commit cleaning",
          "WORKING_TREE_DIRTY",
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Failed to check working tree status",
        "WORKING_TREE_CHECK_FAILED",
        error as Error,
      );
    }
  }

  async createBackup(branch: string = "HEAD"): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupBranch = `backup/pre-claude-clean-${timestamp}`;

      this.logger.info(`Running: git branch ${backupBranch} ${branch}`);
      const result = await $`git branch ${backupBranch} ${branch}`
        .cwd(this.repoPath)
        .stdout("piped")
        .stderr("piped")
        .noThrow();
      if (result.code !== 0) {
        throw new AppError(
          "Failed to create backup branch",
          "BACKUP_CREATION_FAILED",
          new Error(result.stderr),
        );
      }

      this.logger.info(`Created backup branch: ${backupBranch}`);
      return backupBranch;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Failed to create backup",
        "BACKUP_FAILED",
        error as Error,
      );
    }
  }
}
