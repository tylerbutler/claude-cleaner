/**
 * Internal, non-user-facing execution path used by Git as a self-invoked
 * `--msg-filter` / `--index-filter` during `git filter-branch` history
 * rewrites.
 *
 * Rationale: `git filter-branch` filters are shell command *strings* that
 * Git itself evaluates once per rewritten commit. Rather than generating a
 * throwaway TypeScript script plus a Bash wrapper on disk (which requires an
 * installed `deno` runtime and a POSIX shell even for `deno compile`d
 * binaries), Claude Cleaner re-invokes itself with a hidden marker argument.
 * The marker is intercepted in `main.ts` *before* the Cliffy command parser
 * runs, so it never appears in `--help`, never collides with real
 * subcommands, and works identically whether the running program is the
 * `deno run src/main.ts` script or a `deno compile` standalone binary.
 *
 * Shell escaping is required only for the single self-invocation command
 * string that Git necessarily evaluates. Any exact file paths this module
 * needs to act on (the `index-filter` manifest) are read from a file and
 * passed to `git` as a real argument array via `Deno.Command`, never
 * interpolated into a shell string.
 *
 * This module intentionally implements only the dispatch/self-invocation
 * seam. The real commit-message trailer parser (Task 4) and exact-path
 * removal planning (Task 2) plug in behind `filterCommitMessage` and
 * `removeExactPaths` respectively.
 */

import { fromFileUrl } from "@std/path";
import type { Logger } from "./utils.ts";
import { AppError, ConsoleLogger, escapeShellArg } from "./utils.ts";

/**
 * Hidden first argument that identifies an internal self-invocation.
 * Deliberately not registered as a Cliffy command/option so it never shows
 * up in `--help` output and can't be typed by a user by accident.
 */
export const INTERNAL_FILTER_MARKER = "__internal-filter";

/** Supported internal filter modes, selected via the second CLI argument. */
export type InternalFilterMode = "msg-filter" | "index-filter";

/** Manifest entries are NUL-separated so arbitrary file paths (including
 * ones containing newlines) round-trip safely, matching Git's own `-z`
 * conventions. */
const MANIFEST_DELIMITER = "\0";

export interface ParsedInternalFilterArgs {
  mode: InternalFilterMode;
  /** Remaining arguments after the mode, e.g. the manifest file path. */
  rest: string[];
}

/**
 * Returns true if `args` (typically `Deno.args`) represents an internal
 * self-invocation rather than a normal user-facing CLI call.
 */
export function isInternalFilterInvocation(args: readonly string[]): boolean {
  return args[0] === INTERNAL_FILTER_MARKER;
}

/**
 * Parses the arguments that follow the `INTERNAL_FILTER_MARKER`. Throws an
 * `AppError` if the mode is missing or unrecognized.
 */
export function parseInternalFilterArgs(
  args: readonly string[],
): ParsedInternalFilterArgs {
  const [mode, ...rest] = args;
  if (mode !== "msg-filter" && mode !== "index-filter") {
    throw new AppError(
      `Unknown internal filter mode: ${mode ?? "<none>"}`,
      "INTERNAL_FILTER_UNKNOWN_MODE",
    );
  }
  return { mode, rest };
}

export interface SelfInvocation {
  /** Executable to run: the `deno` binary, or the compiled binary itself. */
  execPath: string;
  /** Full ordered argument list to pass to `execPath`. */
  args: string[];
}

export interface ResolveSelfInvocationOverrides {
  /** Override for `Deno.execPath()`, primarily for tests. */
  execPath?: string;
  /** Override for `Deno.mainModule`, primarily for tests. */
  mainModuleUrl?: string;
  /** Override for `Deno.build.standalone`, primarily for tests. */
  standalone?: boolean;
}

/**
 * Resolves how Claude Cleaner should re-invoke itself for the given
 * internal filter mode, working correctly whether the current process is
 * `deno run src/main.ts` or a `deno compile` standalone binary:
 *
 * - Standalone (`deno compile`) binaries embed their own runtime, so
 *   `Deno.execPath()` already points at the compiled executable and it can
 *   be re-invoked directly with the internal marker.
 * - Non-standalone `deno run` invocations need the `deno` executable, the
 *   `run` subcommand, permissions, and the script path re-supplied.
 */
export function resolveSelfInvocation(
  mode: InternalFilterMode,
  extraArgs: string[] = [],
  overrides: ResolveSelfInvocationOverrides = {},
): SelfInvocation {
  const standalone = overrides.standalone ?? Deno.build.standalone;
  const execPath = overrides.execPath ?? Deno.execPath();

  if (standalone) {
    return {
      execPath,
      args: [INTERNAL_FILTER_MARKER, mode, ...extraArgs],
    };
  }

  const mainModuleUrl = overrides.mainModuleUrl ?? Deno.mainModule;
  const scriptArg = mainModuleUrl.startsWith("file://")
    ? fromFileUrl(mainModuleUrl)
    : mainModuleUrl;

  return {
    execPath,
    args: [
      "run",
      "--allow-all",
      scriptArg,
      INTERNAL_FILTER_MARKER,
      mode,
      ...extraArgs,
    ],
  };
}

