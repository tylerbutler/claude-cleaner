# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claude Cleaner is a TypeScript/Deno tool that removes Claude artifacts (files and commit trailers) from Git repositories. It uses BFG Repo-Cleaner for file removal and git filter-branch with sd for commit message cleaning.

## Essential Commands

### Development

```bash
# Run the tool locally
deno run --allow-all src/main.ts --help
deno run --allow-all src/main.ts check-deps
deno run --allow-all src/main.ts --verbose  # Dry-run mode (default)

# Type checking and linting
deno check                       # Type check
deno fmt                         # Format code
deno lint                        # Lint code
```

### Testing

```bash
# Run all tests
deno test --allow-all
deno task test

# Run specific test suites
deno task test:unit              # Unit tests only
deno task test:integration       # Integration tests only
deno task test:verbose           # All tests with verbose output

# Run specific test file
deno test --allow-all tests/unit/file-cleaner.test.ts
```

### Building

```bash
# Compile to standalone binary
deno task build
# or
deno compile --allow-all --output claude-cleaner src/main.ts
```

## Architecture

### Core Modules

**Entry Point (`main.ts`)**:

- CLI interface using Cliffy framework
- Command: `claude-cleaner [options]` and `claude-cleaner check-deps`
- Three modes: `--files-only`, `--commits-only`, or full cleaning (both)
- Dry-run by default; requires `--execute` flag to apply changes

**Dependency Manager (`dependency-manager.ts`)**:

- Auto-installs external tools via mise if `--auto-install` flag is used
- Manages: Java (for BFG), sd (text processor), BFG Repo-Cleaner JAR
- Cache directory: `~/.cache/claude-cleaner/`
- Key methods: `checkAllDependencies()`, `installAllDependencies()`

**File Cleaner (`file-cleaner.ts`)**:

- Pattern-based file detection: exact basename matching (safe mode)
- Standard patterns: `CLAUDE.md`, `.claude/`, `claudedocs/`, `.serena/`, `.vscode/claude.json`
- Extended patterns: Available via `--include-all-common-patterns` flag
- Uses BFG Repo-Cleaner for efficient Git history rewriting
- Key methods: `detectClaudeFiles()`, `cleanFiles()`, `validateRepository()`

**Commit Cleaner (`commit-cleaner.ts`)**:

- Removes Claude trailers from commit messages
- Patterns: `🤖 Generated with [Claude Code]`, `Co-Authored-By: Claude <...>`
- Uses git filter-branch with sd for text replacement
- Key methods: `cleanCommits()`, `createBackup()`, `validateGitRepository()`

### Pattern System

**Standard Mode**: Exact basename matching for safety

- `CLAUDE.md` matches only files named exactly `CLAUDE.md`
- `.claude/` matches only directories named exactly `.claude`

**Extended Mode** (`--include-all-common-patterns`): Comprehensive pattern matching

- Config files: `.claude-*.json`, `claude-config.*`
- Session files: `.claude-session`, `claude-state.*`
- Temporary files: `.claude-temp`, `claude-work.*`
- See `PATTERNS.md` for complete list

### Safety Features

1. **Dry-run by default**: No changes without `--execute` flag
2. **Automatic backups**: Creates `backup/pre-claude-clean-YYYY-MM-DDTHH-MM-SS-sssZ` branches
3. **Working tree validation**: Requires clean working tree before execution
4. **Pattern validation**: Safe exact-match patterns in standard mode

## Key Implementation Details

### File Cleaning Process

1. Scan repository for Claude files using pattern matching
2. Validate Git repository structure
3. Create backup branch (if `--execute`)
4. Generate BFG blob-removal script from detected files
5. Run BFG Repo-Cleaner to remove files from Git history
6. Run `git reflog expire --expire=now --all && git gc --prune=now --aggressive`

### Commit Cleaning Process

1. Analyze commit history for Claude trailers
2. Create backup branch (if `--execute`)
3. Generate git filter-branch command with sd replacements
4. Apply sd patterns to remove each trailer type
5. Verify changes and clean up backup refs

### Pattern Matching Logic (`file-cleaner.ts`)

- Directory patterns: Exact basename match anywhere in repository
- File patterns: Exact filename match (standard) or regex match (extended)
- Pattern definition format: `{ pattern: RegExp, reason: string }`

## Testing Strategy

### Test Organization

- **Unit tests** (`tests/unit/`): Module-level testing without Git operations
- **Integration tests** (`tests/integration/`): Full workflow tests with real Git repositories
- **Test utilities** (`tests/utils/`): Fixtures and helpers for test setup

### Key Test Coverage

- Pattern matching: 41 test steps covering all directory patterns
- Dry-run mode: Ensures no changes are made without `--execute`
- Dependency management: Auto-install, version checking, path resolution
- Error handling: Invalid options, missing dependencies, dirty working tree
- Cross-platform: Windows, macOS, Linux compatibility tests

### Test Fixtures

- Located in `tests/fixtures/`
- Git repositories created programmatically for each test
- Cleaned up automatically after test completion

## Common Development Tasks

### Adding New Claude Patterns

1. **Standard patterns** (always included): Add to `STANDARD_CLAUDE_FILES` or `STANDARD_CLAUDE_DIRS` in `file-cleaner.ts`
2. **Extended patterns** (optional): Add to `EXTENDED_CLAUDE_PATTERNS` in `file-cleaner.ts`
3. Update pattern documentation in `PATTERNS.md`
4. Add test cases in `tests/unit/pattern-validation.test.ts` or `tests/integration/pattern-matching.test.ts`

### Modifying Commit Trailer Patterns

1. Edit `claudeTrailerPatterns` array in `commit-cleaner.ts`
2. Add test cases in `tests/unit/commit-cleaner.test.ts`
3. Ensure patterns use proper regex escaping for `sd` tool

### Testing New Features

1. Add unit tests first (TDD approach recommended)
2. Run specific test file during development
3. Add integration tests for full workflow validation
4. Run all tests before committing: `deno test --allow-all`

## Dependencies and External Tools

**Runtime Dependencies** (JSR packages):

- `@cliffy/command` and `@cliffy/prompt`: CLI framework
- `dax`: Shell integration for TypeScript
- `@std/path`, `@std/fs`, `@std/assert`, etc.: Deno standard library

**External Tools** (auto-installed via mise):

- BFG Repo-Cleaner 1.14.0 (Java JAR): Git history cleaning
- sd: Modern sed replacement for Unicode-safe text processing
- Java (Temurin 21): Required for BFG Repo-Cleaner

**Development Tools**:

- Deno 1.x: TypeScript runtime and toolchain
- mise: Development tool version management

## TypeScript Configuration

Strict compiler options enabled in `deno.json`:

- `strict: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitReturns: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedIndexedAccess: true`
- `noImplicitOverride: true`
- `verbatimModuleSyntax: true`

## Error Handling

Custom `AppError` class in `utils.ts` with error codes:

- `NOT_GIT_REPO`: Invalid Git repository
- `INVALID_OPTIONS`: Conflicting CLI options
- `WORKING_TREE_DIRTY`: Uncommitted changes present
- `SD_NOT_AVAILABLE`: sd tool not found
- `BFG_NOT_AVAILABLE`: BFG Repo-Cleaner not found
- `DEPENDENCY_CHECK_FAILED`: Dependency validation failed
