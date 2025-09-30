import { $ } from "https://deno.land/x/dax@0.36.0/mod.ts";
import { basename, join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.208.0/fs/walk.ts";
import { AppError, dirExists, fileExists, type Logger } from "./utils.ts";

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
}

export class FileCleaner {
  private logger: Logger;
  private bfgPath: string | null = null;

  constructor(private options: FileCleanerOptions, logger: Logger) {
    this.logger = logger;
  }

  async detectClaudeFiles(): Promise<ClaudeFile[]> {
    const claudeFiles: ClaudeFile[] = [];
    const repoPath = this.options.repoPath;

    // Validate user patterns first
    this.validateDirectoryPatterns();

    this.logger.verbose("Scanning repository for files to remove...");

    try {
      for await (
        const entry of walk(repoPath, {
          includeDirs: true,
          skip: [/\.git$/], // Skip .git directory but allow .claude directories
        })
      ) {
        const relativePath = entry.path.replace(repoPath + "/", "");

        // Skip if this is the root directory
        if (relativePath === repoPath) continue;

        if (this.isTargetFile(entry.path, relativePath)) {
          claudeFiles.push({
            path: relativePath,
            type: entry.isDirectory ? "directory" : "file",
            reason: this.getFileReason(relativePath),
          });
        }
      }
    } catch (error) {
      throw new AppError(
        `Failed to scan repository: ${error instanceof Error ? error.message : String(error)}`,
        "SCAN_ERROR",
        error instanceof Error ? error : undefined,
      );
    }

    this.logger.verbose(`Found ${claudeFiles.length} files/directories to remove`);
    return claudeFiles;
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
        pattern.length === 1 || ["temp", "tmp", "cache", "build"].includes(pattern.toLowerCase())
      ) {
        this.logger.warn(
          `Pattern '${pattern}' may match many directories. Use dry-run to preview before executing.`,
        );
      }
    }
  }

  private isTargetFile(_fullPath: string, relativePath: string): boolean {
    // Check user-defined directory patterns first
    if (this.matchesUserPatterns(relativePath)) return true;

    // If --include-all-common-patterns is enabled, use comprehensive patterns
    if (this.options.includeAllCommonPatterns) {
      return this.isAllCommonPatternsFile(relativePath);
    }

    // Check default Claude patterns (unless disabled)
    if (!this.options.excludeDefaults && this.isClaudeFile(relativePath)) return true;

    return false;
  }

  private matchesUserPatterns(relativePath: string): boolean {
    const fileName = basename(relativePath);

    // Check if this directory name matches any user patterns
    for (const pattern of this.options.includeDirectories) {
      if (fileName === pattern) return true;
    }

    return false;
  }

  private isClaudeFile(relativePath: string): boolean {
    const fileName = basename(relativePath);

    // Claude configuration files
    if (fileName === "CLAUDE.md") return true;

    // Claude directories
    if (fileName === ".claude" || relativePath.includes("/.claude/")) return true;

    // VSCode Claude configuration
    if (relativePath.includes("/.vscode/claude.json")) return true;

    // Temporary Claude files (common patterns)
    if (fileName.startsWith("claude-") && fileName.includes("temp")) return true;
    if (fileName.match(/^\.?claude.*\.(tmp|temp|log)$/i)) return true;

    return false;
  }

  private isAllCommonPatternsFile(relativePath: string): boolean {
    const fileName = basename(relativePath);
    const lowerPath = relativePath.toLowerCase();
    const lowerFileName = fileName.toLowerCase();

    // All current default patterns
    if (this.isClaudeFile(relativePath)) return true;

    // Extended Claude workspace and configuration files (be more specific to avoid false positives)
    if (fileName.match(/^\.?claude[-_.].*\.(json|yaml|yml|toml|ini|config)$/i)) return true;
    if (fileName.match(/^claude[-_]?(config|settings|workspace|env).*$/i)) return true;

    // Claude session and state files
    if (fileName.match(/^\.?claude[-_]?(session|state|cache|history).*$/i)) return true;
    if (fileName.match(/^\.?claude[-_.](session|state|cache|history)$/i)) return true;

    // Claude temporary and working files (expanded patterns)
    if (fileName.match(/^\.?claude[-_]?(temp|tmp|work|scratch|draft).*$/i)) return true;
    if (fileName.match(/^\.?claude\.(temp|tmp|work|scratch|draft)$/i)) return true; // Added for claude.draft
    if (fileName.match(/^\.?claude[-_.].*\.(bak|backup|old|orig|save)$/i)) return true;
    if (fileName.match(/^\.?claude[-_]?(output|result|analysis|report).*$/i)) return true;

    // Claude lock and process files - more flexible patterns
    if (fileName.match(/^\.?claude.*\.(lock|pid|socket)$/i)) return true;
    if (fileName.match(/^\.?claude[-_]?(lock|process|run).*$/i)) return true;

    // Claude debug and diagnostic files - more flexible patterns
    if (fileName.match(/^\.?claude[-_]?(debug|trace|profile|diagnostic).*$/i)) return true;
    if (fileName.match(/^\.?claude.*\.(debug|trace|profile|diagnostic)$/i)) return true;
    if (fileName.match(/^\.?claude\.(diagnostic|lock|pid|socket)$/i)) return true; // Direct extensions

    // Claude export and archive files
    if (fileName.match(/^\.?claude[-_]?(export|archive|dump|snapshot).*$/i)) return true;
    if (fileName.match(/^\.?claude[-_.].*\.(export|archive|dump|snapshot)$/i)) return true;

    // VS Code and IDE-specific Claude files (expanded to handle paths without leading slash)
    if (
      (lowerPath.includes("/.vscode/") || lowerPath.startsWith(".vscode/")) &&
      lowerFileName.includes("claude")
    ) return true;
    if (
      (lowerPath.includes("/.idea/") || lowerPath.startsWith(".idea/")) &&
      lowerFileName.includes("claude")
    ) return true;
    if (
      (lowerPath.includes("/.eclipse/") || lowerPath.startsWith(".eclipse/")) &&
      lowerFileName.includes("claude")
    ) return true;

    // Claude directories (expanded patterns)
    if (fileName.match(/^\.?claude[-_]?(workspace|project|sessions?|temp|cache|data)$/i)) {
      return true;
    }
    if (lowerPath.includes("/.claude-") || lowerPath.includes("/claude_")) return true;

    // Claude documentation and notes (be more specific to avoid false positives)
    if (fileName.match(/^claude[-_]?(notes?|docs?|readme|instructions?).*\.(md|txt|rst)$/i)) {
      return true;
    }
    if (fileName.match(/^\.claude[-_.].*\.(notes?|md|txt|rst)$/i)) return true;

    // Claude scripts and executables
    if (fileName.match(/^\.?claude[-_]?(script|tool|utility|helper).*$/i)) return true;
    if (fileName.match(/^\.?claude[-_.].*\.(sh|bat|ps1|py|js|ts)$/i)) return true;

    // Hidden Claude files and dotfiles (be more specific)
    if (fileName.match(/^\.claude[a-z0-9_-]+$/i)) return true; // Require at least one character after .claude
    if (
      fileName.startsWith(".") && fileName.includes("claude") && fileName.length > 7 &&
      !fileName.match(/^\.claude\.txt$/i)
    ) return true;

    // Claude numbered/versioned files
    if (fileName.match(/^\.?claude[-_]?.*[0-9]+.*$/i)) return true;
    if (fileName.match(/^\.?claude.*v[0-9]+.*$/i)) return true;

    // OS-specific Claude files
    if (fileName.match(/^\.?claude[-_.].*\.(DS_Store|Thumbs\.db|desktop\.ini)$/i)) return true;
    if (fileName === "Thumbs.db" && lowerPath.includes("claude")) return true;

    // EXCLUDE simple generic files that should NOT be caught
    if (fileName.match(/^claude\.txt$/i)) return false;
    if (fileName.match(/^include-claude.*$/i)) return false;
    if (fileName.match(/^.*claude.*\.txt$/i) && !fileName.match(/^\.?claude[-_]/i)) return false;
    if (fileName.match(/^claudelike\..*$/i)) return false; // Exclude claudelike.* files

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
      if (path.includes("/.vscode/claude.json")) {
        return "VSCode Claude extension configuration";
      }

      // IDE integration files (check BEFORE general config patterns to avoid conflicts)
      if (
        ((lowerPath.includes("/.vscode/") || lowerPath.startsWith(".vscode/")) ||
          (lowerPath.includes("/.idea/") || lowerPath.startsWith(".idea/")) ||
          (lowerPath.includes("/.eclipse/") || lowerPath.startsWith(".eclipse/"))) &&
        lowerFileName.includes("claude")
      ) {
        return "IDE Claude integration file";
      }

      // Extended patterns - more general categories
      if (fileName.match(/^\.?claude.*\.(json|yaml|yml|toml|ini|config)$/i)) {
        return "Claude configuration file (extended pattern)";
      }
      if (fileName.match(/^claude[-_]?(config|settings|workspace|env).*$/i)) {
        return "Claude workspace/settings file";
      }
      if (fileName.match(/^\.?claude[-_]?(session|state|cache|history).*$/i)) {
        return "Claude session/state file";
      }
      if (
        fileName.match(/^\.?claude[-_]?(temp|tmp|work|scratch|draft).*$/i) ||
        fileName.match(/^\.?claude\.(temp|tmp|work|scratch|draft)$/i)
      ) {
        return "Claude temporary/working file";
      }
      if (fileName.match(/^\.?claude.*\.(bak|backup|old|orig|save)$/i)) {
        return "Claude backup file";
      }
      if (fileName.match(/^\.?claude[-_]?(output|result|analysis|report).*$/i)) {
        return "Claude output/analysis file";
      }
      if (
        fileName.match(/^\.?claude.*\.(lock|pid|socket)$/i) ||
        fileName.match(/^\.?claude[-_]?(lock|process|run).*$/i)
      ) {
        return "Claude process/lock file";
      }
      if (
        fileName.match(/^\.?claude[-_]?(debug|trace|profile|diagnostic).*$/i) ||
        fileName.match(/^\.?claude.*\.(debug|trace|profile|diagnostic)$/i) ||
        fileName.match(/^\.?claude\.(diagnostic)$/i)
      ) {
        return "Claude debug/diagnostic file";
      }
      if (fileName.match(/^\.?claude[-_]?(export|archive|dump|snapshot).*$/i)) {
        return "Claude export/archive file";
      }
      if (fileName.match(/^\.?claude[-_]?(workspace|project|sessions?|temp|cache|data)$/i)) {
        return "Claude workspace directory";
      }
      if (fileName.match(/^claude[-_]?(notes?|docs?|readme|instructions?).*\.(md|txt|rst)$/i)) {
        return "Claude documentation file";
      }
      if (fileName.match(/^\.?claude[-_]?(script|tool|utility|helper).*$/i)) {
        return "Claude script/utility file";
      }
      if (fileName.match(/^\.claude[a-z0-9_-]+$/i)) {
        return "Claude hidden/dot file";
      }
      if (fileName.match(/^\.?claude[-_]?.*[0-9]+.*$/i)) {
        return "Claude numbered/versioned file";
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
      await $`git clone --bare ${this.options.repoPath} ${backupPath}`.cwd(this.options.repoPath);
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

    this.logger.info(`Removing ${claudeFiles.length} Claude files from Git history...`);

    if (this.options.dryRun) {
      this.logger.info("[DRY RUN] Would remove the following files:");
      for (const file of claudeFiles) {
        this.logger.info(`  - ${file.path} (${file.reason})`);
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
          await $`java -jar ${this.bfgPath} --delete-files ${fileName} --no-blob-protection ${this.options.repoPath}`;
        }
      }

      // Process directories
      if (directories.length > 0) {
        const dirNames = directories.map((d) => basename(d.path));
        const uniqueDirNames = [...new Set(dirNames)]; // Remove duplicates

        for (const dirName of uniqueDirNames) {
          this.logger.verbose(`Removing directories named: ${dirName}`);
          await $`java -jar ${this.bfgPath} --delete-folders ${dirName} --no-blob-protection ${this.options.repoPath}`;
        }
      }

      // Clean up the repository
      this.logger.verbose("Cleaning up Git repository...");
      await $`git reflog expire --expire=now --all`.cwd(this.options.repoPath);
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

    if (!await dirExists(gitDir) && !await fileExists(gitDir)) {
      throw new AppError(
        `Not a Git repository: ${this.options.repoPath}`,
        "NOT_GIT_REPO",
      );
    }

    try {
      // Check if repo has any commits
      await $`git rev-parse HEAD`.cwd(this.options.repoPath);
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
