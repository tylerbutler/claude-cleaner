/**
 * Unit tests for file pattern loading functionality
 */

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";

// We'll test the file loading logic by creating a mock of the main function's pattern loading
async function loadPatternsFromFile(filePath: string): Promise<string[]> {
  try {
    const fileContent = await Deno.readTextFile(filePath);
    const patterns = fileContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    return patterns;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read directory patterns file: ${message}`);
  }
}

Deno.test("File Pattern Loading", async (t) => {
  const testDir = await Deno.makeTempDir({ prefix: "claude-cleaner-test" });

  await t.step("should load patterns from file", async () => {
    const patternsFile = join(testDir, "patterns.txt");
    const content = "claudedocs\n.serena\ntemp\nbuild";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp", "build"]);

    // Cleanup
    await Deno.remove(patternsFile);
  });

  await t.step("should skip empty lines", async () => {
    const patternsFile = join(testDir, "patterns-with-empty.txt");
    const content = "claudedocs\n\n.serena\n   \ntemp";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp"]);

    await Deno.remove(patternsFile);
  });

  await t.step("should skip comment lines", async () => {
    const patternsFile = join(testDir, "patterns-with-comments.txt");
    const content = `# This is a comment
claudedocs
# Another comment
.serena
# Project-specific directories
temp
build`;
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp", "build"]);

    await Deno.remove(patternsFile);
  });

  await t.step("should handle mixed whitespace and comments", async () => {
    const patternsFile = join(testDir, "patterns-mixed.txt");
    const content = `# Configuration for claude-cleaner

  claudedocs
# Documentation directory

  .serena

# Cache directories
   temp
   build

# End of file`;
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp", "build"]);

    await Deno.remove(patternsFile);
  });

  await t.step("should handle empty file", async () => {
    const patternsFile = join(testDir, "empty.txt");
    await Deno.writeTextFile(patternsFile, "");

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, []);

    await Deno.remove(patternsFile);
  });

  await t.step("should handle file with only comments", async () => {
    const patternsFile = join(testDir, "only-comments.txt");
    const content = `# This file has no patterns
# Just comments
# More comments`;
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, []);

    await Deno.remove(patternsFile);
  });

  await t.step("should handle file with only whitespace", async () => {
    const patternsFile = join(testDir, "only-whitespace.txt");
    const content = "   \n\t\n  \n   ";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, []);

    await Deno.remove(patternsFile);
  });

  await t.step("should throw error for missing file", async () => {
    const missingFile = join(testDir, "does-not-exist.txt");

    await assertRejects(
      () => loadPatternsFromFile(missingFile),
      Error,
      "Failed to read directory patterns file",
    );
  });

  await t.step("should handle UTF-8 content", async () => {
    const patternsFile = join(testDir, "utf8.txt");
    const content = "项目文档\n.серена\ntemp";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["项目文档", ".серена", "temp"]);

    await Deno.remove(patternsFile);
  });

  // Cleanup test directory
  await Deno.remove(testDir, { recursive: true });
});

Deno.test("Pattern File Edge Cases", async (t) => {
  const testDir = await Deno.makeTempDir({ prefix: "claude-cleaner-edge" });

  await t.step("should handle very long lines", async () => {
    const patternsFile = join(testDir, "long-lines.txt");
    const longPattern = "a".repeat(1000);
    const content = `claudedocs\n${longPattern}\n.serena`;
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns.length, 3);
    assertEquals(patterns[0], "claudedocs");
    assertEquals(patterns[1], longPattern);
    assertEquals(patterns[2], ".serena");

    await Deno.remove(patternsFile);
  });

  await t.step("should handle different line endings", async () => {
    const patternsFile = join(testDir, "line-endings.txt");
    // Mix of \n and \r\n line endings
    const content = "claudedocs\r\n.serena\ntemp\r\nbuild";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp", "build"]);

    await Deno.remove(patternsFile);
  });

  await t.step("should handle trailing newlines", async () => {
    const patternsFile = join(testDir, "trailing-newlines.txt");
    const content = "claudedocs\n.serena\ntemp\n\n\n";
    await Deno.writeTextFile(patternsFile, content);

    const patterns = await loadPatternsFromFile(patternsFile);

    assertEquals(patterns, ["claudedocs", ".serena", "temp"]);

    await Deno.remove(patternsFile);
  });

  // Cleanup test directory
  await Deno.remove(testDir, { recursive: true });
});
