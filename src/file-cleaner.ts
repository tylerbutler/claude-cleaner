import { basename, join } from "@std/path";
import { $, CommandBuilder } from "dax";
import { AppError, dirExists, fileExists, formatGitRef, type Logger } from "./utils.ts";

// Claude file pattern definitions
interface PatternDefinition {
  pattern: RegExp;
  reason: string;
}

const EXTENDED_CLAUDE_PATTERNS: PatternDefinition[] = [
  // Configuration files
  {
    pattern: /^\.?claude[-_.].*\.(json|yaml|yml|toml|ini|config)$/i,
    reason: "Claude configuration file (extended pattern)",
  },
  {
    pattern: /^claude[-_]?(config|settings|workspace|env).*$/i,
    reason: "Claude workspace/settings file",
  },

  // Session and state files
  {
    pattern: /^\.?claude[-_]?(session|state|cache|history).*$/i,
    reason: "Claude session/state file",
  },
  {
    pattern: /^\.?claude[-_.](session|state|cache|history)$/i,
    reason: "Claude session/state file",
  },

  // Backup files (must come before numbered files to avoid conflict)
  {
    pattern: /^\.?claude[-_.].*\.(bak|backup|old|orig|save)$/i,
    reason: "Claude backup file",
  },
  {
    pattern: /^\.?claude\.(bak|backup|old|orig|save)$/i,
    reason: "Claude backup file",
  },

  // Temporary and working files
  {
    pattern: /^\.?claude[-_]?(temp|tmp|work|scratch|draft).*$/i,
    reason: "Claude temporary/working file",
  },
  {
    pattern: /^\.?claude\.(temp|tmp|work|scratch|draft)$/i,
    reason: "Claude temporary/working file",
  },
  {
    pattern: /^\.?claude[-_]?(output|result|analysis|report).*$/i,
    reason: "Claude output/analysis file",
  },

  // Lock and process files
  {
    pattern: /^\.?claude.*\.(lock|pid|socket)$/i,
    reason: "Claude process/lock file",
  },
  {
    pattern: /^\.?claude[-_]?(lock|process|run).*$/i,
    reason: "Claude process/lock file",
  },

  // Debug and diagnostic files
  {
    pattern: /^\.?claude[-_]?(debug|trace|profile|diagnostic).*$/i,
    reason: "Claude debug/diagnostic file",
  },
  {
    pattern: /^\.?claude.*\.(debug|trace|profile|diagnostic)$/i,
    reason: "Claude debug/diagnostic file",
  },
  {
    pattern: /^\.?claude\.(diagnostic|lock|pid|socket)$/i,
    reason: "Claude debug/diagnostic file",
  },

  // Export and archive files
  {
    pattern: /^\.?claude[-_]?(export|archive|dump|snapshot).*$/i,
    reason: "Claude export/archive file",
  },
  {
    pattern: /^\.?claude[-_.].*\.(export|archive|dump|snapshot)$/i,
    reason: "Claude export/archive file",
  },

  // Workspace directories
  {
    pattern: /^\.?claude[-_]?(workspace|project|sessions?|temp|cache|data)$/i,
    reason: "Claude workspace directory",
  },

  // Documentation files
  {
    pattern: /^claude[-_]?(notes?|docs?|readme|instructions?).*\.(md|txt|rst)$/i,
    reason: "Claude documentation file",
  },
  {
    pattern: /^\.claude[-_.].*\.(notes?|md|txt|rst)$/i,
    reason: "Claude documentation file",
  },

  // Scripts and executables
  {
    pattern: /^\.?claude[-_]?(script|tool|utility|helper).*$/i,
    reason: "Claude script/utility file",
  },
  {
    pattern: /^\.?claude[-_.].*\.(sh|bat|ps1|py|js|ts)$/i,
    reason: "Claude script/utility file",
  },

  // Hidden files and dotfiles
  { pattern: /^\.claude[a-z0-9_-]+$/i, reason: "Claude hidden/dot file" },

  // Numbered/versioned files (must come after backup files)
  {
    pattern: /^\.?claude[-_]?.*[0-9]+.*$/i,
    reason: "Claude numbered/versioned file",
  },
  {
    pattern: /^\.?claude.*v[0-9]+.*$/i,
    reason: "Claude numbered/versioned file",
  },

  // OS-specific files
  {
    pattern: /^\.?claude[-_.].*\.(DS_Store|Thumbs\.db|desktop\.ini)$/i,
    reason: "Claude OS-specific file",
  },
];

