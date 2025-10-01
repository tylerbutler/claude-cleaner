/**
 * Tests for interactive file selector with tree view display
 * @module tests/unit/interactive-selector.test.ts
 */

import { assert, assertEquals, assertExists } from "@std/assert";
import { assertSpyCalls, spy, stub } from "@std/testing/mock";
import type { Checkbox } from "@cliffy/prompt";
import {
  displaySelectionSummary,
  type FileEntry,
  selectFilesToClean,
} from "../../src/interactive-selector.ts";
import { ConsoleLogger } from "../../src/utils.ts";

/**
 * Mock logger that captures output for testing
 */
class MockLogger extends ConsoleLogger {
  public messages: string[] = [];
  public warnings: string[] = [];
  public errors: string[] = [];
  public verboseMessages: string[] = [];
  public debugMessages: string[] = [];

  constructor(verboseMode = false) {
    super(verboseMode);
  }

  override info(message: string): void {
    this.messages.push(message);
  }

  override warn(message: string): void {
    this.warnings.push(message);
  }

  override error(message: string): void {
    this.errors.push(message);
  }

  override verbose(message: string): void {
    this.verboseMessages.push(message);
  }

  override debug(message: string): void {
    this.debugMessages.push(message);
  }

  clear(): void {
    this.messages = [];
    this.warnings = [];
    this.errors = [];
    this.verboseMessages = [];
    this.debugMessages = [];
  }
}

Deno.test("selectFilesToClean - Empty file list", async (t) => {
  await t.step("returns empty array for no files", async () => {
    const logger = new MockLogger();
    const result = await selectFilesToClean([], logger);

    assertEquals(result, []);
    assertEquals(logger.messages.length, 0);
  });
});

