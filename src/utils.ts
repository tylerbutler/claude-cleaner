import { exists } from "@std/fs";
import { dirname, join, resolve } from "@std/path";

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  verbose(message: string): void;
  debug(message: string): void;
}

export class ConsoleLogger implements Logger {
  constructor(private verboseMode = false) {}

  info(message: string): void {
    console.log(message);
  }

  warn(message: string): void {
    console.warn(`[WARN] ${message}`);
  }

  error(message: string): void {
    console.error(`[ERROR] ${message}`);
  }

  verbose(message: string): void {
    if (this.verboseMode) {
      console.log(`[VERBOSE] ${message}`);
    }
  }

  debug(message: string): void {
    if (this.verboseMode) {
      console.log(`[DEBUG] ${message}`);
    }
  }
}

export interface PathUtils {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
  dirname(path: string): string;
  exists(path: string): Promise<boolean>;
  isAbsolute(path: string): boolean;
  normalize(path: string): string;
}

export class CrossPlatformPathUtils implements PathUtils {
  join(...paths: string[]): string {
    return join(...(paths as [string, ...string[]]));
  }

  resolve(...paths: string[]): string {
    return resolve(...(paths as [string, ...string[]]));
  }

  dirname(path: string): string {
    return dirname(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await exists(path);
    } catch {
      return false;
    }
  }

  isAbsolute(path: string): boolean {
    return resolve(path) === path;
  }

  normalize(path: string): string {
    return resolve(path);
  }
}

export interface SystemInfo {
  platform: string;
  arch: string;
  homeDir: string | undefined;
}

export function getSystemInfo(): SystemInfo {
  return {
    platform: Deno.build.os,
    arch: Deno.build.arch,
    homeDir: Deno.env.get("HOME") || Deno.env.get("USERPROFILE"),
  };
}

export async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isFile;
  } catch {
    return false;
  }
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]!}`;
}

export function escapeShellArg(arg: string): string {
  if (Deno.build.os === "windows") {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return `'${arg.replace(/'/g, "'\"'\"'")}'`;
}

export function formatGitRef(ref: string): string {
  // ANSI codes: bold blue for first 8 chars, regular blue for rest
  const shortRef = ref.substring(0, 8);
  const rest = ref.substring(8);
  return `\x1b[1;34m${shortRef}\x1b[0;34m${rest}\x1b[0m`;
}

export type ErrorCode =
  | "BACKUP_CREATION_FAILED"
  | "BACKUP_ERROR"
  | "BACKUP_FAILED"
  | "BFG_DOWNLOAD_ERROR"
  | "BFG_DOWNLOAD_FAILED"
  | "BFG_DOWNLOAD_VERIFICATION_FAILED"
  | "BFG_ERROR"
  | "BFG_NOT_AVAILABLE"
  | "BFG_NOT_FOUND"
  | "COMMIT_CLEANING_FAILED"
  | "COMMIT_LIST_FAILED"
  | "COMMIT_MESSAGE_FAILED"
  | "DEPENDENCY_CHECK_FAILED"
  | "EMPTY_REPO"
  | "FILE_READ_ERROR"
  | "FILTER_BRANCH_FAILED"
  | "GET_BRANCH_FAILED"
  | "GIT_VALIDATION_FAILED"
  | "INVALID_FILENAME"
  | "INVALID_OPTIONS"
  | "INVALID_PATTERN"
  | "JAVA_CONFIG_FAILED"
  | "JAVA_INSTALL_ERROR"
  | "JAVA_INSTALL_FAILED"
  | "MISE_INSTALL_FAILED"
  | "MISSING_DEPENDENCIES"
  | "NOT_GIT_REPO"
  | "REPO_PATH_REQUIRED"
  | "SCAN_ERROR"
  | "SD_CONFIG_FAILED"
  | "SD_INSTALL_ERROR"
  | "SD_INSTALL_FAILED"
  | "SD_NOT_AVAILABLE"
  | "UNSUPPORTED_PLATFORM"
  | "WORKING_TREE_CHECK_FAILED"
  | "WORKING_TREE_DIRTY";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export async function loadDirectoryPatterns(
  includeDirs: string[] | undefined,
  includeDirsFile: string | undefined,
  logger: Logger,
): Promise<string[]> {
  const patterns: string[] = [...(includeDirs || [])];

  if (includeDirsFile) {
    try {
      const fileContent = await Deno.readTextFile(includeDirsFile);
      const fileDirs = fileContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      patterns.push(...fileDirs);
      logger.verbose(
        `Loaded ${fileDirs.length} directory patterns from ${includeDirsFile}`,
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

  return patterns;
}

export interface DependencyCheckResult {
  tool: string;
  available: boolean;
  version?: string | undefined;
  path?: string | undefined;
  error?: string | undefined;
}

export function checkForMissingDependencies(
  depResults: DependencyCheckResult[],
  isDryRun: boolean,
  logger: Logger,
): void {
  const missingDeps = depResults.filter((result) => !result.available);

  if (missingDeps.length > 0 && !isDryRun) {
    logger.error("Missing required dependencies:");
    for (const dep of missingDeps) {
      logger.error(`  - ${dep.tool}: ${dep.error || "not found"}`);
    }
    logger.info(
      "Run with --auto-install to install dependencies automatically",
    );
    throw new AppError("Missing dependencies", "MISSING_DEPENDENCIES");
  }
}
