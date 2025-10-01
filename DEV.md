# Claude Cleaner Development Guide

This guide contains essential information for developers contributing to Claude Cleaner.

## Quick Start

```bash
# Clone and setup
git clone <repository>
cd claude-cleaner

# Development commands
deno run --allow-all src/main.ts --help    # Run locally
deno test --allow-all                      # Run tests
deno fmt                                   # Format code
deno lint                                  # Lint code
deno check src/main.ts                     # Type check

# Build standalone binary
deno compile --allow-all --output claude-cleaner src/main.ts
```

## Project Architecture

### Core Structure

- **main.ts**: CLI entry point using Cliffy framework
- **dependency-manager.ts**: Handles mise integration and external tool management
- **file-cleaner.ts**: File removal logic using BFG Repo-Cleaner
- **commit-cleaner.ts**: Commit message cleaning logic
- **utils.ts**: Shared utilities

### Dependencies

- **@cliffy/command**: Type-safe CLI framework for Deno
- **@cliffy/prompt**: Interactive prompts
- **dax**: Shell integration library for TypeScript

### External Tools (Auto-installed via mise)

- **BFG Repo-Cleaner**: Fast Git history cleaning (Java JAR)
- **sd**: Modern sed replacement for text processing
- **Java**: Required for BFG Repo-Cleaner

## Development Workflow

### Two-Phase Cleaning Process

1. **File Removal**: Uses BFG to completely remove Claude files from Git history
2. **Commit Cleaning**: Uses git filter-branch + sd to clean commit messages and trailers

### What Gets Cleaned

- Files: `CLAUDE.md`, `.claude/` directories, `claudedocs/` directories, `.serena/` directories, `.vscode/claude.json`, temporary Claude files
- Commit trailers: `🤖 Generated with [Claude Code](...)`, `Co-Authored-By: Claude <...>`

## Testing

> [!NOTE]
> See [tests/README.md](tests/README.md) for comprehensive test documentation including pattern matching tests, test utilities, and development guidelines.

### Quick Test Commands

```bash
# All tests
deno test --allow-all

# Specific categories
deno task test:unit
deno task test:integration
deno task test:verbose

# Single test file
deno test --allow-all tests/unit/dependency-manager.test.ts
```

### Test Coverage Highlights

- **41 test steps** for directory pattern matching
- Unit tests for all core modules
- Integration tests for full workflows
- Cross-platform compatibility tests
- Pattern validation and safety tests

For detailed information on test structure, utilities, and development guidelines, see [tests/README.md](tests/README.md).

## Troubleshooting

### External Tool Issues

```bash
# Check tool availability
which java && which sd
ls ~/.cache/claude-cleaner/

# Test tools independently
java -version
sd --version
java -jar ~/.cache/claude-cleaner/bfg*.jar --version
```

**Common fixes:**

- Missing Java: `mise install java@temurin-21`
- Missing sd: `mise install sd`
- Corrupted BFG JAR: Delete and re-download
- Permission issues: Check file permissions

### Cross-Platform Issues

- Use Deno's `path` module for path separators
- Use dax for cross-platform commands
- Test on multiple operating systems

### Performance Issues

- Add progress reporting for large repositories
- Add timeouts to prevent hanging
- Monitor memory usage with `--inspect`
- Close file handles and clean up temp files

### CLI Issues

```typescript
// Debug CLI arguments
console.log("Args received:", Deno.args);
console.log("Parsed options:", options);
```

### Git Repository Issues

```bash
# Check repository status
git status && git log --oneline -5
ls -la .git/

# Verify backup creation
try {
  await Deno.copyFile("repo/.git", "backup/.git");
} catch (error) {
  if (error instanceof Deno.errors.PermissionDenied) {
    console.error("Permission denied creating backup");
  }
}
```

## Code Standards

### TypeScript Configuration

- Strict TypeScript settings enabled
- Comprehensive compiler options for reliability
- 2-space indentation, 100-character line width