Deno.test("selectFilesToClean - Tree structure and formatting", async (t) => {
  await t.step("single file creates correct tree", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "CLAUDE.md",
        type: "file",
        reason: "Claude documentation",
      },
    ];

    // Mock the Checkbox.prompt to capture options and return selection
    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve(["CLAUDE.md"]),
    );

    try {
      const result = await selectFilesToClean(files, logger);

      assertEquals(result, ["CLAUDE.md"]);
      assert(logger.messages.length > 0);
      assert(logger.messages[0]?.includes("Found 1 Claude artifacts"));

      // Verify prompt was called
      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        message: string;
        options: Array<{ name: string; value: string }>;
      };

      // Verify tree formatting
      assertEquals(args.options.length, 1);
      const option = args.options[0];
      assertExists(option);
      assert(option.name.includes("📄")); // File icon
      assert(option.name.includes("CLAUDE.md"));
      assert(option.name.includes("(Claude documentation)"));
    } finally {
      promptStub.restore();
    }
  });

  await t.step("multiple files in same directory", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "src/foo.ts", type: "file", reason: "test file 1" },
      { path: "src/bar.ts", type: "file", reason: "test file 2" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve(["src/foo.ts", "src/bar.ts"]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Should have 3 options: src directory + 2 files
      assertEquals(args.options.length, 3);

      // Verify directory comes first
      const firstOption = args.options[0];
      assertExists(firstOption);
      assert(firstOption.name.includes("📁")); // Directory icon
      assert(firstOption.name.includes("src"));

      // Verify files are sorted alphabetically
      const secondOption = args.options[1];
      const thirdOption = args.options[2];
      assertExists(secondOption);
      assertExists(thirdOption);
      assert(secondOption.name.includes("bar.ts"));
      assert(thirdOption.name.includes("foo.ts"));
    } finally {
      promptStub.restore();
    }
  });

  await t.step("nested directory structures", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "src/lib/utils.ts", type: "file", reason: "nested file" },
      { path: "src/main.ts", type: "file", reason: "root file" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Should have: src, lib, utils.ts, main.ts
      assertEquals(args.options.length, 4);

      // Verify tree indentation with box-drawing characters
      const srcOption = args.options[0];
      const libOption = args.options[1];
      const utilsOption = args.options[2];
      const mainOption = args.options[3];

      assertExists(srcOption);
      assertExists(libOption);
      assertExists(utilsOption);
      assertExists(mainOption);

      assert(srcOption.name.includes("└─") || srcOption.name.includes("├─"));
      assert(libOption.name.includes("└─") || libOption.name.includes("├─"));
      assert(utilsOption.name.includes("└─"));
      assert(mainOption.name.includes("└─"));

      // Verify proper indentation (nested items have more prefix)
      assert(libOption.name.startsWith("   ") || libOption.name.startsWith("│"));
      assert(
        utilsOption.name.startsWith("      ") ||
          utilsOption.name.startsWith("   │"),
      );
    } finally {
      promptStub.restore();
    }
  });

  await t.step("files with shared parent directories", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "a/b/file1.ts", type: "file", reason: "file 1" },
      { path: "a/b/file2.ts", type: "file", reason: "file 2" },
      { path: "a/c/file3.ts", type: "file", reason: "file 3" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Should have: a, b, file1, file2, c, file3
      assertEquals(args.options.length, 6);

      // Verify shared parent 'a' appears once
      const pathValues = args.options.map((opt) => opt.value);
      const aCount = pathValues.filter((p) => p === "a").length;
      assertEquals(aCount, 1);

      // Verify both 'b' and 'c' subdirectories exist
      assert(pathValues.includes("a/b"));
      assert(pathValues.includes("a/c"));
    } finally {
      promptStub.restore();
    }
  });

  await t.step("root-level files", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "CLAUDE.md", type: "file", reason: "root file" },
      { path: "README.md", type: "file", reason: "another root" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Should have 2 files at root level
      assertEquals(args.options.length, 2);

      // All should be files (no directory wrapper)
      for (const option of args.options) {
        assert(option.name.includes("📄"));
        assert(option.name.includes("└─") || option.name.includes("├─"));
      }
    } finally {
      promptStub.restore();
    }
  });

  await t.step("deep nesting", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "a/b/c/d/e/file.ts",
        type: "file",
        reason: "deeply nested",
      },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Should have: a, b, c, d, e, file.ts = 6 options
      assertEquals(args.options.length, 6);

      // Verify increasing indentation
      const names = args.options.map((opt) => opt.name);
      // Each level should have more indentation than the previous
      for (let i = 1; i < names.length; i++) {
        const prevSpaces = names[i - 1]?.match(/^(\s*)/)?.[0].length ?? 0;
        const currSpaces = names[i]?.match(/^(\s*)/)?.[0].length ?? 0;
        assert(currSpaces >= prevSpaces);
      }
    } finally {
      promptStub.restore();
    }
  });

  await t.step("special characters in paths", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "my-file.test.ts",
        type: "file",
        reason: "hyphens and dots",
      },
      { path: "folder_name/file.ts", type: "file", reason: "underscore" },
      { path: "foo bar/baz.ts", type: "file", reason: "space" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Verify all files are present with correct values
      const values = args.options.map((opt) => opt.value);
      assert(values.includes("my-file.test.ts"));
      assert(values.includes("folder_name"));
      assert(values.includes("folder_name/file.ts"));
      assert(values.includes("foo bar"));
      assert(values.includes("foo bar/baz.ts"));
    } finally {
      promptStub.restore();
    }
  });
});

