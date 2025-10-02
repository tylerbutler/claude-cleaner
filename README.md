# Claude Cleaner

[![CI](https://github.com/tylerbutler/claude-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerbutler/claude-cleaner/actions/workflows/ci.yml)
[![JSR](https://jsr.io/badges/@tylerbu/claude-cleaner)](https://jsr.io/@tylerbu/claude-cleaner)
[![JSR Score](https://jsr.io/badges/@tylerbu/claude-cleaner/score)](https://jsr.io/@tylerbu/claude-cleaner)
[![GitHub release](https://img.shields.io/github/v/release/tylerbutler/claude-cleaner)](https://github.com/tylerbutler/claude-cleaner/releases/latest)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](https://github.com/tylerbutler/claude-cleaner/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A TypeScript/Deno tool to remove Claude artifacts from Git repositories.

> [!WARNING]
> Claude Cleaner was written primarily by Claude Sonnet 4.0 with direction and design from \@tylerbutler. Caveat emptor.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [What Gets Cleaned](#what-gets-cleaned)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Safety Features](#safety-features)
- [Troubleshooting](#troubleshooting)
- [Frequently Asked Questions](#frequently-asked-questions)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## Overview

Claude Cleaner removes Claude-related files, commit trailers, and other artifacts from Git repository history. It combines BFG Repo-Cleaner for file removal with modern text processing for commit message cleaning.

## Features

- 🔒 **Safe**: Dry-run mode, automatic backups, and rollback capabilities
- 🌍 **Cross-platform**: Works on Windows, macOS, and Linux
- 📦 **Self-contained**: Compiles to a single binary with dependency auto-installation
- 🎯 **Flexible**: Files-only, commits-only, or full cleaning modes

## What Gets Cleaned

Claude Cleaner targets specific files and commit patterns created by Claude Code. Your regular project files and commit messages remain untouched.

> [!IMPORTANT]
> **Breaking Change (v0.3.0):** `CLAUDE.md` instruction files are now **preserved by default** to keep project documentation intact. Use `--include-instruction-files` or `--include-all-common-patterns` to remove them.

### Files Removed (Standard Mode)

The tool uses **exact basename matching** for safety. For example:

- **`.claude/`** matches only directories named exactly `.claude` (not `.claude2` or `my.claude`)
- **`.vscode/claude.json`** matches the exact path `.vscode/claude.json` only

**Standard patterns (CLAUDE.md files are preserved by default):**

- **`.claude/` directories** - Claude workspace configurations
- **`claudedocs/` directories** - Claude documentation (MCP server)
- **`.serena/` directories** - Serena MCP server data
- **`.vscode/claude.json`** - VSCode Claude extension settings
- **Temporary Claude files** - Auto-generated temporary files

**Preserved by default:**

- **`CLAUDE.md`** - Project instruction files (use `--include-instruction-files` to remove)

> [!TIP]
> Use `--include-dirs <name>` to match additional directories like `.claude-backup` or `claude-workspace` (matches by exact directory name anywhere in the repository)

### Extended Patterns (With `--include-all-common-patterns`)

This flag enables comprehensive cleanup by matching many more Claude-related file patterns across multiple categories:

- **Configuration files** - Settings, workspace, environment configs
- **Session & state** - Session data, cache, history files
- **Temporary files** - Working files, drafts, backups
- **Process files** - Lock files, PIDs, sockets
- **Debug files** - Debug logs, traces, profiles
- **Export files** - Archives, dumps, snapshots
- **IDE integration** - IDE-specific Claude configs
- **Documentation** - Notes, docs, instructions
- **Scripts** - Shell scripts, utilities, helpers
- **Hidden files** - Dotfiles like `.clauderc`
- **Versioned files** - Numbered or versioned variants

See [PATTERNS.md](PATTERNS.md) for the complete pattern reference with examples and detailed explanations.

> [!WARNING]
> The `--include-all-common-patterns` flag finds _many_ more files than standard mode. Always review the dry-run output first before using `--execute`.

### Commit Trailers Removed

- **`🤖 Generated with [Claude Code](...)`** - Claude attribution trailers
- **`Co-Authored-By: Claude <noreply@anthropic.com>`** - Co-authorship attributions
- **Other Claude attribution lines** - Additional Claude-generated metadata

## Installation

### Prerequisites

The tool automatically installs all required dependencies via [mise](https://mise.jdx.dev/) when using the `--auto-install` flag. Manual installation is optional.

**Auto-installed dependencies:**

- Java (for BFG Repo-Cleaner)
- sd (modern sed replacement)

### Install Claude Cleaner

```bash
# Option 1: Install from JSR (recommended)
deno install -A jsr:@tylerbu/claude-cleaner

# Option 2: Download pre-built binary
# Download from GitHub releases page

# Option 3: Build from source (requires Deno)
git clone https://github.com/yourusername/claude-cleaner  # Replace with actual repository URL
cd claude-cleaner
deno compile --allow-all --output claude-cleaner src/main.ts
```

## Quick Start

> [!WARNING]
> Always backup your repository or ensure it's committed to a remote before cleaning. While automatic backups are created, having an external backup provides extra safety.

```bash
# 1. Check dependencies (auto-installs if needed)
claude-cleaner check-deps --auto-install

# 2. Preview changes without modifying anything (dry-run is the default)
claude-cleaner

# 3. Execute cleaning (only after reviewing dry-run output)
claude-cleaner --execute
```

## Usage

### Command Line Options

```
Usage: claude-cleaner [options] [path]

Options:
  -h, --help                        Show help
  -V, --version                     Show version
  -x, --execute                     Execute changes (default: dry-run mode shows what would be changed)
  -v, --verbose                     Enable verbose output
  --auto-install                    Automatically install required dependencies
  --files-only                      Only remove Claude files (skip commit cleaning)
  --commits-only                    Only clean commit messages (skip file removal)
  --branch <branch>                 Specify branch to clean (default: HEAD)
  --include-all-common-patterns     Include ALL known common Claude patterns (for complete cleanup)
  --include-instruction-files       Include CLAUDE.md instruction files for removal (preserved by default)
  --include-dirs <name>             Add directory name to remove (matches directories with this name anywhere)
  --include-dirs-file <file>        Read directory names from file (one pattern per line)
  --no-defaults                     Don't include default Claude patterns (use only explicit patterns)

Arguments:
  <repo-path>                       Path to Git repository (REQUIRED)

Commands:
  check-deps                        Check if all required dependencies are available
```

### Basic Examples

```bash
# Preview changes (default behavior)
claude-cleaner .

# Execute cleaning after reviewing dry-run
claude-cleaner . --execute

# Clean specific repository
claude-cleaner /path/to/repo --execute

# Preview with verbose output
claude-cleaner . --verbose

# Check what dependencies are needed
claude-cleaner check-deps
```

### Selective Cleaning

```bash
# Preview file removal only
claude-cleaner . --files-only --auto-install

# Execute file removal only
claude-cleaner . --files-only --execute --auto-install

# Preview commit message cleaning only
claude-cleaner . --commits-only --auto-install

# Execute commit cleaning on specific branch
claude-cleaner . --commits-only --execute --branch feature/my-branch --auto-install
```

### Comprehensive Cleaning

Use `--include-all-common-patterns` for complete Claude artifact removal, especially for long-running projects or when preparing repositories for distribution.

```bash
# Preview comprehensive cleanup (recommended first)
claude-cleaner --include-all-common-patterns --verbose

# Execute complete cleanup - find ALL known/possible Claude patterns
claude-cleaner --include-all-common-patterns --execute

# Preview comprehensive file-only cleanup
claude-cleaner --include-all-common-patterns --files-only --verbose

# Execute comprehensive file-only cleanup
claude-cleaner --include-all-common-patterns --files-only --execute
```

### Removing Instruction Files

By default, `CLAUDE.md` instruction files are preserved to keep project documentation intact. To remove them:

```bash
# Remove CLAUDE.md files along with other Claude artifacts
claude-cleaner --include-instruction-files --execute

# Or use comprehensive mode (automatically includes instruction files)
claude-cleaner --include-all-common-patterns --execute
```

> [!NOTE]
> The `--include-all-common-patterns` flag automatically implies `--include-instruction-files`, removing CLAUDE.md files as part of comprehensive cleanup.

### Advanced Workflows

These examples show advanced usage patterns for power users and troubleshooting scenarios.

```bash
# Manual dependency setup (alternative to --auto-install)
mise install java@temurin-21
mise install sd
claude-cleaner --execute

# Verbose dry-run output for troubleshooting
claude-cleaner --verbose

# Check dependencies without installing
claude-cleaner check-deps

# Execute with verbose output
claude-cleaner --execute --verbose --auto-install

# Custom directory patterns (can be specified multiple times)
claude-cleaner --include-dirs "claude-backup" --include-dirs "claude-workspace"

# Read directory patterns from file
echo "claude-backup" > dirs.txt
echo "claude-workspace" >> dirs.txt
claude-cleaner --include-dirs-file dirs.txt

# Use only custom patterns (exclude defaults)
claude-cleaner --no-defaults --include-dirs "my-claude-files"
```

## How It Works

Claude Cleaner follows a systematic, safety-first approach to ensure your repository integrity while removing Claude artifacts.

### Step-by-Step Process

1. **🔍 Dependency Check** - Verifies Java, BFG Repo-Cleaner, and sd are available (auto-installs via mise if needed)
2. **✅ Repository Validation** - Ensures you're in a valid Git repository with clean working tree
3. **💾 Backup Creation** - Creates backup branches before making any changes
4. **📁 File Removal** - Uses BFG Repo-Cleaner to efficiently remove Claude files from Git history
5. **✏️ Commit Cleaning** - Uses git filter-branch + sd to clean commit messages and trailers
6. **🔎 Verification** - Validates all changes were applied correctly

### Two-Phase Cleaning Process

#### Phase 1: File Removal (`--files-only`)

- **Scans** repository for Claude files (`CLAUDE.md`, `.claude/`, `.vscode/claude.json`, etc.)
- **Removes** files from entire Git history using BFG Repo-Cleaner
- **Creates** backup before any modifications
- **Preserves** commit messages unchanged

#### Phase 2: Commit Cleaning (`--commits-only`)

- **Analyzes** commit messages for Claude trailers and attributions
- **Rewrites** commit history using git filter-branch
- **Employs** sd (modern sed) for Unicode-safe text replacement
- **Preserves** file content unchanged

## Safety Features

Claude Cleaner prioritizes safety with multiple protection mechanisms. However, always ensure your repository is backed up before running any cleaning operations.

### Automatic Backups

Claude Cleaner uses two different backup strategies depending on the operation, both designed to protect against history rewriting:

#### File Cleaning Backups (Bare Clone)

When removing files with BFG Repo-Cleaner:

- **Strategy**: Creates a complete **bare clone** in a separate directory
- **Location**: `../<repo-name>-backup-<timestamp>` (outside your repository)
- **Protection**: Since BFG rewrites commits and updates all refs in the target repository, the bare clone remains completely untouched as a separate physical repository
- **Recovery**: `git clone` the backup directory to restore

```bash
# Example backup location
/path/to/your-repo/.../your-repo-backup-2024-01-15T10-30-00-000Z
```

#### Commit Cleaning Backups (Branch)

When cleaning commit messages with git filter-branch:

- **Strategy**: Creates a **branch** in the same repository
- **Naming format**: `backup/pre-claude-clean-YYYY-MM-DDTHH-MM-SS-sssZ`
- **Protection**: filter-branch only rewrites the specified revision range (current branch), leaving the backup branch pointing to original commits
- **Recovery**: `git checkout backup/...` to restore previous state

**Why different strategies?** BFG operates on entire repositories and updates all refs, so it needs physical separation. Git filter-branch allows selective rewriting by revision range, so a branch backup is sufficient and more convenient.

### Dry Run Mode (Default)

> [!TIP]
> The tool runs in dry-run mode by default. Use `--execute` to apply changes.

```bash
# Preview file changes (dry-run is default)
claude-cleaner --files-only

# Preview commit changes (dry-run is default)
claude-cleaner --commits-only

# Preview full cleaning (dry-run is default)
claude-cleaner

# Execute after reviewing dry-run output
claude-cleaner --execute
```

### Validation Checks

- **Clean working tree**: Working tree must be clean before cleaning
- **Repository integrity**: Git repository integrity verified
- **Dependency validation**: All dependencies validated before execution

## Troubleshooting

Most issues can be resolved by ensuring dependencies are installed and you're in a clean Git repository. Use `--verbose` for detailed error information.

### Common Issues

#### "Missing dependencies" error

> [!TIP]
> The `--auto-install` flag handles dependency installation automatically.

```bash
# Auto-install all dependencies (recommended)
claude-cleaner check-deps --auto-install

# Or install tools manually
```

#### "Not a Git repository" error

```bash
# Specify a valid Git repository path
claude-cleaner /path/to/git/repo --auto-install

# For current directory
claude-cleaner . --auto-install
```

#### "Working tree not clean" error

Commit or stash your changes before running the cleaner to avoid losing work.

```bash
# Option 1: Commit changes
git add . && git commit -m "Save work before cleaning"

# Option 2: Stash changes temporarily
git stash
claude-cleaner --execute --auto-install
git stash pop
```

#### Permission errors

```bash
# On Unix/Linux, ensure proper permissions
chmod +x claude-cleaner

# May need elevated permissions for mise installation
sudo claude-cleaner check-deps --auto-install
```

### Getting Help

```bash
# Verbose dry-run output for debugging
claude-cleaner --verbose

# Check dependency status
claude-cleaner check-deps

# View help
claude-cleaner --help
```

### Recovery and Rollback

If something goes wrong or you need to undo changes, use these recovery steps.

#### Recovering from Commit Cleaning (Branch Backup)

```bash
# View available backup branches
git branch | grep backup/pre-claude-clean

# Restore from automatic backup branch
git checkout backup/pre-claude-clean-2024-01-15T10-30-00-000Z

# If you need to restore your main branch
git branch -f main backup/pre-claude-clean-2024-01-15T10-30-00-000Z
git checkout main

# Verify restoration
git log --oneline -10
```

#### Recovering from File Cleaning (Bare Clone Backup)

```bash
# List backup directories (in parent directory)
ls -d ../your-repo-backup-*

# Clone the backup to restore
cd ..
git clone your-repo-backup-2024-01-15T10-30-00-000Z your-repo-restored

# Or replace your current repository
rm -rf your-repo
git clone your-repo-backup-2024-01-15T10-30-00-000Z your-repo

# Verify restoration
cd your-repo
git log --oneline -10
```

> [!WARNING]
> After restoration, you may need to force push to remote repositories. See the Remote Repositories section below.

### Remote Repositories and Force Pushing

> [!CAUTION]
> Cleaning Git history rewrites commits, which requires force pushing to remote repositories. Force pushing can disrupt team workflows. All collaborators must re-clone or reset their local repositories after you force push.

**Before cleaning a shared repository:**

1. **Coordinate with team**: Ensure all collaborators have pushed their work
2. **Create remote backup**: `git push origin main:backup-main`
3. **Clean locally**: Run claude-cleaner with `--execute`
4. **Force push carefully**: `git push --force-with-lease origin main`

**Team recovery after force push:**

```bash
# Option 1: Reset existing repository (preserves uncommitted work)
git fetch origin
git reset --hard origin/main

# Option 2: Fresh clone (recommended for simplicity)
cd ..
mv old-repo old-repo-backup
git clone <repository-url>
```

## Frequently Asked Questions

### Safety and Recovery

**Q: Is it safe to use on important repositories?**\
**A:** Claude Cleaner creates automatic backups and runs in dry-run mode by default. Always review the dry-run output before using `--execute`.

**Q: Can I undo the changes?**\
**A:** Yes, automatic backups are created before any changes. File cleaning creates a bare clone backup (separate repository), while commit cleaning creates a branch backup. See the Recovery and Rollback section for detailed instructions.

**Q: What if something goes wrong during cleaning?**\
**A:** Stop the process and restore from the automatic backup (branch backup for commit cleaning, bare clone for file cleaning). Check the Recovery and Rollback section for specific recovery steps.

### Compatibility

**Q: What operating systems are supported?**\
**A:** Windows, macOS, and Linux are all supported, but Windows is not well-tested.

### Usage Options

**Q: What if I only want to remove files OR clean commits?**\
**A:** Use `--files-only` or `--commits-only` flags for selective cleaning operations.

**Q: Can I use it in CI/CD pipelines?**\
**A:** It should work but has not been tested. Use `--auto-install` for dependency management and ensure proper permissions are configured.

## Development

See [DEV.md](DEV.md) for development setup, testing guidelines, release process, and contribution instructions.

## Contributing

Contributions welcome! Please see [DEV.md](DEV.md) for development setup and contribution guidelines.

## Acknowledgments

- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) for efficient Git history cleaning
- [mise](https://mise.jdx.dev/) for development tool management
- [sd](https://github.com/chmln/sd) for modern text replacement
- [Deno](https://deno.land/) for the modern TypeScript runtime

## License

MIT License - see [LICENSE](LICENSE) file for details
