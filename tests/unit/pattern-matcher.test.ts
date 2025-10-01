/**
 * Unit tests for PatternMatcher class and validateGlobPattern function
 */

import { assert, assertThrows } from "@std/assert";
import { PatternMatcher, validateGlobPattern } from "../../src/file-cleaner.ts";

// Test data for pattern matching
const testPatterns = [
  {
    pattern: "**/.DS_Store",
    type: "glob" as const,
    reason: "macOS system file",
  },
  {
    pattern: "**/claude-*.json",
    type: "glob" as const,
    reason: "Claude configuration file",
  },
  {
    pattern: /^\.claude[-_].*$/i,
    type: "regex" as const,
    reason: "Claude workspace file",
  },
];

Deno.test("validateGlobPattern - Valid Patterns", async (t) => {
  await t.step("should accept basic glob patterns", () => {
    // These should not throw
    validateGlobPattern("*.txt");
    validateGlobPattern("**/*.js");
    validateGlobPattern("src/**/*.ts");
    validateGlobPattern("**/test-*.json");
    assert(true);
  });

  await t.step("should accept extended glob patterns", () => {
    // Extended glob operators should be allowed
    validateGlobPattern("?(.)claude?(-|_|.)*.json");
    validateGlobPattern("@(foo|bar|baz).txt");
    validateGlobPattern("*.@(js|ts|mjs|cts)");
    validateGlobPattern("+(one|two|three)");
    validateGlobPattern("!(test).js");
    assert(true);
  });

  await t.step("should accept glob character classes", () => {
    // Bracket expressions are valid glob syntax
    validateGlobPattern("**/[Cc]laude.txt");
    validateGlobPattern("file[0-9].txt");
    validateGlobPattern("**/[!.]*.txt"); // Negated character class
    assert(true);
  });

  await t.step("should accept brace expansion", () => {
    validateGlobPattern("**/*.{js,ts,jsx,tsx}");
    validateGlobPattern("file{1,2,3}.txt");
    assert(true);
  });
});

Deno.test("validateGlobPattern - Invalid Patterns", async (t) => {
  await t.step("should reject regex character classes", () => {
    assertThrows(
      () => validateGlobPattern("file\\d+.txt"),
      Error,
      "Invalid glob pattern contains regex character classes",
    );

    assertThrows(
      () => validateGlobPattern("word\\w+"),
      Error,
      "Invalid glob pattern contains regex character classes",
    );

    assertThrows(
      () => validateGlobPattern("space\\s+"),
      Error,
      "Invalid glob pattern contains regex character classes",
    );
  });

  await t.step("should reject regex anchors", () => {
    assertThrows(
      () => validateGlobPattern("^start.txt"),
      Error,
      "Invalid glob pattern contains regex anchors",
    );

    assertThrows(
      () => validateGlobPattern("end.txt$"),
      Error,
      "Invalid glob pattern contains regex anchors",
    );
  });
});

Deno.test("PatternMatcher - Basic Pattern Matching", async (t) => {
  const matcher = new PatternMatcher(testPatterns);

  await t.step("should match simple glob patterns", () => {
    assert(matcher.matches(".DS_Store"));
    assert(matcher.matches("path/to/.DS_Store"));
    assert(matcher.matches("deeply/nested/path/.DS_Store"));
  });

  await t.step("should match glob patterns with wildcards", () => {
    assert(matcher.matches("claude-config.json"));
    assert(matcher.matches("path/claude-settings.json"));
    assert(matcher.matches("dir/claude-workspace.json"));
  });

  await t.step("should match regex patterns", () => {
    assert(matcher.matches(".claude-workspace"));
    assert(matcher.matches(".claude_session"));
  });

  await t.step("should not match non-matching patterns", () => {
    assert(!matcher.matches("regular-file.txt"));
    assert(!matcher.matches("src/index.ts"));
    assert(!matcher.matches("README.md"));
  });

  await t.step("should be case-insensitive", () => {
    assert(matcher.matches(".ds_store")); // lowercase
    assert(matcher.matches(".Ds_Store")); // mixed case
    assert(matcher.matches("CLAUDE-CONFIG.JSON")); // uppercase
    assert(matcher.matches(".CLAUDE-WORKSPACE")); // uppercase regex match
  });
});

