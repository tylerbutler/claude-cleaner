import { join } from "@std/path";
import { $ } from "dax";
import type { Logger } from "./utils.ts";
import { AppError, ensureDir, fileExists, getSystemInfo } from "./utils.ts";

export interface Tool {
  name: string;
  type: "mise" | "download";
  version?: string;
  downloadUrl?: string;
  executable?: string;
}

export interface DependencyCheckResult {
  tool: string;
  available: boolean;
  version?: string | undefined;
  path?: string | undefined;
  error?: string | undefined;
}

export class DependencyManager {
  private readonly cacheDir: string;
  private readonly bfgJarPath: string;
  private misePath: string | undefined;

  constructor(
    private readonly logger: Logger,
    cacheDir?: string,
  ) {
    const systemInfo = getSystemInfo();
    this.cacheDir = cacheDir ||
      join(systemInfo.homeDir || "/tmp", ".cache", "claude-cleaner");
    this.bfgJarPath = join(this.cacheDir, "bfg-1.14.0.jar");
  }

  async ensureMiseInstalled(): Promise<void> {
    // Check if mise is already installed and get its path
    const existingPath = await this.findExecutablePath("mise");
    if (existingPath) {
      this.misePath = existingPath;
      this.logger.verbose(`mise is already installed at: ${existingPath}`);
      return;
    }

    const systemInfo = getSystemInfo();

    // Skip installation on Windows - user must install mise manually
    if (systemInfo.platform === "win32") {
      throw new AppError(
        "mise is not installed. On Windows, automatic installation is not supported. Please install mise manually from https://mise.jdx.dev/installing-mise.html or install dependencies directly: Java 17+, sd (https://github.com/chmln/sd)",
        "MISE_NOT_FOUND",
      );
    }

    this.logger.info("Installing mise...");

    if (systemInfo.platform === "linux" || systemInfo.platform === "darwin") {
      const installResult = await $`curl -fsSL https://mise.run | sh`.noThrow();
      if (installResult.code !== 0) {
        throw new AppError(
          "Failed to install mise",
          "MISE_INSTALL_FAILED",
          new Error(installResult.stderr),
        );
      }

      // Set mise path to standard installation location
      this.misePath = join(systemInfo.homeDir || "/tmp", ".local", "bin", "mise");

      // Add mise to PATH for this session
      const miseDir = join(systemInfo.homeDir || "/tmp", ".local", "bin");
      const currentPath = Deno.env.get("PATH") || "";
      Deno.env.set("PATH", `${miseDir}:${currentPath}`);

      this.logger.info("mise installed successfully");
    } else {
      throw new AppError(
        "Automatic mise installation not supported on this platform. Please install mise manually from https://mise.jdx.dev/",
        "UNSUPPORTED_PLATFORM",
      );
    }
  }