### Safety Features

- Dry-run mode by default (use `--execute` to apply changes)
- Automatic backup creation before operations
- Exact basename pattern matching for file safety
- Cross-platform path handling
- Comprehensive error handling

### Writing Tests

```typescript
Deno.test("Module - Feature", async (t) => {
  await t.step("should test behavior", async () => {
    const repo = await createTestRepo("test-name");

    try {
      const result = await functionUnderTest(repo.path);
      assert(result.success);
    } finally {
      await repo.cleanup();
    }
  });
});
```

## Contributing Guidelines

1. **Run tests**: Ensure all tests pass before submitting
2. **Format code**: Use `deno fmt` for consistent formatting
3. **Type check**: Run `deno check src/main.ts` to verify types
4. **Cross-platform**: Test on multiple operating systems when possible
5. **Documentation**: Update [README.md](README.md), [CLAUDE.md](CLAUDE.md), and this guide when adding new features
6. **Clean up**: Always clean up temporary files in tests

## Related Documentation

- [README.md](README.md) - User-facing documentation and usage examples
- [CLAUDE.md](CLAUDE.md) - Development guidance for Claude Code
- [tests/README.md](tests/README.md) - Comprehensive test documentation

## Dependency Management

The tool uses mise for managing external dependencies and downloads BFG JAR manually. All dependency installation is automated with the `--auto-install` flag.

Dependencies are cached in `~/.cache/claude-cleaner/` and validated before use.

## Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) with [conventional commits](https://www.conventionalcommits.org/) for automated versioning and releases.

### Conventional Commit Format

All commits must follow the conventional commit format:

- `feat: description` - New features (minor version bump)
- `fix: description` - Bug fixes (patch version bump)
- `feat!: description` or `BREAKING CHANGE:` - Breaking changes (major version bump in 1.x+, minor in 0.x)
- `chore:`, `docs:`, `test:`, `refactor:` - No release (maintenance commits)

**Examples:**

```bash
# Patch release (0.2.0 → 0.2.1)
git commit -m "fix: handle symlinks correctly in directory scanning"

# Minor release (0.2.0 → 0.3.0)
git commit -m "feat: add interactive mode for file selection"

# Breaking change in pre-1.0 (0.2.0 → 0.3.0)
git commit -m "feat!: rename --all flag to --include-all

BREAKING CHANGE: The --all flag has been renamed to --include-all for clarity"

# No release
git commit -m "docs: improve README examples"
git commit -m "chore: update dependencies"
```

### Creating a Release

1. **Ensure all commits** since last release follow conventional commit format

2. **Preview the release** (recommended):
   - Go to [Actions → Release](../../actions/workflows/release.yml)
   - Click "Run workflow"
   - Check "Dry run" checkbox
   - Click "Run workflow" button
   - Review the logs to see what version would be released

3. **Create the release**:
   - Go to [Actions → Release](../../actions/workflows/release.yml)
   - Click "Run workflow"
   - Leave "Dry run" unchecked
   - Click "Run workflow" button

4. **semantic-release will automatically**:
   - Analyze commits to determine version bump
   - Update `deno.json` with new version
   - Generate/update `CHANGELOG.md`
   - Publish package to [JSR](https://jsr.io/@tylerbu/claude-cleaner)
   - Create [GitHub release](../../releases) with binaries for all platforms
   - Commit `CHANGELOG.md` and `deno.json` back to the repository
   - Create git tag for the release

### What Gets Released

- **Linux**: x86_64, aarch64
- **macOS**: x86_64 (Intel), aarch64 (Apple Silicon)
- **Windows**: x86_64

All binaries are attached to the GitHub release and the package is published to JSR.

### Release Configuration

The release process is configured via:

- `.releaserc.json` - semantic-release plugin configuration
- `package.json` - npm dependencies for semantic-release
- `.github/workflows/release.yml` - GitHub Actions workflow