Deno.test("PatternMatcher - getReason()", async (t) => {
  const matcher = new PatternMatcher(testPatterns);

  await t.step("should return reason for matching patterns", () => {
    const reason = matcher.getReason(".DS_Store");
    assert(reason === "macOS system file");
  });

  await t.step("should return undefined for non-matching patterns", () => {
    const reason = matcher.getReason("regular-file.txt");
    assert(reason === undefined);
  });

  await t.step("should return first matching pattern reason", () => {
    // Create patterns with potential overlap
    const overlappingPatterns = [
      {
        pattern: "**/specific.txt",
        type: "glob" as const,
        reason: "Specific match",
      },
      {
        pattern: "**/*.txt",
        type: "glob" as const,
        reason: "General match",
      },
    ];
    const overlappingMatcher = new PatternMatcher(overlappingPatterns);

    const reason = overlappingMatcher.getReason("path/specific.txt");
    assert(reason === "Specific match"); // First pattern wins
  });
});

Deno.test("PatternMatcher - Edge Cases", async (t) => {
  await t.step("should handle empty pattern list", () => {
    const emptyMatcher = new PatternMatcher([]);
    assert(!emptyMatcher.matches("any-file.txt"));
    assert(emptyMatcher.getReason("any-file.txt") === undefined);
  });

  await t.step("should handle paths with special characters", () => {
    const specialPatterns = [
      {
        pattern: "**/*.txt",
        type: "glob" as const,
        reason: "Text file",
      },
    ];
    const matcher = new PatternMatcher(specialPatterns);

    // Paths with spaces, hyphens, underscores
    assert(matcher.matches("file name with spaces.txt"));
    assert(matcher.matches("file-with-hyphens.txt"));
    assert(matcher.matches("file_with_underscores.txt"));
  });

  await t.step("should handle Unicode filenames", () => {
    const unicodePatterns = [
      {
        pattern: "**/*.txt",
        type: "glob" as const,
        reason: "Text file",
      },
    ];
    const matcher = new PatternMatcher(unicodePatterns);

    // Unicode characters in filenames
    assert(matcher.matches("文件.txt")); // Chinese
    assert(matcher.matches("αρχείο.txt")); // Greek
    assert(matcher.matches("файл.txt")); // Cyrillic
    assert(matcher.matches("📝-notes.txt")); // Emoji
  });

  await t.step("should handle very long paths", () => {
    const longPathPatterns = [
      {
        pattern: "**/.DS_Store",
        type: "glob" as const,
        reason: "macOS system file",
      },
    ];
    const matcher = new PatternMatcher(longPathPatterns);

    // Generate a very long path (over 1000 characters)
    const deepPath = Array(50).fill("very-long-directory-name").join("/");
    const longPath = `${deepPath}/.DS_Store`;
    assert(matcher.matches(longPath));
  });

  await t.step("should handle empty strings", () => {
    const matcher = new PatternMatcher(testPatterns);
    assert(!matcher.matches(""));
    assert(matcher.getReason("") === undefined);
  });

  await t.step("should handle paths with only separators", () => {
    const matcher = new PatternMatcher(testPatterns);
    assert(!matcher.matches("/"));
    assert(!matcher.matches("//"));
    assert(!matcher.matches("///"));
  });
});

Deno.test("PatternMatcher - Flag Handling", async (t) => {
  await t.step("should prevent duplicate 'i' flags in glob patterns", () => {
    // This is a regression test for the flag concatenation bug
    // Create a pattern matcher with glob patterns
    const patterns = [
      {
        pattern: "**/*.txt",
        type: "glob" as const,
        reason: "Text file",
      },
    ];

    // Should not throw or create invalid regex flags
    const matcher = new PatternMatcher(patterns);

    // Verify case-insensitive matching works correctly
    assert(matcher.matches("FILE.TXT"));
    assert(matcher.matches("file.txt"));
    assert(matcher.matches("FiLe.TxT"));
  });

  await t.step("should handle regex patterns with existing 'i' flag", () => {
    const patterns = [
      {
        pattern: /test/i, // Already has 'i' flag
        type: "regex" as const,
        reason: "Test pattern",
      },
    ];

    const matcher = new PatternMatcher(patterns);
    assert(matcher.matches("TEST"));
    assert(matcher.matches("test"));
    assert(matcher.matches("TeSt"));
  });
});

