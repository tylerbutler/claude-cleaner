import { Checkbox } from "@cliffy/prompt";
import type { ConsoleLogger } from "./utils.ts";

export interface FileEntry {
  path: string;
  type: "file" | "directory";
  reason: string;
  earliestCommit?: {
    hash: string;
    date: string;
    message: string;
  };
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children: TreeNode[] | undefined;
  entry: FileEntry | undefined;
}

/**
 * Build a tree structure from flat file paths
 */
function buildFileTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = {
    name: "root",
    path: "",
    type: "directory",
    children: [],
    entry: undefined,
  };

  for (const file of files) {
    const parts = file.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;

      const isLast = i === parts.length - 1;
      const existingChild = current.children?.find((c) => c.name === part);

      if (existingChild) {
        current = existingChild;
        if (isLast) {
          existingChild.entry = file;
        }
      } else {
        const newNode: TreeNode = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          type: isLast ? file.type : "directory",
          children: isLast ? undefined : [],
          entry: isLast ? file : undefined,
        };

        current.children = current.children ?? [];
        current.children.push(newNode);
        current = newNode;
      }
    }
  }

  return root;
}

/**
 * Flatten tree into display options with indentation
 */
function flattenTree(
  node: TreeNode,
  depth = 0,
  prefix = "",
): Array<{ name: string; value: string; disabled?: boolean }> {
  const options: Array<{ name: string; value: string; disabled?: boolean }> = [];

  if (!node.children || node.children.length === 0) {
    return options;
  }

  // Sort: directories first, then files
  const sorted = [...node.children].sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === "directory" ? -1 : 1;
  });

  for (let i = 0; i < sorted.length; i++) {
    const child = sorted[i];
    if (!child) continue;

    const isLast = i === sorted.length - 1;
    const connector = isLast ? "└─ " : "├─ ";
    const icon = child.type === "directory" ? "📁" : "📄";
    const childPrefix = prefix + (isLast ? "   " : "│  ");

    // Add current node
    const displayName = `${prefix}${connector}${icon} ${child.name}`;
    const reasonSuffix = child.entry?.reason ? ` (${child.entry.reason})` : "";

    options.push({
      name: displayName + reasonSuffix,
      value: child.path,
    });

    // Add children recursively
    if (child.children && child.children.length > 0) {
      options.push(...flattenTree(child, depth + 1, childPrefix));
    }
  }

  return options;
}

/**
 * Present interactive file selector to user
 */
export async function selectFilesToClean(
  files: FileEntry[],
  logger: ConsoleLogger,
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  logger.info(`\n📋 Found ${files.length} Claude artifacts. Select files to remove:\n`);

  // Build tree structure
  const tree = buildFileTree(files);

  // Flatten to display options
  const options = flattenTree(tree);

  // Present checkbox selection
  const selected = await Checkbox.prompt<string>({
    message: "Select files to remove (use Space to toggle, Enter to confirm)",
    options,
    hint: "Use ↑/↓ to navigate, Space to select, a to toggle all, Enter to confirm",
  });

  return selected;
}

/**
 * Display summary of selected files
 */
export function displaySelectionSummary(
  selected: string[],
  allFiles: FileEntry[],
  logger: ConsoleLogger,
): void {
  if (selected.length === 0) {
    logger.info("\n❌ No files selected for removal");
    return;
  }

  const selectedFiles = allFiles.filter((f) => selected.includes(f.path));
  logger.info(`\n✓ Selected ${selected.length} file(s) for removal:`);

  for (const file of selectedFiles) {
    const icon = file.type === "directory" ? "📂" : "📄";
    logger.info(`  ${icon} ${file.path}`);
    if (file.earliestCommit) {
      logger.info(
        `    ↳ First appeared: ${
          file.earliestCommit.hash.substring(0, 7)
        } (${file.earliestCommit.date})`,
      );
    }
  }
}
