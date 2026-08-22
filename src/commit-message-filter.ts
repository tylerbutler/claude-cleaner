/**
 * Shared, self-contained commit-message parser.
 *
 * This is the single source of truth for recognizing and removing Claude
 * attribution from commit messages. It is used by BOTH:
 *   - commit analysis / dry-run preview (`src/commit-cleaner.ts`), and
 *   - the internal `git filter-branch --msg-filter` self-invocation
 *     (`src/internal-filter.ts`, via {@link filterCommitMessage}).
 * so the preview a user sees in dry-run mode is produced by exactly the same
 * logic that rewrites history in execute mode. It intentionally replaces the
 * previous three parallel copies (a regex array in `commit-cleaner.ts`, a
 * generated TypeScript script string, and its Bash wrapper).
 *
 * Design goals:
 *   - Remove recognized Claude attribution ONLY from the terminal
 *     metadata/trailer region of a message, never from ordinary body prose
 *     (even prose that mentions "Claude" or contains the 🤖 emoji).
 *   - Preserve non-Claude trailers (`Signed-off-by`, other `Co-authored-by`,
 *     etc.) verbatim.
 *   - Count each removed physical attribution line exactly once, regardless
 *     of how many patterns it matches.
 *   - Preserve Unicode and keep spacing stable/deterministic.
 *   - Never emit an empty message: a commit whose message is nothing but
 *     removable attribution falls back to a fixed, non-empty placeholder.
 */

/**
 * Deterministic, non-empty message substituted when a commit's entire
 * message consists only of removable Claude attribution. Git requires a
 * non-empty message and `git filter-branch` would otherwise produce a commit
 * with a blank message, so a fixed placeholder is emitted instead. It is
 * intentionally self-descriptive (rather than reusing the original subject,
 * which by definition was attribution) so history readers can see the
 * original message was attribution-only and was replaced by the tool.
 */
export const ATTRIBUTION_ONLY_FALLBACK_MESSAGE = "Commit message removed by claude-cleaner";

export interface ClaudeAttributionPattern {
  name: string;
  regex: RegExp;
  description: string;
}

/**
 * Line-anchored patterns for the canonical Claude attribution signatures.
 *
 * Each pattern matches a WHOLE physical line (leading/trailing spaces, tabs,
 * and a trailing CR are tolerated) rather than an arbitrary substring. This
 * is what lets a line be classified as attribution-or-not exactly once and
 * guarantees body prose that merely *contains* these words — e.g.
 * "Generated with Claude Code is the banner we now show" — is never matched.
 */
export const CLAUDE_ATTRIBUTION_PATTERNS: ClaudeAttributionPattern[] = [
  {
    name: "claude-code-generated-link",
    // 🤖 Generated with [Claude Code](https://claude.ai/code)
    regex: /^[ \t]*(?:🤖[ \t]*)?Generated with \[Claude Code\]\([^)]*\)[ \t\r]*$/u,
    description: "Claude Code generation attribution (markdown link form)",
  },
  {
    name: "claude-generated-bare",
    // Generated with Claude   |   🤖 Generated with Claude Code
    regex: /^[ \t]*(?:🤖[ \t]*)?Generated with Claude(?: Code)?[ \t\r]*$/u,
    description: "Claude generation attribution (bare form)",
  },
  {
    name: "claude-coauthor",
    // Co-Authored-By: Claude <noreply@anthropic.com>
    regex: /^[ \t]*Co-authored-by:[ \t]*Claude[ \t]*<[^>]*@anthropic\.com>[ \t\r]*$/iu,
    description: "Claude Co-authored-by trailer",
  },
];

/**
 * Recognizes a conventional `Token: value` trailer line. Used ONLY to decide
 * how far up the terminal trailer region extends (so Claude attribution
 * interleaved among other trailers is still reached). It is intentionally
 * liberal: misclassifying a body line as a trailer here is harmless because
 * only precise Claude-attribution lines are ever removed.
 */