export interface FileCleanerOptions {
  dryRun: boolean;
  verbose: boolean;
  repoPath: string;
  createBackup: boolean;
  includeDirectories: string[];
  excludeDefaults: boolean;
  includeAllCommonPatterns: boolean;
}

export interface ClaudeFile {
  path: string;
  type: "file" | "directory";
  reason: string;
  earliestCommit?: {
    hash: string;
    date: string;
    message: string;
  };
}

export class FileCleaner {
  private logger: Logger;
  private bfgPath: string | null = null;

  constructor(
    private options: FileCleanerOptions,
    logger: Logger,
  ) {
    this.logger = logger;
  }

  async detectClaudeFiles(): Promise<ClaudeFile[]> {
    const claudeFiles: ClaudeFile[] = [];
    const repoPath = this.options.repoPath;

    // Validate user patterns first
    this.validateDirectoryPatterns();

    this.logger.verbose("Scanning Git history for files to remove...");

    try {
      // Get all files that have ever existed in Git history
      const result = await $`git log --all --pretty=format: --name-only --diff-filter=A`
        .cwd(repoPath)
        .quiet();

      const historicalFiles = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      // Remove duplicates
      const uniqueFiles = [...new Set(historicalFiles)];

      this.logger.verbose(
        `Checking ${uniqueFiles.length} files from Git history...`,
      );

      // Track directories we've already added
      const addedPaths = new Set<string>();

      // Check each file against our patterns
      for (const relativePath of uniqueFiles) {
        if (this.isTargetFile(relativePath, relativePath)) {
          // Extract parent directories from the matched file path
          const parts = relativePath.split("/");
          const directories: string[] = [];

          // Build up directory paths (e.g., ".claude" from ".claude/settings.json")
          for (let i = 0; i < parts.length - 1; i++) {
            const dirPath = parts.slice(0, i + 1).join("/");
            if (dirPath && !addedPaths.has(dirPath)) {
              directories.push(dirPath);
            }
          }

          // Add all parent directories first
          for (const dirPath of directories) {
            if (this.isTargetFile(dirPath, dirPath)) {
              const earliestCommit = await this.findEarliestCommit(dirPath);

              const dirEntry: ClaudeFile = {
                path: dirPath,
                type: "directory",
                reason: this.getFileReason(dirPath),
              };

              if (earliestCommit) {
                dirEntry.earliestCommit = earliestCommit;
              }

              claudeFiles.push(dirEntry);
              addedPaths.add(dirPath);
            }
          }

          // Then add the file itself if not already added
          if (!addedPaths.has(relativePath)) {
            // Determine if it's a directory or file based on path
            const isDirectory = relativePath.endsWith("/") ||
              uniqueFiles.some((f) => f.startsWith(relativePath + "/"));

            // Find the earliest commit for this file
            const earliestCommit = await this.findEarliestCommit(relativePath);

            const fileEntry: ClaudeFile = {
              path: relativePath,
              type: isDirectory ? "directory" : "file",
              reason: this.getFileReason(relativePath),
            };

            if (earliestCommit) {
              fileEntry.earliestCommit = earliestCommit;
            }

            claudeFiles.push(fileEntry);
            addedPaths.add(relativePath);
          }
        }
      }
    } catch (error) {
      throw new AppError(
        `Failed to scan Git history: ${error instanceof Error ? error.message : String(error)}`,
        "SCAN_ERROR",
        error instanceof Error ? error : undefined,
      );
    }

    this.logger.verbose(
      `Found ${claudeFiles.length} files/directories to remove from Git history`,
    );
    return claudeFiles;
  }

