import { $ } from "dax";
import type { Logger } from "./utils.ts";
import { AppError, escapeShellArg } from "./utils.ts";

export interface CommitCleanOptions {
  dryRun?: boolean | undefined;
  verbose?: boolean | undefined;
  branchToClean?: string | undefined;
}

export interface ClaudeTrailerPattern {
  name: string;
  pattern: string;
  description: string;
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
  private readonly claudeTrailerPatterns: ClaudeTrailerPattern[] = [
    {
      name: "claude-code-generated",
      pattern: "🤖 Generated with \\[Claude Code\\]\\([^)]+\\)",
      description: "Claude Code generation attribution",
    },
    {
      name: "claude-coauthor",
      pattern: "Co-Authored-By: Claude <noreply@anthropic\\.com>",
      description: "Claude co-author trailer",
    },
    {
      name: "claude-emoji-attribution",
      pattern: "🤖[^\\n]*Claude[^\\n]*",
      description: "Claude emoji attribution lines",
    },
    {
      name: "claude-generated-generic",
      pattern: "Generated with Claude[^\\n]*",
      description: "Generic Claude generation attribution",
    },
  ];

  constructor(
    private readonly logger: Logger,
    private readonly sdPath: string = "sd",
  ) {}

  async cleanCommits(options: CommitCleanOptions = {}): Promise<CommitCleanResult> {
    const branch = options.branchToClean || "HEAD";

    this.logger.info(`Starting commit cleaning for branch: ${branch}`);

    // First, analyze what we would clean
    const analysis = await this.analyzeCommits(branch);

    if (options.dryRun) {
      this.logger.info("Dry-run mode: showing preview of changes");
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

    this.logger.info(`Found ${analysis.commitsWithClaudeTrailers} commits with Claude trailers`);
    this.logger.info("Starting git filter-branch to clean commit messages...");

    await this.executeCommitCleaning(branch, analysis.earliestCommitWithTrailer);

    this.logger.info("Commit cleaning completed successfully");
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
      const { cleanedMessage, trailersFound } = this.cleanCommitMessage(originalMessage);

      if (trailersFound.length > 0) {
        commitsWithTrailers++;
        totalTrailersRemoved += trailersFound.length;
        // Track the earliest commit (last in chronological order since rev-list returns newest-first)
        earliestCommitWithTrailer = commit.sha;

        preview.push({
          sha: commit.sha,
          shortSha: commit.sha.substring(0, 7),
          originalMessage,
          cleanedMessage,
          trailersFound,
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

  private async getCommitList(branch: string): Promise<Array<{ sha: string; subject: string }>> {
    try {
      const result = await $`git rev-list --format="%H|%s" ${branch}`.stdout("piped").stderr(
        "piped",
      );

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
      const result = await $`git log -1 --format=%B ${sha}`.stdout("piped").stderr("piped");
      return result.stdout;
    } catch (error) {
      throw new AppError(
        `Failed to get commit message for ${sha}`,
        "COMMIT_MESSAGE_FAILED",
        error as Error,
      );
    }
  }

  private cleanCommitMessage(message: string): { cleanedMessage: string; trailersFound: string[] } {
    let cleanedMessage = message;
    const trailersFound: string[] = [];

    for (const pattern of this.claudeTrailerPatterns) {
      const regex = new RegExp(pattern.pattern, "gm");
      const matches = message.match(regex);

      if (matches) {
        trailersFound.push(...matches);
        cleanedMessage = cleanedMessage.replace(regex, "");
      }
    }

    // Clean up multiple consecutive newlines and trim
    cleanedMessage = cleanedMessage
      .replace(/\n{3,}/g, "\n\n") // Replace 3+ newlines with 2
      .replace(/\n\s*\n\s*$/g, "\n") // Remove trailing newlines and whitespace
      .trim();

    // Ensure there's exactly one newline at the end if the message isn't empty
    if (cleanedMessage && !cleanedMessage.endsWith("\n")) {
      cleanedMessage += "\n";
    }

    return { cleanedMessage, trailersFound };
  }

  private async executeCommitCleaning(
    branch: string,
    earliestCommitWithTrailer?: string,
  ): Promise<void> {
    try {
      // Create a TypeScript script for the msg-filter that's more reliable than shell scripts
      const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-" });
      const scriptPath = `${tempDir}/clean-msg.ts`;

      // Create the cleaning script in TypeScript
      const scriptContent = this.generateTypeScriptCleaningScript();
      await Deno.writeTextFile(scriptPath, scriptContent);

      this.logger.verbose(`Created TypeScript cleaning script: ${scriptPath}`);

      // Create a wrapper shell script that calls deno
      const wrapperPath = `${tempDir}/clean-msg.sh`;
      const wrapperContent = `#!/bin/bash
deno run --allow-read "${scriptPath}"
`;
      await Deno.writeTextFile(wrapperPath, wrapperContent);
      await Deno.chmod(wrapperPath, 0o755);

      // Get the current branch name to limit rewriting to only that branch
      const currentBranchResult = await $`git rev-parse --abbrev-ref HEAD`.stdout("piped").stderr(
        "piped",
      ).noThrow();
      if (currentBranchResult.code !== 0) {
        throw new AppError(
          "Failed to get current branch name",
          "GET_BRANCH_FAILED",
          new Error(currentBranchResult.stderr),
        );
      }
      const currentBranch = currentBranchResult.stdout.trim();

      // Determine the revision range to rewrite
      let revisionRange = currentBranch;
      if (earliestCommitWithTrailer) {
        // Try to get the parent of the earliest commit
        const parentResult = await $`git rev-parse ${earliestCommitWithTrailer}^`.stdout("piped")
          .stderr("piped").noThrow();

        if (parentResult.code === 0) {
          // Parent exists, use range from parent to current branch
          const parentSha = parentResult.stdout.trim();
          revisionRange = `${parentSha}..${currentBranch}`;
          this.logger.info(
            `Optimizing: rewriting from ${
              earliestCommitWithTrailer.substring(0, 7)
            } to ${currentBranch}`,
          );
        } else {
          // No parent (earliest commit is the first commit in repo), rewrite all history
          this.logger.info(
            `Earliest commit ${
              earliestCommitWithTrailer.substring(0, 7)
            } is the first commit, rewriting entire branch history`,
          );
        }
      }

      // Execute git filter-branch with our TypeScript-based cleaning script
      const filterBranchResult = await $`git filter-branch -f --msg-filter ${
        escapeShellArg(wrapperPath)
      } ${revisionRange}`.stdout("piped").stderr("piped").noThrow();

      if (filterBranchResult.code !== 0) {
        throw new AppError(
          "git filter-branch failed",
          "FILTER_BRANCH_FAILED",
          new Error(filterBranchResult.stderr),
        );
      }

      // Clean up temporary files
      await Deno.remove(tempDir, { recursive: true });

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

  private generateTypeScriptCleaningScript(): string {
    // Generate a TypeScript script that performs the same cleaning logic
    // This avoids shell escaping issues and is more reliable

    return `// Claude Cleaner commit message filter script (TypeScript)
// This script removes Claude-related trailers from commit messages

const claudeTrailerPatterns = [
  {
    name: "claude-code-generated",
    pattern: /🤖 Generated with \\[Claude Code\\]\\([^)]+\\)/gm,
    description: "Claude Code generation attribution"
  },
  {
    name: "claude-coauthor", 
    pattern: /Co-Authored-By: Claude <noreply@anthropic\\.com>/gm,
    description: "Claude co-author trailer"
  },
  {
    name: "claude-emoji-attribution",
    pattern: /🤖[^\\n]*Claude[^\\n]*/gm,
    description: "Claude emoji attribution lines"
  },
  {
    name: "claude-generated-generic",
    pattern: /Generated with Claude[^\\n]*/gm,
    description: "Generic Claude generation attribution"
  }
];

function cleanCommitMessage(message: string): string {
  let cleanedMessage = message;
  
  // Apply each pattern to remove Claude trailers
  for (const pattern of claudeTrailerPatterns) {
    cleanedMessage = cleanedMessage.replace(pattern.pattern, '');
  }
  
  // Clean up multiple consecutive newlines and trim
  cleanedMessage = cleanedMessage
    .replace(/\\n{3,}/g, '\\n\\n')  // Replace 3+ newlines with 2
    .replace(/\\n\\s*\\n\\s*$/g, '\\n')  // Remove trailing newlines and whitespace
    .trim();
  
  // Ensure there's exactly one newline at the end if the message isn't empty
  if (cleanedMessage && !cleanedMessage.endsWith('\\n')) {
    cleanedMessage += '\\n';
  }
  
  return cleanedMessage;
}

// Read commit message from stdin
const reader = Deno.stdin.readable.getReader();
const chunks: Uint8Array[] = [];
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
} finally {
  reader.releaseLock();
}

// Combine chunks into a single array
const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
const input = new Uint8Array(totalLength);
let offset = 0;
for (const chunk of chunks) {
  input.set(chunk, offset);
  offset += chunk.length;
}

const decoder = new TextDecoder();
const message = decoder.decode(input);

// Clean the message and output result
const cleanedMessage = cleanCommitMessage(message);
if (cleanedMessage.trim()) {
  Deno.stdout.write(new TextEncoder().encode(cleanedMessage));
}
`;
  }

  async validateGitRepository(): Promise<void> {
    try {
      const result = await $`git rev-parse --git-dir`.stdout("piped").stderr("piped").noThrow();
      if (result.code !== 0) {
        throw new AppError(
          "Not in a Git repository",
          "NOT_GIT_REPOSITORY",
        );
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
      const result = await $`git status --porcelain`.stdout("piped").stderr("piped");
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

      const result = await $`git branch ${backupBranch} ${branch}`.stdout("piped").stderr("piped")
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