/**
 * Builds the single shell command string that `git filter-branch`'s
 * `--msg-filter` / `--index-filter` will evaluate. This is the only place
 * shell escaping is applied, because it is the only place Git leaves us no
 * choice: the filter flags accept a shell command string, not an argument
 * array.
 */
export function buildSelfInvocationCommand(invocation: SelfInvocation): string {
  return [invocation.execPath, ...invocation.args].map(escapeShellArg).join(" ");
}

/**
 * Convenience helper combining {@link resolveSelfInvocation} and
 * {@link buildSelfInvocationCommand}.
 */
export function buildSelfInvocationCommandForMode(
  mode: InternalFilterMode,
  extraArgs: string[] = [],
  overrides: ResolveSelfInvocationOverrides = {},
): string {
  return buildSelfInvocationCommand(
    resolveSelfInvocation(mode, extraArgs, overrides),
  );
}

/** Reads all of stdin as UTF-8 text. Used by `msg-filter` mode. */
export async function readStdin(): Promise<string> {
  const buffer = await new Response(Deno.stdin.readable).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

/**
 * Reads a NUL-separated exact-path manifest file, used by `index-filter`
 * mode. Empty trailing entries (from a trailing delimiter) are dropped.
 */
export async function readManifestFile(path: string): Promise<string[]> {
  let content: string;
  try {
    content = await Deno.readTextFile(path);
  } catch (error) {
    throw new AppError(
      `Failed to read exact-path manifest: ${path}`,
      "INTERNAL_FILTER_MANIFEST_READ_FAILED",
      error as Error,
    );
  }
  return content
    .split(MANIFEST_DELIMITER)
    .filter((entry) => entry.length > 0);
}

/**
 * Placeholder seam for commit-message filtering. Currently an identity
 * pass-through so the `msg-filter` dispatch path is real and testable
 * end-to-end without duplicating the trailer-removal logic that Task 4 will
 * implement in its final form.
 */
export function filterCommitMessage(message: string): string {
  return message;
}

/**
 * Removes the given exact paths from the Git index using `git rm --cached
 * --ignore-unmatch`, passing paths as a real argument array rather than
 * interpolating them into a shell string. This is the seam that Task 2's
 * exact-path rewriting plan will invoke after computing the deduplicated,
 * canonicalized path list (including any batching needed for very large
 * manifests).
 */
export async function removeExactPaths(
  paths: readonly string[],
  repoPath: string,
): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const command = new Deno.Command("git", {
    args: ["rm", "--cached", "-r", "--ignore-unmatch", "--", ...paths],
    cwd: repoPath,
    stdout: "piped",
    stderr: "piped",
  });

  const { success, stderr } = await command.output();
  if (!success) {
    throw new AppError(
      "git rm --cached failed while applying the exact-path manifest",
      "INTERNAL_FILTER_INDEX_RM_FAILED",
      new Error(new TextDecoder().decode(stderr)),
    );
  }
}

export interface InternalFilterContext {
  logger?: Logger;
  /** Working directory `index-filter` mode should run `git rm` in. */
  repoPath?: string;
  /** Injectable stdin reader, primarily for tests. */
  readStdin?: () => Promise<string>;
  /** Injectable stdout writer, primarily for tests. */
  writeStdout?: (data: string) => Promise<void>;
  /** Injectable manifest reader, primarily for tests. */
  readManifestFile?: (path: string) => Promise<string[]>;
  /** Injectable exact-path remover, primarily for tests. */
  removeExactPaths?: (paths: readonly string[], repoPath: string) => Promise<void>;
}

const defaultWriteStdout = async (data: string): Promise<void> => {
  await Deno.stdout.write(new TextEncoder().encode(data));
};

/**
 * Dispatches an internal self-invocation to the appropriate filter mode.
 * `args` must already have the `INTERNAL_FILTER_MARKER` stripped (callers
 * should gate on {@link isInternalFilterInvocation} first). Returns a
 * process exit code.
 */
export async function runInternalFilter(
  args: readonly string[],
  context: InternalFilterContext = {},
): Promise<number> {
  const logger = context.logger ?? new ConsoleLogger();
  const doReadStdin = context.readStdin ?? readStdin;
  const doWriteStdout = context.writeStdout ?? defaultWriteStdout;
  const doReadManifestFile = context.readManifestFile ?? readManifestFile;
  const doRemoveExactPaths = context.removeExactPaths ?? removeExactPaths;

  try {
    const { mode, rest } = parseInternalFilterArgs(args);

    if (mode === "msg-filter") {
      const message = await doReadStdin();
      const filtered = filterCommitMessage(message);
      await doWriteStdout(filtered);
      return 0;
    }

    // mode === "index-filter"
    const manifestPath = rest[0];
    if (!manifestPath) {
      throw new AppError(
        "index-filter mode requires a manifest file path argument",
        "INTERNAL_FILTER_MISSING_MANIFEST",
      );
    }
    const paths = await doReadManifestFile(manifestPath);
    await doRemoveExactPaths(paths, context.repoPath ?? Deno.cwd());
    return 0;
  } catch (error) {
    if (error instanceof AppError) {
      logger.error(`${error.code}: ${error.message}`);
    } else {
      logger.error(
        `Internal filter failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return 1;
  }
}