  private async findEarliestCommit(filePath: string): Promise<
    | {
      hash: string;
      date: string;
      message: string;
    }
    | undefined
  > {
    try {
      // Find the earliest commit that added this file
      // Use --diff-filter=A to find when file was added
      // Use --reverse to get oldest first
      // Build command with properly escaped arguments
      const builder = new CommandBuilder()
        .command([
          "git",
          "log",
          "--all",
          "--reverse",
          "--diff-filter=A",
          "--format=%H|%aI|%s",
          "--max-count=1",
          "--",
          filePath,
        ])
        .cwd(this.options.repoPath)
        .quiet();
      const result = await builder;

      const output = result.stdout.trim();

      if (!output) {
        return undefined;
      }

      const [hash, date, ...messageParts] = output.split("|");

      if (!hash || !date) {
        return undefined;
      }

      const message = messageParts.join("|").trim(); // Rejoin in case message had pipes

      return {
        hash, // Full hash - formatting functions will handle shortening/styling
        date,
        message: message.length > 60 ? message.substring(0, 57) + "..." : message,
      };
    } catch {
      return undefined;
    }
  }

  private validateDirectoryPatterns(): void {
    for (const pattern of this.options.includeDirectories) {
      if (pattern.includes("..")) {
        throw new AppError(
          `Invalid pattern '${pattern}': parent directory references (..) are not allowed`,
          "INVALID_PATTERN",
        );
      }
      if (pattern.startsWith("/")) {
        throw new AppError(
          `Invalid pattern '${pattern}': absolute paths are not allowed`,
          "INVALID_PATTERN",
        );
      }
      if (pattern.includes("/")) {
        throw new AppError(
          `Invalid pattern '${pattern}': path separators are not allowed, use directory names only`,
          "INVALID_PATTERN",
        );
      }
      if (pattern === "*") {
        throw new AppError(
          `Invalid pattern '${pattern}': wildcard-only patterns are too dangerous`,
          "INVALID_PATTERN",
        );
      }
      if (pattern.trim() === "") {
        throw new AppError("Empty patterns are not allowed", "INVALID_PATTERN");
      }

      // Warn about potentially broad patterns
      if (
        pattern.length === 1 ||
        ["temp", "tmp", "cache", "build"].includes(pattern.toLowerCase())
      ) {
        this.logger.warn(
          `Pattern '${pattern}' may match many directories. Use dry-run to preview before executing.`,
        );
      }
    }
  }

  private isTargetFile(_fullPath: string, relativePath: string): boolean {
    // If --include-all-common-patterns is enabled, use comprehensive patterns
    if (this.options.includeAllCommonPatterns) {
      return this.isAllCommonPatternsFile(relativePath);
    }

    // Check user-defined directory patterns first
    if (this.matchesUserPatterns(relativePath)) return true;

    // Check default Claude patterns (unless disabled)
    if (!this.options.excludeDefaults && this.isClaudeFile(relativePath)) {
      return true;
    }

    return false;
  }