Deno.test("PatternMatcher - Pattern Ordering", async (t) => {
  await t.step("should respect first-match-wins for getReason", () => {
    // More specific patterns before broader patterns
    const orderedPatterns = [
      {
        pattern: "**/claude-config.json",
        type: "glob" as const,
        reason: "Claude configuration file",
      },
      {
        pattern: "**/*.json",
        type: "glob" as const,
        reason: "Generic JSON file",
      },
    ];

    const matcher = new PatternMatcher(orderedPatterns);

    // Should get the more specific reason
    assert(matcher.getReason("claude-config.json") === "Claude configuration file");

    // Other JSON files get the generic reason
    assert(matcher.getReason("package.json") === "Generic JSON file");
  });

  await t.step("should match all patterns with matches()", () => {
    const orderedPatterns = [
      {
        pattern: "**/specific.txt",
        type: "glob" as const,
        reason: "Specific",
      },
      {
        pattern: "**/*.txt",
        type: "glob" as const,
        reason: "General",
      },
    ];

    const matcher = new PatternMatcher(orderedPatterns);

    // matches() returns true if ANY pattern matches
    assert(matcher.matches("specific.txt"));
    assert(matcher.matches("other.txt"));
  });
});

Deno.test("PatternMatcher - Extended Glob Syntax", async (t) => {
  await t.step("should handle ?(pattern) - zero or one", () => {
    const patterns = [
      {
        pattern: "file?(s).txt",
        type: "glob" as const,
        reason: "Optional s",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    assert(matcher.matches("file.txt")); // Zero occurrences
    assert(matcher.matches("files.txt")); // One occurrence
  });

  await t.step("should handle @(pattern) - exactly one", () => {
    const patterns = [
      {
        pattern: "file.@(js|ts|jsx)",
        type: "glob" as const,
        reason: "JavaScript/TypeScript file",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    assert(matcher.matches("file.js"));
    assert(matcher.matches("file.ts"));
    assert(matcher.matches("file.jsx"));
    assert(!matcher.matches("file.tsx")); // Not in the list
  });

  await t.step("should handle *(pattern) - zero or more", () => {
    const patterns = [
      {
        pattern: "file*(backup).txt",
        type: "glob" as const,
        reason: "Backup file",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    assert(matcher.matches("file.txt")); // Zero occurrences
    assert(matcher.matches("filebackup.txt")); // One occurrence
    assert(matcher.matches("filebackupbackup.txt")); // Multiple occurrences
  });

  await t.step("should handle complex extended glob combinations", () => {
    const patterns = [
      {
        pattern: "?(.)claude?(-|_|.)*.@(json|txt|md)",
        type: "glob" as const,
        reason: "Complex Claude pattern",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    assert(matcher.matches("claude.json"));
    assert(matcher.matches(".claude-config.json"));
    assert(matcher.matches("claude_workspace.txt"));
    assert(matcher.matches("claude.settings.md"));
  });
});

Deno.test("PatternMatcher - Windows Path Compatibility", async (t) => {
  await t.step("should handle forward slashes (Git standard)", () => {
    const patterns = [
      {
        pattern: "**/.vscode/*.json",
        type: "glob" as const,
        reason: "VS Code configuration",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    // Git uses forward slashes internally, even on Windows
    assert(matcher.matches(".vscode/settings.json"));
    assert(matcher.matches("path/.vscode/launch.json"));
  });

  await t.step("should be case-insensitive for Windows compatibility", () => {
    const patterns = [
      {
        pattern: "**/README.md",
        type: "glob" as const,
        reason: "README file",
      },
    ];
    const matcher = new PatternMatcher(patterns);

    // Windows filesystems are case-insensitive
    assert(matcher.matches("README.md"));
    assert(matcher.matches("readme.md"));
    assert(matcher.matches("ReadMe.md"));
    assert(matcher.matches("README.MD"));
  });
});
