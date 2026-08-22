import { Command } from "@cliffy/command";
import { resolve } from "@std/path";
import { CommitCleaner } from "./commit-cleaner.ts";
import { DependencyManager } from "./dependency-manager.ts";
import { type ClaudeFile, FileCleaner } from "./file-cleaner.ts";
import { isInternalFilterInvocation, runInternalFilter } from "./internal-filter.ts";
import {
  AppError,
  checkForMissingDependencies,
  ConsoleLogger,
  formatGitRef,
  getSystemInfo,
  loadDirectoryPatterns,
} from "./utils.ts";

const VERSION = "0.2.0";

interface CleanOptions {
  execute?: boolean | undefined;
  verbose?: boolean | undefined;
  autoInstall?: boolean | undefined;
  filesOnly?: boolean | undefined;
  commitsOnly?: boolean | undefined;
  branch?: string | undefined;
  includeDirs?: string[] | undefined;
  includeDirsFile?: string | undefined;
  defaults?: boolean | undefined;
  includeAllCommonPatterns?: boolean | undefined;
  includeInstructionFiles?: boolean | undefined;
}

function createFileCleaner(
  isDryRun: boolean,
  options: CleanOptions,
  repoPath: string,
  includeDirs: string[],
  logger: ConsoleLogger,
): FileCleaner {
  return new FileCleaner(
    {
      dryRun: isDryRun,
      verbose: options.verbose || false,
      repoPath,
      createBackup: !isDryRun,
      includeDirectories: includeDirs,
      excludeDefaults: options.defaults === false,
      includeAllCommonPatterns: options.includeAllCommonPatterns || false,
      includeInstructionFiles: options.includeInstructionFiles || false,
    },
    logger,
  );
}

function displayClaudeFiles(
  claudeFiles: ClaudeFile[],
  logger: ConsoleLogger,
): void {
  logger.info(`📄 Found ${claudeFiles.length} Claude files:`);
  for (const file of claudeFiles) {
    const typeIcon = file.type === "directory" ? "📂" : "📄";
    logger.info(`  ${typeIcon} ${file.path} - ${file.reason}`);
    if (file.earliestCommit) {
      logger.info(
        `    ↳ First appeared: ${
          formatGitRef(file.earliestCommit.hash)
        } (${file.earliestCommit.date})`,
      );
      logger.info(`      "${file.earliestCommit.message}"`);
    }
  }
}

/**
 * Runs (or, in dry-run, previews) file removal for an already-detected plan.
 * In execute mode it validates a clean tracked working tree and creates the
 * backup before rewriting history — unless `workingTreeAlreadyValidated` is
 * set, which full mode uses because its preflight validated the tree once for
 * both the file- and commit-cleaning passes.
 */
async function executeFilePlan(
  fileCleaner: FileCleaner,
  claudeFiles: ClaudeFile[],
  isDryRun: boolean,
  logger: ConsoleLogger,
  opts: { workingTreeAlreadyValidated?: boolean } = {},
): Promise<void> {
  if (claudeFiles.length === 0) {
    logger.info("No Claude files found in repository");
    return;
  }

  displayClaudeFiles(claudeFiles, logger);

  if (isDryRun) {
    // Real planning path: prints the exact paths/refs/commands a real run
    // would execute, without mutating anything.
    await fileCleaner.removeFiles(claudeFiles);
    return;
  }

  // History rewriting requires a clean tracked working tree; verify it before
  // creating a backup so a dirty repo fails without side effects.
  if (!opts.workingTreeAlreadyValidated) {
    await fileCleaner.validateWorkingTreeClean();
  }
  await fileCleaner.createBackup();
  await fileCleaner.removeFiles(claudeFiles);
}