Deno.test("selectFilesToClean - Sorting and icons", async (t) => {
  await t.step("directories appear before files", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "src/file.ts", type: "file", reason: "file" },
      { path: ".claude/config.json", type: "file", reason: "config" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Tree shows directories first (alphabetically), then their children
      // Expected order:
      // 1. .claude/ (directory)
      // 2.   .claude/config.json (file under .claude)
      // 3. src/ (directory)
      // 4.   src/file.ts (file under src)

      assertEquals(args.options.length, 4);

      // First should be .claude directory
      assert(args.options[0]?.name.includes("📁"));
      assert(args.options[0]?.value === ".claude");

      // Second should be config.json file under .claude
      assert(args.options[1]?.name.includes("📄"));
      assert(args.options[1]?.value === ".claude/config.json");

      // Third should be src directory
      assert(args.options[2]?.name.includes("📁"));
      assert(args.options[2]?.value === "src");

      // Fourth should be file.ts under src
      assert(args.options[3]?.name.includes("📄"));
      assert(args.options[3]?.value === "src/file.ts");
    } finally {
      promptStub.restore();
    }
  });

  await t.step("files sorted alphabetically within same directory", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "src/zebra.ts", type: "file", reason: "z" },
      { path: "src/alpha.ts", type: "file", reason: "a" },
      { path: "src/beta.ts", type: "file", reason: "b" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Skip the src directory (first option) and check files
      assertEquals(args.options[1]?.value, "src/alpha.ts");
      assertEquals(args.options[2]?.value, "src/beta.ts");
      assertEquals(args.options[3]?.value, "src/zebra.ts");
    } finally {
      promptStub.restore();
    }
  });

  await t.step("correct icons for files and directories", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "mydir/file.ts", type: "file", reason: "test" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      // Directory should have folder icon
      assert(args.options[0]?.name.includes("📁"));
      assert(args.options[0]?.name.includes("mydir"));

      // File should have file icon
      assert(args.options[1]?.name.includes("📄"));
      assert(args.options[1]?.name.includes("file.ts"));
    } finally {
      promptStub.restore();
    }
  });
});

Deno.test("selectFilesToClean - Reason suffixes", async (t) => {
  await t.step("reason appended in parentheses", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "CLAUDE.md",
        type: "file",
        reason: "Claude documentation file",
      },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      const option = args.options[0];
      assertExists(option);
      assert(option.name.includes("(Claude documentation file)"));
    } finally {
      promptStub.restore();
    }
  });

  await t.step("no suffix for empty reason", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as {
        options: Array<{ name: string; value: string }>;
      };

      const option = args.options[0];
      assertExists(option);
      assert(!option.name.includes("()"));
    } finally {
      promptStub.restore();
    }
  });
});

Deno.test("selectFilesToClean - User interaction", async (t) => {
  await t.step("returns user selection", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
      { path: "file2.ts", type: "file", reason: "r2" },
      { path: "file3.ts", type: "file", reason: "r3" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve(["file1.ts", "file3.ts"]),
    );

    try {
      const result = await selectFilesToClean(files, logger);

      assertEquals(result, ["file1.ts", "file3.ts"]);
    } finally {
      promptStub.restore();
    }
  });

  await t.step("handles empty selection", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      const result = await selectFilesToClean(files, logger);

      assertEquals(result, []);
    } finally {
      promptStub.restore();
    }
  });

  await t.step("displays correct message with file count", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
      { path: "file2.ts", type: "file", reason: "r2" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assert(logger.messages.some((msg) => msg.includes("Found 2 Claude artifacts")));
    } finally {
      promptStub.restore();
    }
  });

  await t.step("provides helpful hint text", async () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    const { Checkbox } = await import("@cliffy/prompt");
    const promptStub = stub(
      Checkbox,
      "prompt",
      () => Promise.resolve([]),
    );

    try {
      await selectFilesToClean(files, logger);

      assertSpyCalls(promptStub, 1);
      const call = promptStub.calls[0];
      assertExists(call);

      const args = call.args[0] as { hint: string };
      assertExists(args.hint);
      assert(args.hint.includes("Space"));
      assert(args.hint.includes("Enter"));
    } finally {
      promptStub.restore();
    }
  });
});

Deno.test("displaySelectionSummary - No selection", async (t) => {
  await t.step("displays no selection message", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    displaySelectionSummary([], files, logger);

    assert(logger.messages.some((msg) => msg.includes("No files selected")));
    assert(logger.messages.some((msg) => msg.includes("❌")));
  });
});

