import { basename, globToRegExp, join } from "@std/path";
import { $, CommandBuilder } from "dax";
import { AppError, dirExists, fileExists, formatGitRef, type Logger } from "./utils.ts";

// Hybrid pattern system: use glob for simple patterns, RegExp for complex ones
interface PatternConfig {
  pattern: string | RegExp;
  type: "glob" | "regex";
  reason: string;
}

// Claude file patterns using hybrid approach (glob for readability, regex for flexibility)
const EXTENDED_CLAUDE_PATTERNS: PatternConfig[] = [
  // Configuration files - regex for proper word boundary
  {
    pattern: /^\.?claude[-_.].*\.(json|yaml|yml|toml|ini|config)$/i,
    type: "regex",
    reason: "Claude configuration file (extended pattern)",
  },
  {
    pattern: /^\.?claude\.(json|yaml|yml|toml|ini|config)$/i,
    type: "regex",
    reason: "Claude configuration file (extended pattern)",
  },
  {
    pattern: /^claude[-_]?(config|settings|workspace|env).*$/i,
    type: "regex",
    reason: "Claude workspace/settings file",
  },

  // Session and state files - regex for flexibility with dot separator
  {
    pattern: /^\.?claude[-_.]?(session|state|cache|history).*$/i,
    type: "regex",
    reason: "Claude session/state file",
  },

  // Backup files - extended glob
  {
    pattern: "?(.)claude?(-|_|.)*.@(bak|backup|old|orig|save)",
    type: "glob",
    reason: "Claude backup file",
  },

  // Temporary and working files - regex for flexibility with dot separator
  {
    pattern: /^\.?claude[-_.]?(temp|tmp|work|scratch|draft).*$/i,
    type: "regex",
    reason: "Claude temporary/working file",
  },
  {
    pattern: /^\.?claude[-_.]?(output|result|analysis|report).*$/i,
    type: "regex",
    reason: "Claude output/analysis file",
  },

  // Lock and process files - extended glob
  {
    pattern: "?(.)claude*.@(lock|pid|socket)",
    type: "glob",
    reason: "Claude process/lock file",
  },
  {
    pattern: "?(.)claude?(-|_)@(lock|process|run)*",
    type: "glob",
    reason: "Claude process/lock file",
  },

  // Debug and diagnostic files - extended glob
  {
    pattern: "?(.)claude?(-|_)@(debug|trace|profile|diagnostic)*",
    type: "glob",
    reason: "Claude debug/diagnostic file",
  },
  {
    pattern: "?(.)claude*.@(debug|trace|profile|diagnostic)",
    type: "glob",
    reason: "Claude debug/diagnostic file",
  },

  // Export and archive files - extended glob
  {
    pattern: "?(.)claude?(-|_)@(export|archive|dump|snapshot)*",
    type: "glob",
    reason: "Claude export/archive file",
  },
  {
    pattern: "?(.)claude?(-|_|.)*.@(export|archive|dump|snapshot)",
    type: "glob",
    reason: "Claude export/archive file",
  },

  // Workspace directories - extended glob
  {
    pattern: "?(.)claude?(-|_)@(workspace|project|session|sessions|temp|cache|data)",
    type: "glob",
    reason: "Claude workspace directory",
  },

  // Documentation files - regex for flexibility
  {
    pattern: /^claude[-_.]?(notes?|docs?|readme|instructions?).*\.(md|txt|rst)$/i,
    type: "regex",
    reason: "Claude documentation file",
  },
  {
    pattern: /^\.claude[-_.].*\.(notes?|readme|md|txt|rst)$/i,
    type: "regex",
    reason: "Claude documentation file",
  },
  {
    pattern: /^\.claude\.(notes?|readme|md|txt|rst)$/i,
    type: "regex",
    reason: "Claude documentation file",
  },

  // Scripts and executables - extended glob
  {
    pattern: "?(.)claude?(-|_)@(script|tool|utility|helper)*",
    type: "glob",
    reason: "Claude script/utility file",
  },
  {
    pattern: "?(.)claude?(-|_|.)*.@(sh|bat|ps1|py|js|ts)",
    type: "glob",
    reason: "Claude script/utility file",
  },

  // Hidden files and dotfiles - regex required for character classes
  {
    pattern: /^\.claude[a-z0-9_-]+$/i,
    type: "regex",
    reason: "Claude hidden/dot file",
  },

  // Numbered/versioned files - regex required for numeric matching
  {
    pattern: /^\.?claude[-_]?.*[0-9]+.*$/i,
    type: "regex",
    reason: "Claude numbered/versioned file",
  },
  {
    pattern: /^\.?claude.*v[0-9]+.*$/i,
    type: "regex",
    reason: "Claude numbered/versioned file",
  },

  // OS-specific files - glob is readable here
  {
    pattern: ".claude*.DS_Store",
    type: "glob",
    reason: "Claude OS-specific file",
  },
  {
    pattern: "claude*.DS_Store",
    type: "glob",
    reason: "Claude OS-specific file",
  },
  {
    pattern: ".claude*.Thumbs.db",
    type: "glob",
    reason: "Claude OS-specific file",
  },
  {
    pattern: "claude*.Thumbs.db",
    type: "glob",
    reason: "Claude OS-specific file",
  },

  // IDE integration files - glob is perfect for path wildcards
  {
    pattern: "**/.vscode/*claude*",
    type: "glob",
    reason: "IDE Claude integration file",
  },
  {
    pattern: "**/.idea/*claude*",
    type: "glob",
    reason: "IDE Claude integration file",
  },
  {
    pattern: "**/.eclipse/*claude*",
    type: "glob",
    reason: "IDE Claude integration file",
  },

  // Directory patterns for path matching - glob is clearer
  {
    pattern: "**/.claude-*/**",
    type: "glob",
    reason: "Claude directory (extended pattern)",
  },
  {
    pattern: "**/.claude_*/**",
    type: "glob",
    reason: "Claude directory (extended pattern)",
  },
  {
    pattern: "**/claude-*/**",
    type: "glob",
    reason: "Claude directory (extended pattern)",
  },
  {
    pattern: "**/claude_*/**",
    type: "glob",
    reason: "Claude directory (extended pattern)",
  },
];