async function cleanAction(
  options: CleanOptions,
  repoPathArg?: string,
) {
  const logger = new ConsoleLogger(options.verbose);
  const depManager = new DependencyManager(logger);

  try {
    if (!repoPathArg) {
      throw new AppError(
        "Repository path is required. Usage: claude-cleaner <path>\nExample: claude-cleaner . (for current directory)",
        "REPO_PATH_REQUIRED",
      );
    }

    // Normalize to an absolute path up front so bare-clone backups and every
    // `git` invocation (which run with `cwd` set to the repo) behave the same
    // regardless of the process's current directory or a relative argument
    // such as `.`.
    const repoPath = resolve(repoPathArg);

    // Default to dry-run mode unless --execute flag is provided
    const isDryRun = !options.execute;

    logger.verbose("System info: " + JSON.stringify(getSystemInfo()));
    logger.verbose(`Target repository: ${repoPath}`);

    if (isDryRun) {
      logger.info(
        "Running in dry-run mode - no changes will be made (use --execute to apply changes)",
      );
    } else {
      logger.info("Execute mode - changes will be applied to the repository");
    }

    // Validate mutually exclusive options
    if (options.filesOnly && options.commitsOnly) {
      throw new AppError(
        "--files-only and --commits-only cannot be used together",
        "INVALID_OPTIONS",
      );
    }

    if (options.includeAllCommonPatterns && options.defaults === false) {
      throw new AppError(
        "--include-all-common-patterns and --no-defaults cannot be used together",
        "INVALID_OPTIONS",
      );
    }

    if (options.includeAllCommonPatterns) {
      logger.info(
        "Using comprehensive pattern matching - this will find ALL known Claude artifacts",
      );
    }

    // `--auto-install` is a deprecated no-op: claude-cleaner now needs only
    // Git (which it does not install), so there is nothing to auto-install.
    // The flag is still accepted for backward compatibility.
    if (options.autoInstall) {
      logger.warn(
        "--auto-install is deprecated and no longer installs anything. " +
          "claude-cleaner now requires only Git, which it does not install; " +
          "the flag is accepted for backward compatibility and has no effect.",
      );
    }

    // Git is the only external dependency now; verify it once for every mode.
    const depResults = await depManager.checkAllDependencies();
    checkForMissingDependencies(depResults, isDryRun, logger);

    if (options.filesOnly) {
      await handleFilesOnly(options, repoPath, isDryRun, logger);
    } else if (options.commitsOnly) {
      await handleCommitsOnly(options, repoPath, isDryRun, logger);
    } else {
      await handleFullCleaning(options, repoPath, isDryRun, logger);
    }
  } catch (error) {
    if (error instanceof AppError) {
      logger.error(`${error.code}: ${error.message}`);
      if (error.cause) {
        logger.verbose(`Caused by: ${error.cause.message}`);
      }
    } else {
      logger.error(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

async function handleFilesOnly(
  options: CleanOptions,
  repoPath: string,
  isDryRun: boolean,
  logger: ConsoleLogger,
): Promise<void> {
  logger.info("Files-only mode: Scanning for Claude files...");

  const includeDirs = await loadDirectoryPatterns(
    options.includeDirs,
    options.includeDirsFile,
    logger,
  );

  const fileCleaner = createFileCleaner(
    isDryRun,
    options,
    repoPath,
    includeDirs,
    logger,
  );

  try {
    await fileCleaner.validateRepository();
    const claudeFiles = await fileCleaner.detectClaudeFiles();

    await executeFilePlan(fileCleaner, claudeFiles, isDryRun, logger);

    if (claudeFiles.length > 0 && isDryRun) {
      logger.info("\nDry-run complete. Use --execute to remove these files.");
    }
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_GIT_REPO") {
      logger.error(`Not a Git repository: ${repoPath}`);
      logger.info(
        "Please specify a valid Git repository path as the first argument",
      );
    } else {
      throw error;
    }
  }
}

async function handleCommitsOnly(
  options: CleanOptions,
  repoPath: string,
  isDryRun: boolean,
  logger: ConsoleLogger,
): Promise<void> {
  logger.info("Commits-only mode: Cleaning commit messages...");

  const commitCleaner = new CommitCleaner(logger, repoPath);

  await commitCleaner.validateGitRepository();

  // Resolve the target ref once, before any backup, so an invalid --branch
  // fails fast without creating a backup or touching the checkout.
  const targetBranch = await commitCleaner.resolveBranch(options.branch);

  await runCommitCleaning(options, logger, commitCleaner, targetBranch, {
    isDryRun,
    checkWorkingTree: true,
  });
}

async function handleFullCleaning(
  options: CleanOptions,
  repoPath: string,
  isDryRun: boolean,
  logger: ConsoleLogger,
): Promise<void> {
  logger.info(
    "Full cleaning mode: removing Claude files and cleaning commit messages...",
  );

  const includeDirs = await loadDirectoryPatterns(
    options.includeDirs,
    options.includeDirsFile,
    logger,
  );

  const fileCleaner = createFileCleaner(
    isDryRun,
    options,
    repoPath,
    includeDirs,
    logger,
  );
  const commitCleaner = new CommitCleaner(logger, repoPath);

  // ---- Preflight ---------------------------------------------------------
  // Validate everything and build both plans *before* either engine creates a
  // backup or rewrites history. File cleaning runs first and rewrites the
  // whole history repository-wide, so a predictable commit-phase failure (a
  // non-existent --branch, a dirty tree, or an infeasible rewrite range) must
  // be caught here — otherwise it would only surface *after* history has
  // already been mutated.
  logger.info(
    "\n🔎 Preflight: validating repository and planning changes...",
  );

  try {
    await fileCleaner.validateRepository();
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_GIT_REPO") {
      logger.error(`Not a Git repository: ${repoPath}`);
      logger.info(
        "Please run this command from within a Git repository or specify a path: claude-cleaner <path>",
      );
    }
    throw error;
  }
  await commitCleaner.validateGitRepository();

  // A clean tracked working tree is required before rewriting history. Check
  // it once, up front, so it gates both the file- and commit-cleaning passes
  // (execute mode only).
  if (!isDryRun) {
    await fileCleaner.validateWorkingTreeClean();
  }

  // Commit-side feasibility: resolve the target ref exactly once (reused for
  // backup + cleaning) and confirm the rewrite plan is well-formed.
  const targetBranch = await commitCleaner.resolveBranch(options.branch);
  await commitCleaner.planCleaning(targetBranch);

  // File-side plan (repository-wide).
  const claudeFiles = await fileCleaner.detectClaudeFiles();

  // ---- Execution ---------------------------------------------------------
  // Step 1: file cleaning (repository-wide, all refs).
  logger.info("\n📁 Step 1: Removing Claude files...");
  await executeFilePlan(fileCleaner, claudeFiles, isDryRun, logger, {
    workingTreeAlreadyValidated: true,
  });
  if (claudeFiles.length > 0 && isDryRun) {
    logger.info("\nFile scan complete. Use --execute to remove these files.");
  }

  // Step 2: commit cleaning (scoped to the resolved target ref). File cleaning
  // above may have rewritten commit SHAs, so runCommitCleaning re-analyzes the
  // current history rather than reusing the preflight plan. The working tree
  // was already validated in the preflight, so it is not re-checked here.
  logger.info("\n💬 Step 2: Cleaning commit messages...");
  await runCommitCleaning(options, logger, commitCleaner, targetBranch, {
    isDryRun,
    checkWorkingTree: false,
  });

  // Summary — emitted only after every step above has completed successfully.
  if (isDryRun) {
    logger.info(
      "\nFull dry-run complete. Use --execute to apply all changes (files + commits).",
    );
  } else {
    logger.info("\nFull cleaning completed successfully!");
  }
}

async function checkDepsAction(options: { verbose?: boolean | undefined }) {
  const logger = new ConsoleLogger(options.verbose);
  const depManager = new DependencyManager(logger);

  try {
    logger.info("Checking dependencies...");

    const results = await depManager.checkAllDependencies();

    for (const result of results) {
      if (result.available) {
        logger.info(
          `  ✓ ${result.tool}: ${result.version || "available"} ${
            result.path ? `(${result.path})` : ""
          }`,
        );
      } else {
        logger.error(`  ✗ ${result.tool}: ${result.error || "not found"}`);
      }
    }

    const missingCount = results.filter((r) => !r.available).length;
    if (missingCount > 0) {
      logger.error(
        `\n${missingCount} required ${
          missingCount === 1 ? "dependency is" : "dependencies are"
        } missing. Please install Git and ensure it is available on your PATH.`,
      );
      Deno.exit(1);
    } else {
      logger.info("\nAll dependencies are available!");
    }
  } catch (error) {
    if (error instanceof AppError) {
      logger.error(`${error.code}: ${error.message}`);
      if (error.cause) {
        logger.verbose(`Caused by: ${error.cause.message}`);
      }
    } else {
      logger.error(
        `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw error;
  }
}

/**
 * Runs (or, in dry-run, previews) commit-message cleaning for an
 * already-resolved target ref. `checkWorkingTree` is false when the caller
 * (full mode) has already validated a clean tracked working tree in its
 * preflight. Success details are printed only after cleanCommits() resolves,
 * i.e. after its post-rewrite verification passes.
 */
async function runCommitCleaning(
  options: CleanOptions,
  logger: ConsoleLogger,
  commitCleaner: CommitCleaner,
  targetBranch: string,
  ctx: { isDryRun: boolean; checkWorkingTree: boolean },
) {
  const { isDryRun, checkWorkingTree } = ctx;

  if (!isDryRun) {
    if (checkWorkingTree) {
      await commitCleaner.checkWorkingTreeClean();
    }

    const backupBranch = await commitCleaner.createBackup(targetBranch);
    logger.info(`Backup created: ${backupBranch}`);
  }

  // Clean commits (re-analyzes the current history and, in execute mode,
  // verifies the targeted trailers are gone before resolving).
  const result = await commitCleaner.cleanCommits({
    dryRun: isDryRun,
    verbose: options.verbose,
    branchToClean: targetBranch,
  });

  // Display results
  if (isDryRun && result.preview) {
    logger.info(`\n📊 Commit Analysis Results:`);
    logger.info(`Total commits analyzed: ${result.totalCommits}`);
    logger.info(
      `Commits with Claude trailers: ${result.commitsWithClaudeTrailers}`,
    );
    logger.info(`Total trailers to remove: ${result.trailersRemoved}`);

    if (result.preview.length > 0) {
      logger.info(`\nPreview of changes:`);
      for (const commit of result.preview.slice(0, 5)) {
        // Show first 5 for brevity
        logger.info(`\n  Commit: ${commit.shortSha}`);
        logger.info(`  Trailers found: ${commit.trailersFound.length}`);
        for (const trailer of commit.trailersFound) {
          logger.info(`    - "${trailer.replace(/\n/g, "\\n")}"`);
        }
        logger.info(
          `  Original message preview: "${
            commit.originalMessage
              .split("\n")[0]
              ?.substring(0, 60)
          }..."`,
        );
        logger.info(
          `  Cleaned message preview: "${
            commit.cleanedMessage
              .split("\n")[0]
              ?.substring(0, 60)
          }..."`,
        );
      }

      if (result.preview.length > 5) {
        logger.info(`\n  ... and ${result.preview.length - 5} more commits`);
      }

      logger.info(
        `\nTo apply these changes, run: claude-cleaner --commits-only --execute`,
      );
    }
  } else if (!isDryRun) {
    logger.info(`\n✓ Commit cleaning completed successfully!`);
    logger.info(`Processed ${result.totalCommits} commits`);
    logger.info(`Cleaned ${result.commitsWithClaudeTrailers} commits`);
    logger.info(`Removed ${result.trailersRemoved} Claude trailers`);
  }
}

