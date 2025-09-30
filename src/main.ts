import { Command } from "@cliffy/command";
import { AppError, ConsoleLogger, getSystemInfo } from "./utils.ts";
import { FileCleaner } from "./file-cleaner.ts";
import { DependencyManager } from "./dependency-manager.ts";
import { CommitCleaner } from "./commit-cleaner.ts";

const VERSION = "0.1.0";

interface CleanOptions {
  execute?: boolean | undefined;
  verbose?: boolean | undefined;
  autoInstall?: boolean | undefined;
  filesOnly?: boolean | undefined;
  commitsOnly?: boolean | undefined;
  repoPath?: string | undefined;
  branch?: string | undefined;
  includeDirs?: string[] | undefined;
  includeDirsFile?: string | undefined;
  defaults?: boolean | undefined;
  includeAllCommonPatterns?: boolean | undefined;
}

async function cleanAction(options: CleanOptions) {
  const logger = new ConsoleLogger(options.verbose);
  const depManager = new DependencyManager(logger);

  try {
    const repoPath = options.repoPath || Deno.cwd();

    // Default to dry-run mode unless --execute flag is provided
    const isDryRun = !options.execute;

    logger.verbose("System info: " + JSON.stringify(getSystemInfo()));

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

    if (options.autoInstall) {
      logger.info("Auto-install mode enabled - installing dependencies...");
      await depManager.installAllDependencies();
      logger.info("Dependencies installed successfully");
    }

    if (options.filesOnly) {
      logger.info("Files-only mode: Scanning for Claude files...");

      // Check dependencies are available for file cleaning
      const depResults = await depManager.checkAllDependencies();
      const missingDeps = depResults.filter((result) => !result.available);

      if (missingDeps.length > 0 && !isDryRun) {
        logger.error("Missing required dependencies for file removal:");
        for (const dep of missingDeps) {
          logger.error(`  - ${dep.tool}: ${dep.error || "not found"}`);
        }
        logger.info("Run with --auto-install to install dependencies automatically");
        throw new AppError("Missing dependencies", "MISSING_DEPENDENCIES");
      }

      // Collect directory patterns from CLI and file
      const includeDirs: string[] = [...(options.includeDirs || [])];

      if (options.includeDirsFile) {
        try {
          const fileContent = await Deno.readTextFile(options.includeDirsFile);
          const fileDirs = fileContent
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#")); // Skip empty lines and comments
          includeDirs.push(...fileDirs);
          logger.verbose(
            `Loaded ${fileDirs.length} directory patterns from ${options.includeDirsFile}`,
          );
        } catch (error) {
          throw new AppError(
            `Failed to read directory patterns file: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "FILE_READ_ERROR",
          );
        }
      }

      const fileCleaner = new FileCleaner({
        dryRun: isDryRun,
        verbose: options.verbose || false,
        repoPath,
        createBackup: !isDryRun, // Create backup for real operations
        includeDirectories: includeDirs,
        excludeDefaults: options.defaults === false,
        includeAllCommonPatterns: options.includeAllCommonPatterns || false,
      }, logger);

      // Set BFG path from dependency manager if available
      if (!isDryRun) {
        await fileCleaner.setBFGPath(depManager.getBfgJarPath());
      }

      try {
        await fileCleaner.validateRepository();
        const claudeFiles = await fileCleaner.detectClaudeFiles();

        if (claudeFiles.length === 0) {
          logger.info("No Claude files found in repository");
          return;
        }

        logger.info(`📄 Found ${claudeFiles.length} Claude files:`);
        for (const file of claudeFiles) {
          const typeIcon = file.type === "directory" ? "📂" : "📄";
          logger.info(`  ${typeIcon} ${file.path} - ${file.reason}`);
        }

        if (isDryRun) {
          logger.info("\nDry-run complete. Use --execute to remove these files.");
        } else {
          // Actually remove the files
          await fileCleaner.cleanFiles();
        }
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_GIT_REPO") {
          logger.error(`Not a Git repository: ${repoPath}`);
          logger.info(
            "Please run this command from within a Git repository or specify a path with --repo-path",
          );
        } else {
          throw error;
        }
      }
    } else if (options.commitsOnly) {
      logger.info("Commits-only mode: Cleaning commit messages...");
      await handleCommitCleaning({ ...options, execute: options.execute }, logger, depManager);
    } else {
      // Full cleaning mode - both files and commits
      logger.info("Full cleaning mode: removing Claude files and cleaning commit messages...");

      // Check dependencies are available
      const depResults = await depManager.checkAllDependencies();
      const missingDeps = depResults.filter((result) => !result.available);

      if (missingDeps.length > 0 && !isDryRun) {
        logger.error("Missing required dependencies:");
        for (const dep of missingDeps) {
          logger.error(`  - ${dep.tool}: ${dep.error || "not found"}`);
        }
        logger.info("Run with --auto-install to install dependencies automatically");
        throw new AppError("Missing dependencies", "MISSING_DEPENDENCIES");
      }

      // Step 1: File cleaning
      logger.info("\n📁 Step 1: Scanning for Claude files...");

      // Collect directory patterns from CLI and file
      const includeDirs: string[] = [...(options.includeDirs || [])];

      if (options.includeDirsFile) {
        try {
          const fileContent = await Deno.readTextFile(options.includeDirsFile);
          const fileDirs = fileContent
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#")); // Skip empty lines and comments
          includeDirs.push(...fileDirs);
          logger.verbose(
            `Loaded ${fileDirs.length} directory patterns from ${options.includeDirsFile}`,
          );
        } catch (error) {
          throw new AppError(
            `Failed to read directory patterns file: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "FILE_READ_ERROR",
          );
        }
      }

      const fileCleaner = new FileCleaner({
        dryRun: isDryRun,
        verbose: options.verbose || false,
        repoPath,
        createBackup: !isDryRun, // Create backup for real operations
        includeDirectories: includeDirs,
        excludeDefaults: options.defaults === false,
        includeAllCommonPatterns: options.includeAllCommonPatterns || false,
      }, logger);

      // Set BFG path from dependency manager if available
      if (!isDryRun) {
        await fileCleaner.setBFGPath(depManager.getBfgJarPath());
      }

      try {
        await fileCleaner.validateRepository();
        const claudeFiles = await fileCleaner.detectClaudeFiles();

        if (claudeFiles.length === 0) {
          logger.info("No Claude files found in repository");
        } else {
          logger.info(`📄 Found ${claudeFiles.length} Claude files:`);
          for (const file of claudeFiles) {
            const typeIcon = file.type === "directory" ? "📂" : "📄";
            logger.info(`  ${typeIcon} ${file.path} - ${file.reason}`);
          }

          if (isDryRun) {
            logger.info("\nFile scan complete. Use --execute to remove these files.");
          } else {
            // Actually remove the files
            await fileCleaner.cleanFiles();
          }
        }
      } catch (error) {
        if (error instanceof AppError && error.code === "NOT_GIT_REPO") {
          logger.error(`Not a Git repository: ${repoPath}`);
          logger.info(
            "Please run this command from within a Git repository or specify a path with --repo-path",
          );
          throw error;
        } else {
          throw error;
        }
      }

      // Step 2: Commit message cleaning
      logger.info("\n💬 Step 2: Cleaning commit messages...");
      await handleCommitCleaning({ ...options, execute: options.execute }, logger, depManager);

      // Summary
      if (isDryRun) {
        logger.info(
          "\nFull dry-run complete. Use --execute to apply all changes (files + commits).",
        );
      } else {
        logger.info("\nFull cleaning completed successfully!");
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      logger.error(`${error.code}: ${error.message}`);
      if (error.cause) {
        logger.verbose(`Caused by: ${error.cause.message}`);
      }
    } else {
      logger.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
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
        `\n${missingCount} dependencies are missing. Run with --auto-install to install them.`,
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
      logger.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
}

async function handleCommitCleaning(
  options: CleanOptions,
  logger: ConsoleLogger,
  depManager: DependencyManager,
) {
  const sdPath = await getSdPath(depManager);
  const commitCleaner = new CommitCleaner(logger, sdPath);
  const isDryRun = !options.execute;

  // Validate Git repository
  await commitCleaner.validateGitRepository();

  if (!isDryRun) {
    // Check working tree is clean before making changes
    await commitCleaner.checkWorkingTreeClean();

    // Create backup
    const backupBranch = await commitCleaner.createBackup(options.branch);
    logger.info(`Backup created: ${backupBranch}`);
  }

  // Clean commits
  const result = await commitCleaner.cleanCommits({
    dryRun: isDryRun,
    verbose: options.verbose,
    branchToClean: options.branch,
  });

  // Display results
  if (isDryRun && result.preview) {
    logger.info(`\n📊 Commit Analysis Results:`);
    logger.info(`Total commits analyzed: ${result.totalCommits}`);
    logger.info(`Commits with Claude trailers: ${result.commitsWithClaudeTrailers}`);
    logger.info(`Total trailers to remove: ${result.trailersRemoved}`);

    if (result.preview.length > 0) {
      logger.info(`\nPreview of changes:`);
      for (const commit of result.preview.slice(0, 5)) { // Show first 5 for brevity
        logger.info(`\n  Commit: ${commit.shortSha}`);
        logger.info(`  Trailers found: ${commit.trailersFound.length}`);
        for (const trailer of commit.trailersFound) {
          logger.info(`    - "${trailer.replace(/\n/g, "\\n")}"`);
        }
        logger.info(
          `  Original message preview: "${
            commit.originalMessage.split("\n")[0]?.substring(0, 60)
          }..."`,
        );
        logger.info(
          `  Cleaned message preview: "${
            commit.cleanedMessage.split("\n")[0]?.substring(0, 60)
          }..."`,
        );
      }

      if (result.preview.length > 5) {
        logger.info(`\n  ... and ${result.preview.length - 5} more commits`);
      }

      logger.info(`\nTo apply these changes, run: claude-cleaner --commits-only --execute`);
    }
  } else if (!isDryRun) {
    logger.info(`\n✓ Commit cleaning completed successfully!`);
    logger.info(`Processed ${result.totalCommits} commits`);
    logger.info(`Cleaned ${result.commitsWithClaudeTrailers} commits`);
    logger.info(`Removed ${result.trailersRemoved} Claude trailers`);
  }
}

async function getSdPath(depManager: DependencyManager): Promise<string> {
  const sdCheck = await depManager.checkDependency("sd");
  if (!sdCheck.available) {
    throw new AppError("sd tool is required but not available", "SD_NOT_AVAILABLE");
  }
  return sdCheck.path || "sd";
}

async function main() {
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
      .option(
        "-x, --execute",
        "Execute changes (default: dry-run mode shows what would be changed)",
      )
      .option("-v, --verbose", "Enable verbose output")
      .option("--auto-install", "Automatically install required dependencies")
      .option("--files-only", "Only scan and remove Claude files (skip commit message cleaning)")
      .option("--commits-only", "Clean only commit messages (skip file removal)")
      .option("--repo-path <path:string>", "Path to Git repository (defaults to current directory)")
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
      .option("--no-defaults", "Skip default Claude patterns (.claude/, CLAUDE.md, etc.)")
      .option(
        "--include-all-common-patterns",
        "Include ALL known common Claude patterns (even rarely used ones) - use for complete cleanup",
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
      logger.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }
}

if (import.meta.main) {
  await main();
}
