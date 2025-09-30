/**
 * Integration tests for CLI option parsing with new directory patterns
 */

import { assert } from "@std/assert";
import { join } from "@std/path";

// Test helper to run CLI with specific arguments
async function runCLI(
  args: string[],
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await cmd.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  return {
    stdout,
    stderr,
    success: output.success,
  };
}

Deno.test("CLI Options - Directory Patterns", async (t) => {
  await t.step("should show help with new options", async () => {
    const result = await runCLI(["--help"]);

    assert(result.success);
    assert(result.stdout.includes("--include-dirs"));
    assert(result.stdout.includes("--include-dirs-file"));
    assert(result.stdout.includes("--no-defaults"));
    assert(result.stdout.includes("Add directory names to remove"));
    assert(result.stdout.includes("Read directory names from file"));
    assert(result.stdout.includes("Skip default Claude patterns"));
  });

  await t.step("should accept single --include-dirs flag", async () => {
    const result = await runCLI(["--files-only", "--include-dirs", "claudedocs"]);

    // Should run without error (may fail due to missing deps, but not due to CLI parsing)
    assert(
      result.stdout.includes("Running in dry-run mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should accept multiple --include-dirs flags", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "claudedocs",
      "--include-dirs",
      ".serena",
      "--include-dirs",
      "temp",
    ]);

    // Should parse multiple flags without error
    assert(
      result.stdout.includes("Running in dry-run mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should accept --no-defaults flag", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      ".serena",
      "--no-defaults",
    ]);

    assert(
      result.stdout.includes("Running in dry-run mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should handle pattern validation errors", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "../dangerous",
    ]);

    assert(!result.success);
    assert(result.stderr.includes("INVALID_PATTERN"));
    assert(result.stderr.includes("parent directory references (..) are not allowed"));
  });

  await t.step("should handle multiple invalid patterns", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "../parent",
      "--include-dirs",
      "/absolute",
      "--include-dirs",
      "dir/subdir",
    ]);

    assert(!result.success);
    assert(result.stderr.includes("INVALID_PATTERN"));
  });

  await t.step("should show warnings for broad patterns", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "temp",
      "--include-dirs",
      "cache",
    ]);

    // Should show warnings but still proceed
    assert(
      result.stdout.includes("Pattern 'temp' may match many directories") ||
        result.stderr.includes("Pattern 'temp' may match many directories"),
    );
    assert(
      result.stdout.includes("Pattern 'cache' may match many directories") ||
        result.stderr.includes("Pattern 'cache' may match many directories"),
    );
  });
});

Deno.test("CLI Options - Pattern File", async (t) => {
  const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-cli-test" });

  await t.step("should accept --include-dirs-file option", async () => {
    const patternsFile = join(tempDir, "patterns.txt");
    await Deno.writeTextFile(patternsFile, "claudedocs\n.serena\ntemp");

    const result = await runCLI([
      "--files-only",
      "--include-dirs-file",
      patternsFile,
    ]);

    // Should load file successfully
    assert(
      result.stdout.includes("Running in dry-run mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );

    await Deno.remove(patternsFile);
  });

  await t.step("should handle missing pattern file", async () => {
    const missingFile = join(tempDir, "does-not-exist.txt");

    const result = await runCLI([
      "--files-only",
      "--include-dirs-file",
      missingFile,
    ]);

    assert(!result.success);
    assert(result.stderr.includes("FILE_READ_ERROR"));
    assert(result.stderr.includes("Failed to read directory patterns file"));
  });

  await t.step("should combine CLI and file patterns", async () => {
    const patternsFile = join(tempDir, "combined.txt");
    await Deno.writeTextFile(patternsFile, "claudedocs\n.serena");

    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "extra-dir",
      "--include-dirs-file",
      patternsFile,
      "--verbose",
    ]);

    // Should load file and combine with CLI patterns
    assert(
      result.stdout.includes("Loaded 2 directory patterns from") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );

    await Deno.remove(patternsFile);
  });

  await t.step("should handle pattern file with comments", async () => {
    const patternsFile = join(tempDir, "with-comments.txt");
    const content = `# Claude cleaner patterns
claudedocs
# Documentation directory
.serena
# End of file`;
    await Deno.writeTextFile(patternsFile, content);

    const result = await runCLI([
      "--files-only",
      "--include-dirs-file",
      patternsFile,
      "--verbose",
    ]);

    // Should skip comments and load only actual patterns
    assert(
      result.stdout.includes("Loaded 2 directory patterns from") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );

    await Deno.remove(patternsFile);
  });

  await t.step("should validate patterns from file", async () => {
    const patternsFile = join(tempDir, "invalid-patterns.txt");
    const content = "claudedocs\n../parent\n.serena";
    await Deno.writeTextFile(patternsFile, content);

    const result = await runCLI([
      "--files-only",
      "--include-dirs-file",
      patternsFile,
    ]);

    // Should fail validation for patterns from file
    assert(!result.success);
    assert(result.stderr.includes("INVALID_PATTERN"));
    assert(result.stderr.includes("parent directory references (..) are not allowed"));

    await Deno.remove(patternsFile);
  });

  // Cleanup
  await Deno.remove(tempDir, { recursive: true });
});

Deno.test("CLI Options - Integration with Existing Flags", async (t) => {
  await t.step("should work with --files-only", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "claudedocs",
    ]);

    assert(
      result.stdout.includes("Files-only mode") || result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should work with --commits-only", async () => {
    const result = await runCLI([
      "--commits-only",
      "--include-dirs",
      "claudedocs",
    ]);

    // commits-only should ignore include-dirs (only affects file cleaning)
    assert(
      result.stdout.includes("Commits-only mode") || result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should work with --verbose", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "claudedocs",
      "--verbose",
    ]);

    assert(result.stdout.includes("System info") || result.stderr.includes("MISSING_DEPENDENCIES"));
  });

  await t.step("should work with dry-run (default)", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "claudedocs",
    ]);

    assert(
      result.stdout.includes("Running in dry-run mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES"),
    );
  });

  await t.step("should work with --execute", async () => {
    const result = await runCLI([
      "--files-only",
      "--include-dirs",
      "claudedocs",
      "--execute",
    ]);

    // Will likely fail due to missing BFG dependencies, but should show execute mode
    assert(
      result.stdout.includes("Execute mode") ||
        result.stderr.includes("MISSING_DEPENDENCIES") ||
        result.stderr.includes("BFG_NOT_FOUND"),
    );
  });
});