  async installJava(): Promise<void> {
    this.logger.info("Installing Java via mise...");

    try {
      const miseCmd = this.misePath || "mise";

      // Install Java 17 (LTS version that works well with BFG)
      const installResult = await $`${miseCmd} install java@17`
        .stdout("piped")
        .stderr("piped")
        .noThrow();
      if (installResult.code !== 0) {
        throw new AppError(
          "Failed to install Java via mise",
          "JAVA_INSTALL_FAILED",
          new Error(installResult.stderr),
        );
      }

      // Use Java globally
      const useResult = await $`${miseCmd} use -g java@17`
        .stdout("piped")
        .stderr("piped")
        .noThrow();
      if (useResult.code !== 0) {
        throw new AppError(
          "Failed to configure Java globally",
          "JAVA_CONFIG_FAILED",
          new Error(useResult.stderr),
        );
      }

      this.logger.info("Java 17 installed and configured successfully");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Unexpected error installing Java",
        "JAVA_INSTALL_ERROR",
        error as Error,
      );
    }
  }

  async installSd(): Promise<void> {
    this.logger.info("Installing sd via mise...");

    try {
      const miseCmd = this.misePath || "mise";
      this.logger.verbose(`Using mise command: ${miseCmd}`);

      const installResult = await $`${miseCmd} install sd`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      this.logger.verbose(
        `mise install sd result: code=${installResult.code}, stdout=${installResult.stdout}, stderr=${installResult.stderr}`,
      );

      if (installResult.code !== 0) {
        throw new AppError(
          `Failed to install sd via mise: ${installResult.stderr}`,
          "SD_INSTALL_FAILED",
          new Error(installResult.stderr),
        );
      }

      const useResult = await $`${miseCmd} use -g sd`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      this.logger.verbose(
        `mise use -g sd result: code=${useResult.code}, stderr=${useResult.stderr}`,
      );

      if (useResult.code !== 0) {
        throw new AppError(
          `Failed to configure sd globally: ${useResult.stderr}`,
          "SD_CONFIG_FAILED",
          new Error(useResult.stderr),
        );
      }

      this.logger.info("sd installed and configured successfully");
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Unexpected error installing sd",
        "SD_INSTALL_ERROR",
        error as Error,
      );
    }
  }

  async downloadBfgJar(): Promise<void> {
    if (await fileExists(this.bfgJarPath)) {
      this.logger.verbose(`BFG JAR already exists at ${this.bfgJarPath}`);
      return;
    }

    this.logger.info("Downloading BFG Repo-Cleaner JAR...");

    try {
      await ensureDir(this.cacheDir);

      const downloadUrl = "https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar";
      const downloadResult = await $`curl -fsSL -o ${this.bfgJarPath} ${downloadUrl}`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      if (downloadResult.code !== 0) {
        throw new AppError(
          "Failed to download BFG JAR",
          "BFG_DOWNLOAD_FAILED",
          new Error(downloadResult.stderr),
        );
      }

      // Verify the download
      if (!(await fileExists(this.bfgJarPath))) {
        throw new AppError(
          "BFG JAR download completed but file not found",
          "BFG_DOWNLOAD_VERIFICATION_FAILED",
        );
      }

      this.logger.info(`BFG JAR downloaded successfully to ${this.bfgJarPath}`);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        "Unexpected error downloading BFG JAR",
        "BFG_DOWNLOAD_ERROR",
        error as Error,
      );
    }
  }

  async checkDependency(tool: string): Promise<DependencyCheckResult> {
    try {
      const miseCmd = this.misePath || "mise";

      switch (tool) {
        case "java": {
          // Try mise exec first (for tools installed via mise)
          let result = await $`${miseCmd} exec -- java -version`
            .stdout("piped")
            .stderr("piped")
            .noThrow();

          // Fall back to direct command if mise exec fails
          if (result.code !== 0) {
            result = await $`java -version`
              .stdout("piped")
              .stderr("piped")
              .noThrow();
          }

          if (result.code === 0) {
            // Java version output goes to stderr
            const versionMatch = result.stderr.match(/version "([^"]+)"/);
            return {
              tool,
              available: true,
              version: versionMatch?.[1] || "unknown",
              path: (await this.findExecutablePath("java")) || undefined,
            };
          }
          return { tool, available: false, error: result.stderr };
        }

        case "sd": {
          // Try mise exec first (for tools installed via mise)
          let result = await $`${miseCmd} exec -- sd --version`
            .stdout("piped")
            .stderr("piped")
            .noThrow();

          // Fall back to direct command if mise exec fails
          if (result.code !== 0) {
            result = await $`sd --version`
              .stdout("piped")
              .stderr("piped")
              .noThrow();
          }

          if (result.code === 0) {
            return {
              tool,
              available: true,
              version: result.stdout.trim(),
              path: (await this.findExecutablePath("sd")) || undefined,
            };
          }
          return { tool, available: false, error: result.stderr };
        }

        case "bfg": {
          const exists = await fileExists(this.bfgJarPath);
          if (exists) {
            return {
              tool,
              available: true,
              version: "1.14.0",
              path: this.bfgJarPath,
            };
          }
          return { tool, available: false, error: "BFG JAR not found" };
        }

        case "mise": {
          // Try to find mise path if not already set
          if (!this.misePath) {
            this.misePath = (await this.findExecutablePath("mise")) ||
              undefined;
          }

          const miseCheckCmd = this.misePath || "mise";
          const result = await $`${miseCheckCmd} --version`
            .stdout("piped")
            .stderr("piped")
            .noThrow();
          if (result.code === 0) {
            return {
              tool,
              available: true,
              version: result.stdout.trim(),
              path: this.misePath,
            };
          }
          return { tool, available: false, error: result.stderr };
        }

        default:
          return { tool, available: false, error: "Unknown tool" };
      }
    } catch (error) {
      return {
        tool,
        available: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkAllDependencies(): Promise<DependencyCheckResult[]> {
    const tools = ["mise", "java", "sd", "bfg"];
    const results: DependencyCheckResult[] = [];

    for (const tool of tools) {
      const result = await this.checkDependency(tool);
      results.push(result);
    }

    return results;
  }

  async installAllDependencies(): Promise<void> {
    this.logger.info("Installing all dependencies...");

    // Ensure mise is installed first
    await this.ensureMiseInstalled();

    // Install tools via mise
    await this.installJava();
    await this.installSd();

    // Regenerate shims to make tools available in PATH
    await this.reshimMise();

    // Download BFG JAR
    await this.downloadBfgJar();

    this.logger.info("All dependencies installed successfully");
  }

  private async reshimMise(): Promise<void> {
    try {
      const miseCmd = this.misePath || "mise";
      const result = await $`${miseCmd} reshim`
        .stdout("piped")
        .stderr("piped")
        .noThrow();
      if (result.code !== 0) {
        this.logger.warn(`mise reshim returned non-zero exit code: ${result.stderr}`);
      }
    } catch (error) {
      // Non-fatal - log warning but continue
      this.logger.warn(`Failed to reshim mise: ${error}`);
    }
  }

  getBfgJarPath(): string {
    return this.bfgJarPath;
  }

  private async findExecutablePath(
    command: string,
  ): Promise<string | undefined> {
    try {
      const systemInfo = getSystemInfo();
      const isWindows = systemInfo.platform === "win32";

      // Use 'where' on Windows, 'which' on Unix-like systems
      const findCommand = isWindows ? "where" : "which";
      const result = await $`${findCommand} ${command}`
        .stdout("piped")
        .stderr("piped")
        .noThrow();

      this.logger.verbose(
        `findExecutablePath(${command}): code=${result.code}, stdout=${result.stdout}, stderr=${result.stderr}`,
      );

      if (result.code === 0) {
        // 'where' on Windows can return multiple paths, take the first one
        const output = result.stdout.trim();
        const path = isWindows ? output.split("\n")[0]?.trim() : output;
        this.logger.verbose(`Found ${command} at: ${path}`);
        return path;
      }

      // On Windows, if 'where' fails, try common mise installation locations
      if (isWindows && command === "mise") {
        const homeDir = systemInfo.homeDir || "";
        // According to mise docs, Windows default is %LOCALAPPDATA%\mise\mise
        const commonPaths = [
          join(homeDir, "AppData", "Local", "mise", "mise"),
          join(homeDir, "AppData", "Local", "mise", "mise.exe"),
          join(homeDir, ".local", "bin", "mise"),
          join(homeDir, ".local", "bin", "mise.exe"),
        ];

        this.logger.verbose(
          `Checking Windows fallback paths: ${commonPaths.join(", ")}`,
        );

        for (const checkPath of commonPaths) {
          this.logger.verbose(`Checking if exists: ${checkPath}`);
          if (await fileExists(checkPath)) {
            this.logger.verbose(`Found mise at fallback path: ${checkPath}`);
            return checkPath;
          }
        }
      }
    } catch (error) {
      this.logger.verbose(
        `findExecutablePath(${command}) failed: ${error}`,
      );
    }
    this.logger.verbose(`findExecutablePath(${command}): not found`);
    return undefined;
  }
}
