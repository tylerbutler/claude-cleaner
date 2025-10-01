#!/usr/bin/env -S deno run --allow-all

/**
 * Demo script for the interactive file selector feature
 *
 * This demonstrates the tree-based file selection UI powered by Cliffy's Checkbox prompt
 */

import {
  displaySelectionSummary,
  selectFilesToClean,
  type FileEntry,
} from "../src/interactive-selector.ts";
import { ConsoleLogger } from "../src/utils.ts";

const logger = new ConsoleLogger(true);

// Sample Claude files that would be detected
const sampleFiles: FileEntry[] = [
  {
    path: ".claude/config.json",
    type: "file",
    reason: "Claude-related file",
    earliestCommit: {
      hash: "abc123def456",
      date: "2025-09-30",
      message: "Add Claude configuration",
    },
  },
  {
    path: ".claude",
    type: "directory",
    reason: "Claude configuration directory",
  },
  {
    path: "CLAUDE.md",
    type: "file",
    reason: "Claude project configuration file",
  },
  {
    path: "src/utils/claude-helper.ts",
    type: "file",
    reason: "Claude-related file",
    earliestCommit: {
      hash: "def456abc789",
      date: "2025-09-29",
      message: "Add Claude helper utilities",
    },
  },
  {
    path: "docs/claude-setup.md",
    type: "file",
    reason: "Claude documentation file",
  },
  {
    path: "tests/claude-test.ts",
    type: "file",
    reason: "Claude-related file",
  },
];

console.log("=== Interactive File Selector Demo ===\n");
console.log("This demo shows the tree-based file selection interface.\n");
console.log("Features:");
console.log("  ✓ Tree view with nested directory structure");
console.log("  ✓ Checkbox selection for individual files");
console.log("  ✓ Visual file/directory icons (📁 📄)");
console.log("  ✓ Reason for each match displayed inline");
console.log("  ✓ Keyboard navigation (↑/↓ arrows, Space to toggle, Enter to confirm)");
console.log("  ✓ 'a' key to toggle all selections\n");

console.log("Sample files to be presented:\n");
for (const file of sampleFiles) {
  const icon = file.type === "directory" ? "📁" : "📄";
  console.log(`  ${icon} ${file.path} - ${file.reason}`);
}

console.log("\nLaunching interactive selector...\n");

try {
  const selected = await selectFilesToClean(sampleFiles, logger);

  if (selected.length === 0) {
    logger.info("\n❌ No files selected");
  } else {
    displaySelectionSummary(selected, sampleFiles, logger);
  }
} catch (error) {
  if (error instanceof Error && error.message.includes("interrupted")) {
    console.log("\n\nDemo cancelled (Ctrl+C pressed)");
  } else {
    throw error;
  }
}