Deno.test("displaySelectionSummary - With selections", async (t) => {
  await t.step("displays correct file count", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
      { path: "file2.ts", type: "file", reason: "r2" },
    ];

    displaySelectionSummary(["file1.ts", "file2.ts"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("Selected 2 file(s)")));
  });

  await t.step("displays selected file paths", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
      { path: "file2.ts", type: "file", reason: "r2" },
    ];

    displaySelectionSummary(["file1.ts"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("file1.ts")));
    assert(!logger.messages.some((msg) => msg.includes("file2.ts")));
  });

  await t.step("uses correct icons for files", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    displaySelectionSummary(["file.ts"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("📄")));
  });

  await t.step("uses correct icons for directories", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: ".claude", type: "directory", reason: "test" },
    ];

    displaySelectionSummary([".claude"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("📂")));
  });

  await t.step("displays commit information when present", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "file.ts",
        type: "file",
        reason: "test",
        earliestCommit: {
          hash: "abc123def456",
          date: "2024-01-15",
          message: "Add file",
        },
      },
    ];

    displaySelectionSummary(["file.ts"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("First appeared")));
    assert(logger.messages.some((msg) => msg.includes("abc123d"))); // Shortened hash
    assert(logger.messages.some((msg) => msg.includes("2024-01-15")));
  });

  await t.step("handles files without commit information", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    displaySelectionSummary(["file.ts"], files, logger);

    assert(!logger.messages.some((msg) => msg.includes("First appeared")));
  });

  await t.step("displays multiple files correctly", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      {
        path: "file1.ts",
        type: "file",
        reason: "r1",
        earliestCommit: {
          hash: "abc123",
          date: "2024-01-15",
          message: "msg1",
        },
      },
      {
        path: "dir",
        type: "directory",
        reason: "r2",
      },
      {
        path: "file2.ts",
        type: "file",
        reason: "r3",
      },
    ];

    displaySelectionSummary(["file1.ts", "dir", "file2.ts"], files, logger);

    // Should show all three files
    assert(logger.messages.some((msg) => msg.includes("file1.ts")));
    assert(logger.messages.some((msg) => msg.includes("dir")));
    assert(logger.messages.some((msg) => msg.includes("file2.ts")));

    // Should show commit info only for file1
    const commitMessages = logger.messages.filter((msg) =>
      msg.includes("First appeared")
    );
    assertEquals(commitMessages.length, 1);
  });

  await t.step("handles partial selection", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
      { path: "file2.ts", type: "file", reason: "r2" },
      { path: "file3.ts", type: "file", reason: "r3" },
    ];

    displaySelectionSummary(["file1.ts", "file3.ts"], files, logger);

    assert(logger.messages.some((msg) => msg.includes("Selected 2 file(s)")));
    assert(logger.messages.some((msg) => msg.includes("file1.ts")));
    assert(logger.messages.some((msg) => msg.includes("file3.ts")));
    assert(!logger.messages.some((msg) => msg.includes("file2.ts")));
  });
});

Deno.test("displaySelectionSummary - Edge cases", async (t) => {
  await t.step("handles single file selection", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file.ts", type: "file", reason: "test" },
    ];

    displaySelectionSummary(["file.ts"], files, logger);

    // Should use singular "file" not "files"
    assert(logger.messages.some((msg) => msg.includes("Selected 1 file(s)")));
  });

  await t.step("handles empty selected array with empty files array", () => {
    const logger = new MockLogger();

    displaySelectionSummary([], [], logger);

    assert(logger.messages.some((msg) => msg.includes("No files selected")));
  });

  await t.step("handles selection that doesn't match any files", () => {
    const logger = new MockLogger();
    const files: FileEntry[] = [
      { path: "file1.ts", type: "file", reason: "r1" },
    ];

    // Selected file doesn't exist in files array
    displaySelectionSummary(["nonexistent.ts"], files, logger);

    // Should not crash and should show 0 files
    const filtered = files.filter((f) =>
      ["nonexistent.ts"].includes(f.path)
    );
    assertEquals(filtered.length, 0);
  });
});