  private matchesUserPatterns(relativePath: string): boolean {
    const fileName = basename(relativePath);

    // Check if the file/directory name itself matches
    for (const pattern of this.options.includeDirectories) {
      if (fileName === pattern) return true;
    }

    // Check if any parent directory in the path matches
    const parts = relativePath.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i];
      for (const pattern of this.options.includeDirectories) {
        if (dirName === pattern) return true;
      }
    }

    return false;
  }

  private isClaudeFile(relativePath: string): boolean {
    const fileName = basename(relativePath);

    // Claude configuration files
    if (fileName === "CLAUDE.md") return true;

    // Claude directories
    if (
      fileName === ".claude" ||
      relativePath.includes("/.claude/") ||
      relativePath.startsWith(".claude/")
    ) {
      return true;
    }

    // Common MCP server directories
    if (
      fileName === "claudedocs" ||
      relativePath.includes("/claudedocs/") ||
      relativePath.startsWith("claudedocs/")
    ) {
      return true;
    }
    if (
      fileName === ".serena" ||
      relativePath.includes("/.serena/") ||
      relativePath.startsWith(".serena/")
    ) {
      return true;
    }

    // VSCode Claude configuration
    if (
      relativePath.includes("/.vscode/claude.json") ||
      relativePath.startsWith(".vscode/claude.json")
    ) {
      return true;
    }

    // Temporary Claude files (common patterns)
    // Match patterns like: claude-temp.log, claude-temp-123.log, claude-session-temp.log
    if (fileName.startsWith("claude-") && fileName.includes("temp")) {
      return true;
    }
    // Match patterns like: .claude.tmp, .claude_session.tmp, claude.log
    if (fileName.match(/^\.?claude.*\.(tmp|temp|log)$/i)) return true;

    return false;
  }

  private isAllCommonPatternsFile(relativePath: string): boolean {
    const fileName = basename(relativePath);
    const lowerPath = relativePath.toLowerCase();
    const lowerFileName = fileName.toLowerCase();

    // All current default patterns
    if (this.isClaudeFile(relativePath)) return true;

    // Check extended patterns using data-driven approach
    for (const { pattern } of EXTENDED_CLAUDE_PATTERNS) {
      if (fileName.match(pattern)) return true;
    }

    // IDE-specific Claude files (path-based checks)
    if (
      (lowerPath.includes("/.vscode/") ||
        lowerPath.startsWith(".vscode/") ||
        lowerPath.includes("/.idea/") ||
        lowerPath.startsWith(".idea/") ||
        lowerPath.includes("/.eclipse/") ||
        lowerPath.startsWith(".eclipse/")) &&
      lowerFileName.includes("claude")
    ) {
      return true;
    }

    // Directory patterns (path-based checks)
    if (lowerPath.includes("/.claude-") || lowerPath.startsWith(".claude-")) {
      return true;
    }
    if (lowerPath.includes("/.claude_") || lowerPath.startsWith(".claude_")) {
      return true;
    }
    if (lowerPath.includes("/claude_") || lowerPath.startsWith("claude_")) {
      return true;
    }
    if (lowerPath.includes("/claude-") || lowerPath.startsWith("claude-")) {
      return true;
    }

    // Hidden Claude files with additional constraints
    if (
      fileName.startsWith(".") &&
      fileName.includes("claude") &&
      fileName.length > 7 &&
      !fileName.match(/^\.claude\.txt$/i)
    ) {
      return true;
    }

    // Special case: OS metadata files (Thumbs.db, .DS_Store) in claude-related paths
    // This catches files like ".claude/Thumbs.db" that don't have "claude" in their filename
    // Extended patterns (line 131) catch files like "claude-backup.DS_Store"
    if (fileName === "Thumbs.db" && lowerPath.includes("claude")) return true;
    if (fileName === ".DS_Store" && lowerPath.includes("claude")) return true;
    if (fileName === "desktop.ini" && lowerPath.includes("claude")) return true;

    // EXCLUDE simple generic files that should NOT be caught
    if (fileName.match(/^claude\.txt$/i)) return false;
    if (fileName.match(/^include-claude.*$/i)) return false;
    if (
      fileName.match(/^.*claude.*\.txt$/i) &&
      !fileName.match(/^\.?claude[-_]/i)
    ) {
      return false;
    }
    if (fileName.match(/^claudelike\..*$/i)) return false;

    return false;
  }

  private getFileReason(path: string): string {
    const fileName = basename(path);

    // Check if it matches user patterns first
    if (this.matchesUserPatterns(path)) {
      return "User-specified directory pattern";
    }

    // If using all common patterns, provide more specific reasons
    if (this.options.includeAllCommonPatterns) {
      const lowerPath = path.toLowerCase();
      const lowerFileName = fileName.toLowerCase();

      // Default Claude patterns (still provide specific reasons)
      if (fileName === "CLAUDE.md") {
        return "Claude project configuration file";
      }
      if (fileName === ".claude" || path.includes("/.claude/")) {
        return "Claude configuration directory";
      }
      if (fileName === "claudedocs" || path.includes("/claudedocs/")) {
        return "Claude documentation directory (MCP server)";
      }
      if (fileName === ".serena" || path.includes("/.serena/")) {
        return "Serena MCP server directory";
      }
      if (path.includes("/.vscode/claude.json")) {
        return "VSCode Claude extension configuration";
      }

      // IDE integration files (check BEFORE general config patterns to avoid conflicts)
      // Note: This matches IDE directory files with "claude" in the name, but exclusion logic
      // at line 508 filters out "include-claude*" files to prevent false positives
      if (
        (lowerPath.includes("/.vscode/") ||
          lowerPath.startsWith(".vscode/") ||
          lowerPath.includes("/.idea/") ||
          lowerPath.startsWith(".idea/") ||
          lowerPath.includes("/.eclipse/") ||
          lowerPath.startsWith(".eclipse/")) &&
        lowerFileName.includes("claude")
      ) {
        return "IDE Claude integration file";
      }

      // Check extended patterns using data-driven approach
      for (const { pattern, reason } of EXTENDED_CLAUDE_PATTERNS) {
        if (fileName.match(pattern)) {
          return reason;
        }
      }

      // Fall back to general Claude file if matched by all-patterns but not categorized above
      return "Claude-related file (comprehensive pattern match)";
    }

    // Default Claude patterns (original logic)
    if (fileName === "CLAUDE.md") {
      return "Claude project configuration file";
    }

    if (fileName === ".claude" || path.includes("/.claude/")) {
      return "Claude configuration directory";
    }

    if (fileName === "claudedocs" || path.includes("/claudedocs/")) {
      return "Claude documentation directory (MCP server)";
    }

    if (fileName === ".serena" || path.includes("/.serena/")) {
      return "Serena MCP server directory";
    }

    if (path.includes("/.vscode/claude.json")) {
      return "VSCode Claude extension configuration";
    }

    if (fileName.startsWith("claude-") && fileName.includes("temp")) {
      return "Claude temporary file";
    }

    if (fileName.match(/^\.?claude.*\.(tmp|temp|log)$/i)) {
      return "Claude temporary/log file";
    }

    return "Claude-related file";
  }

  async createBackup(): Promise<string> {
    if (!this.options.createBackup) {
      this.logger.verbose("Backup creation skipped");
      return "";
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `claude-cleaner-backup-${timestamp}`;
    const backupPath = join(this.options.repoPath, "..", backupName);

    this.logger.info(`Creating backup: ${backupName}`);

    if (this.options.dryRun) {
      this.logger.info(`[DRY RUN] Would create backup at: ${backupPath}`);
      return backupPath;
    }

    try {
      // Create a bare clone for the backup
      this.logger.info(
        `Running: git clone --bare ${this.options.repoPath} ${backupPath}`,
      );
      await $`git clone --bare ${this.options.repoPath} ${backupPath}`.cwd(
        this.options.repoPath,
      );
      this.logger.verbose(`Backup created at: ${backupPath}`);
      return backupPath;
    } catch (error) {
      throw new AppError(
        `Failed to create backup: ${error instanceof Error ? error.message : String(error)}`,
        "BACKUP_ERROR",
        error instanceof Error ? error : undefined,
      );
    }
  }

  async removeFilesWithBFG(claudeFiles: ClaudeFile[]): Promise<void> {
    if (claudeFiles.length === 0) {
      this.logger.info("No Claude files found to remove");
      return;
    }

    this.logger.info(
      `Removing ${claudeFiles.length} Claude files from Git history...`,
    );

    if (this.options.dryRun) {
      this.logger.info("[DRY RUN] Would remove the following files:");
      for (const file of claudeFiles) {
        let logLine = `  - ${file.path} (${file.reason})`;
        if (file.earliestCommit) {
          logLine += `\n    First appeared in: ${
            formatGitRef(file.earliestCommit.hash)
          } (${file.earliestCommit.date})`;
          logLine += `\n    Commit: ${file.earliestCommit.message}`;
        }
        this.logger.info(logLine);
      }

      // Show commands that would be executed
      const files = claudeFiles.filter((f) => f.type === "file");
      const directories = claudeFiles.filter((f) => f.type === "directory");

      if (files.length > 0 || directories.length > 0) {
        this.logger.info("\n[DRY RUN] Commands that would be executed:");

        if (files.length > 0) {
          const fileNames = files.map((f) => basename(f.path));
          const uniqueFileNames = [...new Set(fileNames)];
          for (const fileName of uniqueFileNames) {
            this.logger.info(
              `  java -jar ${
                this.bfgPath || "<bfg-path>"
              } --delete-files ${fileName} --no-blob-protection ${this.options.repoPath}`,
            );
          }
        }

        if (directories.length > 0) {
          const dirNames = directories.map((d) => basename(d.path));
          const uniqueDirNames = [...new Set(dirNames)];
          for (const dirName of uniqueDirNames) {
            this.logger.info(
              `  java -jar ${
                this.bfgPath || "<bfg-path>"
              } --delete-folders ${dirName} --no-blob-protection ${this.options.repoPath}`,
            );
          }
        }

        this.logger.info(`  git reflog expire --expire=now --all`);
        this.logger.info(`  git gc --prune=now --aggressive`);
      }

      return;
    }

    // Check if BFG is available
    if (!this.bfgPath) {
      throw new AppError(
        "BFG Repo-Cleaner not found. Please install it or use --auto-install",
        "BFG_NOT_FOUND",
      );
    }

    try {
      // BFG only works with filenames, not paths. Separate by type.
      const files = claudeFiles.filter((f) => f.type === "file");
      const directories = claudeFiles.filter((f) => f.type === "directory");

      // Process files
      if (files.length > 0) {
        // Extract just the filename from files (BFG requirement)
        // Note: basename matching means all files with the same name across different
        // directories will be removed (e.g., both src/CLAUDE.md and docs/CLAUDE.md).
        // This is the intended behavior - the tool removes all instances of these patterns.
        const fileNames = files.map((f) => basename(f.path));
        const uniqueFileNames = [...new Set(fileNames)]; // Remove duplicates

        for (const fileName of uniqueFileNames) {
          this.logger.verbose(`Removing files named: ${fileName}`);
          const bfgCmd =
            `java -jar ${this.bfgPath} --delete-files ${fileName} --no-blob-protection ${this.options.repoPath}`;
          this.logger.info(`Running: ${bfgCmd}`);
          await $`java -jar ${this.bfgPath} --delete-files ${fileName} --no-blob-protection ${this.options.repoPath}`;
        }
      }

      // Process directories
      if (directories.length > 0) {
        // Note: basename matching means all directories with the same name across different
        // paths will be removed (e.g., both src/.claude/ and docs/.claude/).
        // This is the intended behavior - the tool removes all instances of these patterns.
        const dirNames = directories.map((d) => basename(d.path));
        const uniqueDirNames = [...new Set(dirNames)]; // Remove duplicates

        for (const dirName of uniqueDirNames) {
          this.logger.verbose(`Removing directories named: ${dirName}`);
          const bfgCmd =
            `java -jar ${this.bfgPath} --delete-folders ${dirName} --no-blob-protection ${this.options.repoPath}`;
          this.logger.info(`Running: ${bfgCmd}`);
          await $`java -jar ${this.bfgPath} --delete-folders ${dirName} --no-blob-protection ${this.options.repoPath}`;
        }
      }

      // Clean up the repository
      this.logger.verbose("Cleaning up Git repository...");
      this.logger.info(`Running: git reflog expire --expire=now --all`);
      await $`git reflog expire --expire=now --all`.cwd(this.options.repoPath);
      this.logger.info(`Running: git gc --prune=now --aggressive`);
      await $`git gc --prune=now --aggressive`.cwd(this.options.repoPath);

      this.logger.info("Files successfully removed from Git history");
    } catch (error) {
      throw new AppError(
        `Failed to remove files with BFG: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "BFG_ERROR",
        error instanceof Error ? error : undefined,
      );
    }
  }

  async setBFGPath(bfgPath: string): Promise<void> {
    if (await fileExists(bfgPath)) {
      this.bfgPath = bfgPath;
      this.logger.verbose(`BFG path set: ${bfgPath}`);
    } else {
      throw new AppError(
        `BFG Repo-Cleaner not found at: ${bfgPath}`,
        "BFG_NOT_FOUND",
      );
    }
  }

  async validateRepository(): Promise<void> {
    const gitDir = join(this.options.repoPath, ".git");

    if (!(await dirExists(gitDir)) && !(await fileExists(gitDir))) {
      throw new AppError(
        `Not a Git repository: ${this.options.repoPath}`,
        "NOT_GIT_REPO",
      );
    }

    try {
      // Check if repo has any commits
      await $`git rev-parse HEAD`.cwd(this.options.repoPath).quiet();
    } catch {
      throw new AppError(
        "Repository has no commits. Cannot clean an empty repository.",
        "EMPTY_REPO",
      );
    }

    this.logger.verbose("Repository validation passed");
  }

  async cleanFiles(): Promise<void> {
    await this.validateRepository();

    const claudeFiles = await this.detectClaudeFiles();

    if (this.options.createBackup) {
      await this.createBackup();
    }

    await this.removeFilesWithBFG(claudeFiles);
  }
}