const GENERIC_TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*:(?:[ \t]|$)/;

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

/** Returns true if a single line is a recognized Claude attribution line. */
export function isClaudeAttributionLine(line: string): boolean {
  return CLAUDE_ATTRIBUTION_PATTERNS.some((pattern) => pattern.regex.test(line));
}

/** A line eligible to belong to the terminal metadata/trailer region. */
function isTerminalRegionLine(line: string): boolean {
  return isBlank(line) || isClaudeAttributionLine(line) ||
    GENERIC_TRAILER_LINE.test(line);
}

export interface CommitMessageFilterResult {
  /** The message with terminal-region Claude attribution removed. When
   * `removedLines` is non-empty, this is spacing-normalized, non-empty, and
   * terminated by a single trailing newline. When nothing was removed, this
   * is the original `message` returned verbatim (including its original
   * trailing-newline/blank-line formatting, whatever that was). */
  cleanedMessage: string;
  /** Each physical attribution line that was removed, in original order.
   * Length is the exact count of removed lines (each counted once). */
  removedLines: string[];
}

/**
 * Removes recognized Claude attribution from the terminal metadata/trailer
 * region of `message`, preserving body prose and non-Claude trailers.
 */
export function filterClaudeAttribution(message: string): CommitMessageFilterResult {
  const lines = message.split("\n");

  // Walk up from the last line to find the start of the terminal
  // metadata/trailer region: the maximal suffix whose lines are all blank,
  // Claude attribution, or generic trailers. Everything above this boundary
  // is body/subject prose and is preserved verbatim, so a Claude-looking
  // line in the body is never removed.
  let regionStart = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isTerminalRegionLine(lines[i] ?? "")) {
      regionStart = i;
    } else {
      break;
    }
  }

  // Remove Claude attribution lines found within the region; keep everything
  // else (body prose above the region, plus non-Claude trailers within it).
  const removedLines: string[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (i >= regionStart && isClaudeAttributionLine(line)) {
      removedLines.push(line);
    } else {
      kept.push(line);
    }
  }

  // A parser that removes nothing must not mutate the message. Returning the
  // original message verbatim preserves intentional formatting in
  // already-clean messages — e.g. multiple consecutive blank-line runs the
  // normalization pass below would otherwise collapse — and keeps the
  // `--msg-filter` path a true no-op for commits that carry no Claude
  // attribution. Spacing normalization only ever applies to messages a
  // removal actually changed.
  if (removedLines.length === 0) {
    return { cleanedMessage: message, removedLines };
  }

  // Normalize spacing deterministically without inserting any separators:
  // drop trailing blank lines, then collapse runs of 2+ blank lines (which a
  // removal can leave behind) into a single blank line. This never merges the
  // subject/body separator and never corrupts Unicode content.
  while (kept.length > 0 && isBlank(kept[kept.length - 1] ?? "")) {
    kept.pop();
  }
  const normalized: string[] = [];
  let previousBlank = false;
  for (const line of kept) {
    const blank = isBlank(line);
    if (blank && previousBlank) {
      continue;
    }
    normalized.push(line);
    previousBlank = blank;
  }

  let cleanedMessage = normalized.join("\n");
  if (cleanedMessage.trim().length === 0) {
    cleanedMessage = ATTRIBUTION_ONLY_FALLBACK_MESSAGE;
  }
  if (!cleanedMessage.endsWith("\n")) {
    cleanedMessage += "\n";
  }

  return { cleanedMessage, removedLines };
}

/**
 * Convenience wrapper returning only the cleaned message. This is the exact
 * contract `git filter-branch --msg-filter` needs (stdin message in, new
 * message out) and is re-exported by `src/internal-filter.ts`.
 */
export function filterCommitMessage(message: string): string {
  return filterClaudeAttribution(message).cleanedMessage;
}
