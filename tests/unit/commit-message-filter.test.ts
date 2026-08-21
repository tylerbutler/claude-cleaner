/**
 * Focused unit tests for the shared commit-message parser
 * (src/commit-message-filter.ts).
 *
 * These pin down the precise, line/region-based semantics that replaced the
 * old overlapping whole-message regex passes: Claude attribution is removed
 * only from the terminal metadata/trailer region, ordinary body prose (even
 * prose mentioning Claude or containing 🤖) and non-Claude trailers are
 * preserved, each removed physical line is counted exactly once, Unicode and
 * spacing stay stable, and an attribution-only message falls back to a fixed
 * non-empty placeholder.
 */

import { assert, assertEquals } from "@std/assert";
import {
  ATTRIBUTION_ONLY_FALLBACK_MESSAGE,
  filterClaudeAttribution,
  filterCommitMessage,
  isClaudeAttributionLine,
} from "../../src/commit-message-filter.ts";

Deno.test("filterClaudeAttribution - canonical trailer block", async (t) => {
  await t.step("removes the emoji-generation and co-author lines, preserves the body", () => {
    const message = "Add feature\n\n" +
      "Implements the thing.\n\n" +
      "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.cleanedMessage, "Add feature\n\nImplements the thing.\n");
    assertEquals(result.removedLines, [
      "🤖 Generated with [Claude Code](https://claude.ai/code)",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ]);
  });

  await t.step("counts each removed physical line exactly once (no overlap double-count)", () => {
    // The emoji line historically matched BOTH the "claude-code-generated"
    // and "claude-emoji-attribution" patterns; it must now count once.
    const message = "Subject only\n\n" +
      "🤖 Generated with [Claude Code](https://claude.ai/code)\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.removedLines.length, 1);
    assertEquals(result.cleanedMessage, "Subject only\n");
  });
});

Deno.test("filterClaudeAttribution - preserves ordinary prose (false positives)", async (t) => {
  await t.step("keeps a body line that mentions Claude and the 🤖 emoji", () => {
    const message = "Add Claude API support\n\n" +
      "This teaches the 🤖 bot to mention Claude in its output.\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(
      result.cleanedMessage,
      "Add Claude API support\n\nThis teaches the 🤖 bot to mention Claude in its output.\n",
    );
    assertEquals(result.removedLines, ["Co-Authored-By: Claude <noreply@anthropic.com>"]);
  });

  await t.step("keeps a body line that merely starts with the attribution words", () => {
    const message = "Refactor banner\n\n" +
      "Generated with Claude Code is the text we now show users.\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.removedLines, []);
    assertEquals(result.cleanedMessage, message);
  });

  await t.step("keeps a trailer-shaped Claude line that sits mid-body above prose", () => {
    // The Claude co-author line here is documentation in the body, followed by
    // more prose, so it is NOT in the terminal region and must be preserved.
    const message = "Document commit conventions\n\n" +
      "Never hand-write a line like:\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n" +
      "because tooling strips it.\n\n" +
      "Signed-off-by: Human <human@example.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.removedLines, []);
    assertEquals(result.cleanedMessage, message);
  });
});

Deno.test("filterClaudeAttribution - non-Claude trailers", async (t) => {
  await t.step("preserves Signed-off-by and non-Claude Co-authored-by trailers", () => {
    const message = "Fix bug\n\n" +
      "Co-authored-by: Alice <alice@example.com>\n" +
      "Signed-off-by: Bob <bob@example.com>\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(
      result.cleanedMessage,
      "Fix bug\n\n" +
        "Co-authored-by: Alice <alice@example.com>\n" +
        "Signed-off-by: Bob <bob@example.com>\n",
    );
    assertEquals(result.removedLines, ["Co-Authored-By: Claude <noreply@anthropic.com>"]);
  });

  await t.step("removes a Claude co-author interleaved above a real trailer", () => {
    const message = "Body.\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n" +
      "Signed-off-by: Human <human@example.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.cleanedMessage, "Body.\n\nSigned-off-by: Human <human@example.com>\n");
    assertEquals(result.removedLines, ["Co-Authored-By: Claude <noreply@anthropic.com>"]);
  });

  await t.step(
    "does not treat an Anthropic human co-author (not named Claude) as attribution",
    () => {
      const message = "Fix bug\n\n" +
        "Co-authored-by: Jane Smith <jane@anthropic.com>\n";

      const result = filterClaudeAttribution(message);

      assertEquals(result.removedLines, []);
      assertEquals(result.cleanedMessage, message);
    },
  );
});