// Hybrid pattern matcher: uses glob for simple patterns, regex for complex ones
class PatternMatcher {
  private patterns: Array<{ regex: RegExp; reason: string }>;

  constructor(patterns: PatternConfig[]) {
    this.patterns = patterns.map(({ pattern, type, reason }) => {
      let regex: RegExp;

      if (type === "glob") {
        // Convert glob to RegExp and make it case-insensitive
        const baseRegex = globToRegExp(pattern as string, { extended: true, globstar: true });
        regex = new RegExp(baseRegex.source, baseRegex.flags + "i");
      } else {
        // Use RegExp directly (already case-insensitive with /i flag)
        regex = pattern as RegExp;
      }

      return { regex, reason };
    });
  }

  matches(path: string): boolean {
    return this.patterns.some(({ regex }) => regex.test(path));
  }

  getReason(path: string): string | undefined {
    const match = this.patterns.find(({ regex }) => regex.test(path));
    return match?.reason;
  }
}

// Create pattern matcher instance with hybrid patterns
const extendedPatternMatcher = new PatternMatcher(EXTENDED_CLAUDE_PATTERNS);

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

    // All current default patterns
    if (this.isClaudeFile(relativePath)) return true;

    // Check if path matches any extended glob pattern
    if (extendedPatternMatcher.matches(relativePath)) return true;

    // Check if just the filename matches (for files in subdirectories)
    if (extendedPatternMatcher.matches(fileName)) return true;

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

      // Check extended patterns using pattern matcher
      const reason = extendedPatternMatcher.getReason(path) ||
        extendedPatternMatcher.getReason(fileName);
      if (reason) {
        return reason;
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
