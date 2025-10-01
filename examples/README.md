# Interactive File Selector Examples

## Overview

The interactive file selector feature allows users to visually select which Claude artifacts to remove using a tree-based checkbox interface.

## Features

- **Tree View**: Files organized in hierarchical directory structure
- **Visual Icons**: Clear distinction between files (📄) and directories (📁)
- **Inline Reasons**: Shows why each file was matched (e.g., "Claude configuration file")
- **Keyboard Navigation**:
  - `↑/↓` arrows to navigate
  - `Space` to toggle selection
  - `a` to toggle all selections
  - `Enter` to confirm
- **Commit History**: Shows when files first appeared in Git history

## Usage

### Basic Interactive Mode

```bash
claude-cleaner --interactive /path/to/repo
```

This will:
1. Scan for Claude artifacts
2. Display them in a tree view
3. Let you select which ones to remove
4. Show summary (dry-run by default)

### Execute Selected Removals

```bash
claude-cleaner --interactive --execute /path/to/repo
```

Combines interactive selection with actual file removal.

### Files-Only Mode

```bash
claude-cleaner --files-only --interactive /path/to/repo
```

Only scan and select files (skip commit message cleaning).

## Demo

Run the interactive demo:

```bash
./examples/demo-interactive-selector.ts
```

This demonstrates the tree UI with sample files without requiring a real repository.

## Example Output

```
📋 Found 6 Claude artifacts. Select files to remove:

? Select files to remove (use Space to toggle, Enter to confirm)
❯ ✘ ├─ 📁 .claude (Claude configuration directory)
  ✘ │  └─ 📄 config.json (Claude-related file)
  ✘ ├─ 📄 CLAUDE.md (Claude project configuration file)
  ✘ ├─ 📁 docs
  ✘ │  └─ 📄 claude-setup.md (Claude documentation file)
  ✘ ├─ 📁 src
  ✘ │  └─ 📁 utils
  ✘ │     └─ 📄 claude-helper.ts (Claude-related file)
  ✘ └─ 📁 tests
  ✘    └─ 📄 claude-test.ts (Claude-related file)

❯ Use ↑/↓ to navigate, Space to select, a to toggle all, Enter to confirm
```

After selection:

```
✓ Selected 3 file(s) for removal:
  📄 CLAUDE.md
    ↳ First appeared: abc123d (2025-09-30)
  📁 .claude
  📄 src/utils/claude-helper.ts
    ↳ First appeared: def456a (2025-09-29)

Dry-run complete. Use --execute --interactive to remove selected files.
```

## Technical Details

### Implementation

- **UI Framework**: [Cliffy](https://cliffy.io) Checkbox prompt
- **Tree Building**: Automatic hierarchical structure from flat file paths
- **Sorting**: Directories first, then files (alphabetical within each group)
- **Type Safety**: Full TypeScript type checking with strict compiler options

### File Structure

- `src/interactive-selector.ts` - Core implementation
- `src/main.ts` - CLI integration
- `examples/demo-interactive-selector.ts` - Standalone demo

### Architecture

1. **File Detection** → `FileCleaner.detectClaudeFiles()`
2. **Tree Building** → `buildFileTree()` converts flat list to hierarchy
3. **Tree Flattening** → `flattenTree()` creates display options with indentation
4. **User Selection** → `selectFilesToClean()` presents Cliffy Checkbox prompt
5. **Summary** → `displaySelectionSummary()` shows final selection

## Compatibility

- **Deno**: 1.x+
- **Terminal**: Any terminal with ANSI color support
- **Platforms**: Linux, macOS, Windows

## See Also

- [Cliffy Documentation](https://cliffy.io/docs@v1.0.0-rc.7/prompt/types/checkbox)
- [Main README](../README.md)
