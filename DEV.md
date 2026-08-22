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
- **dependency-manager.ts**: Validates that Git (the only external dependency) is available
- **file-cleaner.ts**: File removal logic using `git filter-branch` (self-invoked `--index-filter`)
- **commit-cleaner.ts**: Commit message cleaning logic (self-invoked `--msg-filter`)
- **internal-filter.ts**: Self-invocation seam used as the `git filter-branch` filter
- **utils.ts**: Shared utilities

### Dependencies

- **@cliffy/command**: Type-safe CLI framework for Deno
- **@cliffy/prompt**: Interactive prompts
- **dax**: Shell integration library for TypeScript

### External Tools

- **Git**: the only external runtime dependency. History rewriting is performed
  entirely by Git plus this tool's own self-invoked filters — no Java, BFG,
  `sd`, or mise runtime is required.

## Development Workflow

### Two-Phase Cleaning Process

1. **File Removal**: Uses `git filter-branch` to remove Claude files from Git history (repository-wide)
2. **Commit Cleaning**: Uses `git filter-branch --msg-filter` to clean commit messages and trailers (scoped to the target ref)

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
# Check tool availability (Git is the only runtime dependency)
which git

# Test it independently
git --version

# Or use the built-in check
deno run --allow-all src/main.ts check-deps
```

**Common fixes:**

- Missing Git: install Git and ensure it is on your `PATH`
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

The tool requires only **Git** at runtime and does not install anything. Git
availability is validated up front (see `dependency-manager.ts` and
`claude-cleaner check-deps`). The `--auto-install` flag is a deprecated no-op
kept for backward compatibility.

## Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) with [conventional commits](https://www.conventionalcommits.org/) for automated versioning and releases.

### Conventional Commit Format

All commits and **PR titles** must follow the [Conventional Commits specification](https://www.conventionalcommits.org/).

**Quick Reference:**

- `feat: description` - New features (minor version bump)
- `fix: description` - Bug fixes (patch version bump)
- `feat!: description` or `BREAKING CHANGE:` - Breaking changes (major version bump in 1.x+, minor in 0.x)
- `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `ci:`, `build:` - No release (maintenance commits)

**Format:** `type(optional-scope): description`

**Learn More:**

- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Semantic Release: Commit Message Format](https://semantic-release.gitbook.io/semantic-release/#commit-message-format)
- [Angular Commit Guidelines](https://github.com/angular/angular/blob/main/CONTRIBUTING.md#commit) (basis for conventional commits)

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

> **Note**: PR titles are validated automatically by the [PR Title Check workflow](../.github/workflows/pr-title-check.yml). When using squash merging (recommended), the PR title becomes the commit message.

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

- `release.config.mjs` - semantic-release plugin configuration
- `package.json` - npm dependencies for semantic-release
- `.github/workflows/release.yml` - GitHub Actions workflow

### Troubleshooting Releases

#### Failed Release Mid-Process

If semantic-release fails partway through:

1. **Check what completed**: Look at GitHub Actions logs to see which plugins ran
2. **Verify git state**: Check if commits/tags were created
   ```bash
   git log --oneline -5
   git tag -l
   ```
3. **Verify JSR publish**: Check [JSR package page](https://jsr.io/@tylerbu/claude-cleaner)
4. **Verify GitHub release**: Check [GitHub releases](../../releases)

**Recovery steps:**

```bash
# If commits were made but release failed
git log --oneline -3  # Check recent commits
git revert HEAD       # Revert the version bump commit if needed

# If tag was created but release failed
git tag -d v0.3.0     # Delete local tag
git push origin :refs/tags/v0.3.0  # Delete remote tag

# Re-run the release workflow after fixing issues
```

#### Version Conflicts

If the calculated version already exists:

1. Check if the release was partially completed
2. Look for duplicate tags: `git tag -l`
3. If tag exists but no release, delete tag and re-run
4. If release exists, commits since then weren't release-worthy (only chore/docs)

#### JSR Authentication Issues

The workflow uses GitHub OIDC for JSR authentication via `id-token: write` permission.

**If JSR publish fails:**

1. Verify workflow permissions in `.github/workflows/release.yml`
2. Check that `id-token: write` is present
3. Review semantic-release-jsr plugin logs for auth errors
4. Ensure JSR account is linked to GitHub organization

**Common causes:**

- OIDC token expired (very rare, GitHub handles refresh)
- JSR service outage (check [JSR status](https://status.jsr.io))
- Package name mismatch between `deno.json` and JSR

#### Build Failures

If binary compilation fails:

```bash
# Test locally first
deno compile --allow-all --target x86_64-unknown-linux-gnu --output test-binary src/main.ts
./test-binary --version

# Check Deno version compatibility
deno --version
```

**Common issues:**

- Deno version mismatch (workflow uses `v2.x`)
- Platform-specific compilation errors
- Missing source files or dependencies

#### Dry-Run Issues

If dry-run mode doesn't work as expected:

```bash
# Test semantic-release locally
npx semantic-release --dry-run

# Check configuration
cat release.config.mjs

# Verify conventional commits
git log --oneline -10
```

#### Botched Release Recovery

If a release goes out with wrong version or broken binaries:

1. **Yanking from JSR** (if needed):
   ```bash
   # JSR doesn't support yanking, but you can publish a patch
   # Bump to next patch version immediately
   ```

2. **Delete GitHub release** (if needed):
   - Go to [Releases](../../releases)
   - Click release → Delete release
   - Delete associated tag

3. **Fix and re-release**:
   - Make fix commits
   - Re-run release workflow
   - New version will be published