async function main() {
  // Internal self-invocation used as a `git filter-branch` filter (see
  // src/internal-filter.ts). Intercepted before Cliffy parses arguments so
  // this mode never appears in --help and can't collide with real
  // subcommands or the repo-path positional argument.
  if (isInternalFilterInvocation(Deno.args)) {
    const exitCode = await runInternalFilter(Deno.args.slice(1));
    Deno.exit(exitCode);
  }

  try {
    await new Command()
      .name("claude-cleaner")
      .version(VERSION)
      .description(
        "Remove Claude artifacts from Git repositories (runs in safe dry-run mode by default)",
      )
      .help({
        colors: true,
      })
      .arguments("[repo-path:string]")
      .option(
        "-x, --execute",
        "Execute changes (default: dry-run mode shows what would be changed)",
      )
      .option("-v, --verbose", "Enable verbose output")
      .option(
        "--auto-install",
        "(Deprecated, no-op) Formerly installed external tools; claude-cleaner now requires only Git",
      )
      .option(
        "--files-only",
        "Only scan and remove Claude files (skip commit message cleaning)",
      )
      .option(
        "--commits-only",
        "Clean only commit messages (skip file removal)",
      )
      .option("--branch <branch>", "Specify branch to clean (defaults to HEAD)")
      .option(
        "--include-dirs <name:string>",
        "Add directory names to remove (matches any directory with this name anywhere in repository)",
        { collect: true },
      )
      .option(
        "--include-dirs-file <file:string>",
        "Read directory names from file (one pattern per line)",
      )
      .option(
        "--no-defaults",
        "Skip default Claude patterns (.claude/, CLAUDE.md, etc.)",
      )
      .option(
        "--include-all-common-patterns",
        "Include ALL known common Claude patterns (even rarely used ones) - use for complete cleanup",
      )
      .option(
        "--include-instruction-files",
        "Include CLAUDE.md instruction files for removal (preserved by default to keep project documentation)",
      )
      .action(cleanAction)
      .command("check-deps", "Check if all required dependencies are available")
      .option("-v, --verbose", "Enable verbose output")
      .action(checkDepsAction)
      .parse(Deno.args);
  } catch (error) {
    const logger = new ConsoleLogger();
    if (error instanceof AppError) {
      logger.error(`${error.code}: ${error.message}`);
      Deno.exit(1);
    } else {
      logger.error(
        `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
      );
      Deno.exit(1);
    }
  }
}

if (import.meta.main) {
  await main();
}
