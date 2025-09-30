# Claude Cleaner

A comprehensive TypeScript/Deno tool to remove Claude artifacts from Git repositories.

> [!IMPORTANT]
> The tool runs in dry-run mode by default to preview changes. Use `--execute` to apply changes. Automatic backups are created, but prevention is better than recovery.

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
- [Performance Benchmarks](#performance-benchmarks)
- [Development](#development)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)

## Overview

Claude Cleaner is a professional-grade tool that removes Claude-related files, commit trailers, and other artifacts from Git repository history. It combines BFG Repo-Cleaner for efficient file removal with modern text processing for commit message cleaning, all wrapped in a user-friendly CLI.

## Features

- 🚀 **Fast**: Uses BFG Repo-Cleaner for efficient Git history cleaning
- 🔒 **Safe**: Dry-run mode, automatic backups, and rollback capabilities
- 🌍 **Cross-platform**: Works on Windows, macOS, and Linux
- 📦 **Self-contained**: Compiles to a single binary with dependency auto-installation
- 🛠 **Modern**: Built with TypeScript and Deno for reliability and performance
- 🧪 **Well-tested**: Comprehensive test suite with 100+ tests
- 🎯 **Flexible**: Files-only, commits-only, or full cleaning modes

## What Gets Cleaned

> [!NOTE]
> Claude Cleaner targets specific files and commit patterns created by Claude Code. Your regular project files and commit messages remain untouched.

### Files Removed (Standard Mode)

The tool uses **exact basename matching** for safety. For example:

- **`CLAUDE.md`** matches only files named exactly `CLAUDE.md` (not `CLAUDE.md.backup` or `MY-CLAUDE.md`)
- **`.claude/`** matches only directories named exactly `.claude` (not `.claude2` or `my.claude`)
- **`.vscode/claude.json`** matches the exact path `.vscode/claude.json` only

**Standard patterns:**

- **`CLAUDE.md`** - Project-specific Claude instructions
- **`.claude/` directories** - Claude workspace configurations
- **`claudedocs/` directories** - Claude documentation (MCP server)
- **`.serena/` directories** - Serena MCP server data
- **`.vscode/claude.json`** - VSCode Claude extension settings
- **Temporary Claude files** - Auto-generated temporary files

> [!NOTE]
> Use `--include-dirs <name>` to match additional directories like `.claude-backup` or `claude-workspace` (matches by exact directory name anywhere in the repository)

### Additional Files (With `--include-all-common-patterns`)

> [!NOTE]
> This flag enables comprehensive cleanup by matching many more Claude-related file patterns. Always review dry-run output first.

**Configuration Files:**

- `claude*.json|yaml|yml|toml|ini|config`
- `claude-config*`, `claude-settings*`, `claude-workspace*`, `claude-env*`

**Session & State Files:**

- `claude-session*`, `claude-state*`, `claude-cache*`, `claude-history*`

**Temporary & Working Files:**

- `claude-temp*`, `claude-tmp*`, `claude-work*`, `claude-scratch*`, `claude-draft*`
- `claude*.bak|backup|old|orig|save`
- `claude-output*`, `claude-result*`, `claude-analysis*`, `claude-report*`

**Process Files:**

- `claude*.lock|pid|socket`
- `claude-lock*`, `claude-process*`, `claude-run*`

**Debug & Diagnostic Files:**

- `claude-debug*`, `claude-trace*`, `claude-profile*`, `claude-diagnostic*`
- `claude*.debug|trace|profile|diagnostic`

**Export & Archive Files:**

- `claude-export*`, `claude-archive*`, `claude-dump*`, `claude-snapshot*`

**IDE Integration Files:**

- Any files in `.vscode/`, `.idea/`, `.eclipse/` directories containing "claude"

**Directories:**

- `claude-workspace`, `claude-project`, `claude-sessions`, `claude-temp`, `claude-cache`, `claude-data`
- Paths containing `/.claude-` or `/claude_`

**Documentation Files:**

- `claude-notes*.md|txt|rst`, `claude-docs*.md|txt|rst`, `claude-readme*.md|txt|rst`
- `claude-instructions*.md|txt|rst`, `.claude-*.md|txt|rst`

**Scripts & Executables:**

- `claude-script*`, `claude-tool*`, `claude-utility*`, `claude-helper*`
- `claude*.sh|bat|ps1|py|js|ts`

**Hidden/Dotfiles:**

- `.claude` followed by alphanumeric characters (e.g., `.claude-config`, `.clauderc`)

**Numbered/Versioned Files:**

- Any file matching `claude*[0-9]*` or `claude*v[0-9]*`

> [!TIP]
> Patterns use wildcards (`*`) to match variations. For example, `claude-session*` matches `claude-session`, `claude-session-123`, `claude-session.json`, etc.

### Commit Trailers Removed

- **`🤖 Generated with [Claude Code](...)`** - Claude attribution trailers
- **`Co-Authored-By: Claude <noreply@anthropic.com>`** - Co-authorship attributions
- **Other Claude attribution lines** - Additional Claude-generated metadata

## Installation

### Prerequisites

> [!NOTE]
> The tool automatically installs all required dependencies via [mise](https://mise.jdx.dev/) when using the `--auto-install` flag. Manual installation is optional.

**Auto-installed dependencies:**

- Java (for BFG Repo-Cleaner)
- sd (modern sed replacement)

### Install Claude Cleaner

> [!TIP]
> For most users, downloading the pre-built binary is the fastest option.

```bash
# Option 1: Download pre-built binary (recommended)
# Download from GitHub releases page

# Option 2: Build from source (requires Deno)
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
claude-cleaner --auto-install

# 3. Execute cleaning (only after reviewing dry-run output)
claude-cleaner --execute --auto-install
```

> [!TIP]
> Run the dry-run command first to see exactly what will be changed before performing the actual cleaning.

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
  --repo-path <path>                Path to Git repository (default: current directory)
  --branch <branch>                 Specify branch to clean (default: HEAD)
  --include-all-common-patterns     Include ALL known common Claude patterns (for complete cleanup)
  --include-dirs <name>             Add directory name to remove (matches directories with this name anywhere)
  --include-dirs-file <file>        Read directory names from file (one pattern per line)
  --no-defaults                     Don't include default Claude patterns (use only explicit patterns)

Commands:
  check-deps                        Check if all required dependencies are available
```

### Basic Examples

```bash
# Preview changes (default behavior)
claude-cleaner --auto-install

# Execute cleaning after reviewing dry-run
claude-cleaner --execute --auto-install

# Clean specific repository
claude-cleaner --execute --auto-install --repo-path /path/to/repo

# Preview with verbose output
claude-cleaner --verbose

# Check what dependencies are needed
claude-cleaner check-deps
```

### Selective Cleaning

```bash
# Preview file removal only
claude-cleaner --files-only --auto-install

# Execute file removal only
claude-cleaner --files-only --execute --auto-install

# Preview commit message cleaning only
claude-cleaner --commits-only --auto-install

# Execute commit cleaning on specific branch
claude-cleaner --commits-only --execute --branch feature/my-branch --auto-install
```

### Comprehensive Cleaning

> [!TIP]
> Use `--include-all-common-patterns` for complete Claude artifact removal, especially for long-running projects or when preparing repositories for distribution.

```bash
# Preview comprehensive cleanup (recommended first)
claude-cleaner --include-all-common-patterns --verbose

# Execute complete cleanup - find ALL known Claude patterns
claude-cleaner --include-all-common-patterns --execute --auto-install

# Preview comprehensive file-only cleanup
claude-cleaner --include-all-common-patterns --files-only --verbose

# Execute comprehensive file-only cleanup (preserve commit history)
claude-cleaner --include-all-common-patterns --files-only --execute --auto-install
```

> [!WARNING]
> The `--include-all-common-patterns` flag finds many more files than standard mode. Always review the dry-run output first before using `--execute`.

### Advanced Workflows

> [!NOTE]
> These examples show advanced usage patterns for power users and troubleshooting scenarios.

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

> [!NOTE]
> Claude Cleaner follows a systematic, safety-first approach to ensure your repository integrity while removing Claude artifacts.

### Step-by-Step Process

1. **🔍 Dependency Check** - Verifies Java and sd are available (auto-installs via mise if needed)
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

> [!IMPORTANT]
> Claude Cleaner prioritizes safety with multiple protection mechanisms. However, always ensure your repository is backed up before running any cleaning operations.

### Automatic Backups

- **Automatic creation**: Backup branches created before any modifications
- **Naming format**: `backup/pre-claude-clean-YYYY-MM-DDTHH-MM-SS-sssZ`
- **Easy recovery**: `git checkout backup/...` to restore previous state

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

> [!NOTE]
> Most issues can be resolved by ensuring dependencies are installed and you're in a clean Git repository. Use `--verbose` for detailed error information.

### Common Issues

#### "Missing dependencies" error

> [!TIP]
> The `--auto-install` flag handles dependency installation automatically.

```bash
# Auto-install all dependencies (recommended)
claude-cleaner check-deps --auto-install

# Or install manually
mise install java@temurin-21 sd
```

#### "Not a Git repository" error

```bash
# Ensure you're in a Git repository
cd /path/to/your/git/repo
claude-cleaner --auto-install

# Or specify path explicitly
claude-cleaner --repo-path /path/to/git/repo --auto-install
```

#### "Working tree not clean" error

> [!WARNING]
> Commit or stash your changes before running the cleaner to avoid losing work.

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

> [!IMPORTANT]
> If something goes wrong or you need to undo changes, use these recovery steps.

```bash
# View available backups
git branch | grep backup/pre-claude-clean

# Restore from automatic backup
git checkout backup/pre-claude-clean-2024-01-15T10-30-00-000Z

# If you need to restore your main branch
git branch -f main backup/pre-claude-clean-2024-01-15T10-30-00-000Z
git checkout main

# Verify restoration
git log --oneline -10
```

> [!WARNING]
> After restoration, you may need to force push to remote repositories. See the Remote Repositories section below.

### Remote Repositories and Force Pushing

> [!CAUTION]
> Cleaning Git history rewrites commits, which requires force pushing to remote repositories. This affects all collaborators.

**Before cleaning a shared repository:**

1. **Coordinate with team**: Ensure all collaborators have pushed their work
2. **Create remote backup**: `git push origin main:backup-main`
3. **Clean locally**: Run claude-cleaner with `--execute`
4. **Force push carefully**: `git push --force-with-lease origin main`

> [!WARNING]
> Force pushing can disrupt team workflows. All collaborators must re-clone or reset their local repositories after you force push.

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
**A:** Yes! Claude Cleaner creates automatic backups and runs in dry-run mode by default. Always review the dry-run output before using `--execute`.

**Q: Can I undo the changes?**\
**A:** Yes, backup branches are created automatically. Use `git checkout backup/pre-claude-clean-...` to restore your repository.

**Q: What if something goes wrong during cleaning?**\
**A:** Stop the process and restore from the automatic backup branch. Check the troubleshooting section for specific error resolution.

### Performance and Compatibility

**Q: Does it work with large repositories?**\
**A:** Yes, BFG Repo-Cleaner is optimized for large repositories and is much faster than `git filter-branch`.

**Q: What operating systems are supported?**\
**A:** Windows, macOS, and Linux are all supported with cross-platform compatibility.

### Usage Options

**Q: What if I only want to remove files OR clean commits?**\
**A:** Use `--files-only` or `--commits-only` flags for selective cleaning operations.

**Q: Can I use it in CI/CD pipelines?**\
**A:** Yes, use `--auto-install` for dependency management and ensure proper permissions are configured.

## Performance Benchmarks

> [!NOTE]
> Performance depends on repository size, number of Claude artifacts, and system specifications. These are typical measurements on modern hardware.

| Repository Size                   | Typical Duration |
| --------------------------------- | ---------------- |
| **Small repos** (< 100 commits)   | < 10 seconds     |
| **Medium repos** (< 1000 commits) | < 30 seconds     |
| **Large repos** (> 1000 commits)  | < 2 minutes      |

## Development

See [DEV.md](DEV.md) for development setup, testing guidelines, and contribution instructions. For detailed pattern matching test documentation, see [tests/README-pattern-tests.md](tests/README-pattern-tests.md).

## Contributing

Contributions welcome! Please see [DEV.md](DEV.md) for development setup and contribution guidelines.

## Acknowledgments

- [BFG Repo-Cleaner](https://rtyley.github.io/bfg-repo-cleaner/) for efficient Git history cleaning
- [mise](https://mise.jdx.dev/) for development tool management
- [sd](https://github.com/chmln/sd) for modern text replacement
- [Deno](https://deno.land/) for the modern TypeScript runtime

## License

MIT License - see [LICENSE](LICENSE) file for details