Deno.test("filterClaudeAttribution - attribution-only fallback", async (t) => {
  await t.step("returns the documented non-empty fallback when nothing else remains", () => {
    const message = "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.cleanedMessage, ATTRIBUTION_ONLY_FALLBACK_MESSAGE + "\n");
    assert(result.cleanedMessage.trim().length > 0, "fallback must be non-empty");
    assertEquals(result.removedLines.length, 2);
  });
});

Deno.test("filterClaudeAttribution - Unicode and spacing", async (t) => {
  await t.step("preserves multibyte Unicode content in subject and body", () => {
    const message = "修复问题 🎉\n\n" +
      "Added 文档 support ✅ — прив́ет\n\n" +
      "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const result = filterClaudeAttribution(message);

    assertEquals(result.cleanedMessage, "修复问题 🎉\n\nAdded 文档 support ✅ — прив́ет\n");
  });

  await t.step("keeps the subject/body blank line and collapses blanks left by removal", () => {
    const message = "Subject\n\n" +
      "Body paragraph one.\n\n" +
      "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
      "Signed-off-by: Human <human@example.com>\n";

    const result = filterClaudeAttribution(message);

    // The blank lines around the removed line collapse to a single blank so
    // there is never a double blank between the body and the surviving trailer.
    assertEquals(
      result.cleanedMessage,
      "Subject\n\nBody paragraph one.\n\nSigned-off-by: Human <human@example.com>\n",
    );
  });

  await t.step("leaves a message with no Claude attribution unchanged", () => {
    const message = "Just a normal commit\n\nWith a two-line\nbody paragraph.\n";
    const result = filterClaudeAttribution(message);
    assertEquals(result.removedLines, []);
    assertEquals(result.cleanedMessage, message);
  });

  await t.step("is idempotent: filtering the cleaned output changes nothing", () => {
    const message = "Add feature\n\nBody.\n\n" +
      "🤖 Generated with [Claude Code](https://claude.ai/code)\n\n" +
      "Co-Authored-By: Claude <noreply@anthropic.com>\n";

    const once = filterCommitMessage(message);
    const twice = filterCommitMessage(once);
    assertEquals(twice, once);
    assertEquals(filterClaudeAttribution(once).removedLines, []);
  });
});

Deno.test("isClaudeAttributionLine - precise line matching", async (t) => {
  await t.step("matches the canonical attribution lines", () => {
    assert(isClaudeAttributionLine("🤖 Generated with [Claude Code](https://claude.ai/code)"));
    assert(isClaudeAttributionLine("Generated with [Claude Code](https://claude.ai/code)"));
    assert(isClaudeAttributionLine("Generated with Claude Code"));
    assert(isClaudeAttributionLine("Generated with Claude"));
    assert(isClaudeAttributionLine("Co-Authored-By: Claude <noreply@anthropic.com>"));
    assert(isClaudeAttributionLine("co-authored-by: Claude <noreply@anthropic.com>"));
  });

  await t.step("does not match prose or non-Claude trailers", () => {
    assert(!isClaudeAttributionLine("Generated with Claude Code is our banner text"));
    assert(!isClaudeAttributionLine("This mentions Claude and 🤖 in prose"));
    assert(!isClaudeAttributionLine("Co-authored-by: Alice <alice@example.com>"));
    assert(!isClaudeAttributionLine("Signed-off-by: Human <human@example.com>"));
    assert(!isClaudeAttributionLine("Co-authored-by: Jane <jane@anthropic.com>"));
  });

  await t.step("filterCommitMessage returns only the cleaned string", () => {
    assertEquals(
      filterCommitMessage("Fix\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n"),
      "Fix\n",
    );
  });
});
