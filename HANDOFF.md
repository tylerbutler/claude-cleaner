# Test Corruption Fix Handoff Document

**Date**: 2025-09-30
**Status**: Partially complete - core fix implemented, remaining test updates needed
**Repository**: `/home/tylerbu/code/claude-workspace/claude-cleaner`
**Branch**: `main` (HEAD: `ce6ae60`)

## Executive Summary

Fixed critical bug where integration tests were corrupting the actual repository by running `--execute` mode on `Deno.cwd()` instead of test fixtures. Solution: Made repository path a **required positional argument** (breaking change).

**Current State**:

- ✅ Core fix implemented in `src/main.ts`
- ✅ One test file fully fixed (`all-common-patterns-cli.test.ts`)
- ⚠️ One test file partially fixed (`cli-options.test.ts`)
- 🔴 Documentation not yet updated
- 🔴 Version not yet bumped

---

## Problem Analysis

### What Happened

Integration tests in `tests/integration/cli-options.test.ts` and `tests/integration/all-common-patterns-cli.test.ts` were running CLI commands without specifying `--repo-path`, causing them to default to `Deno.cwd()` (the actual project directory).

When tests ran in `--execute` mode, they operated on the **real repository**:

- Created backup branches: `backup/pre-claude-clean-2025-09-10T22-*`
- Rewrote Git history with BFG Repo-Cleaner
- Changed commit hashes
- Potentially deleted Claude-related files from the actual project

### Evidence

```bash
# Backup branches created by tests (corruption evidence)
$ git branch | grep backup
  backup/pre-claude-clean-2025-09-10T22-01-51-000Z
  backup/pre-claude-clean-2025-09-10T22-01-53-000Z
  backup/pre-claude-clean-2025-09-10T22-01-55-000Z

# Different commit hashes after test runs
$ git log --oneline -1
ce6ae60 (HEAD -> main, origin/main) fix: Make repository path a required positional argument
```

### Root Cause

The CLI accepted `--repo-path` as an **optional** flag that defaulted to `Deno.cwd()`. Tests that didn't specify this flag accidentally operated on the real repository.

---

## Solution Implemented

### Breaking Change: Required Positional Argument

Changed the CLI interface to require an explicit repository path:

**Before** (optional flag):

```bash
claude-cleaner --repo-path . --files-only    # Explicit path
claude-cleaner --files-only                  # Defaults to CWD (DANGEROUS!)
```

**After** (required positional):

```bash
claude-cleaner . --files-only                # Required path
claude-cleaner --files-only                  # ERROR: REPO_PATH_REQUIRED
```

### Code Changes

#### `src/main.ts`

**1. Updated `cleanAction()` signature** (lines 78-91):

```typescript
async function cleanAction(
  { execute, verbose, filesOnly, commitsOnly, autoInstall, includeAllCommonPatterns }: CleanOptions,
  repoPath?: string, // NEW: positional argument
): Promise<void> {
  // NEW: Require explicit repo path
  if (!repoPath) {
    throw new AppError(
      "Repository path is required as a positional argument.\n" +
        "  Usage: claude-cleaner <path> [options]\n" +
        "  Example: claude-cleaner . --files-only\n" +
        "  Example: claude-cleaner /path/to/repo --execute",
      "REPO_PATH_REQUIRED",
    );
  }
  // ... rest of function
}
```

**2. Added positional argument to command** (line 431):

```typescript
await new Command()
  .name("claude-cleaner")
  .version("0.1.0")
  .description("Remove Claude artifacts from Git repositories")
  .arguments("[repo-path:string]") // NEW: positional argument
  .option("--execute", "Actually perform the cleaning (dry-run by default)")
  // ... other options
  .action(cleanAction)
  .parse(Deno.args);
```

**3. Removed old `--repo-path` option**:

```typescript
// REMOVED:
// .option("--repo-path <path:string>", "Path to repository (defaults to current directory)")
```

**4. Added new error code** to `src/utils.ts`:

```typescript
export type ErrorCode =
  | "NOT_GIT_REPO"
  | "INVALID_OPTIONS"
  | "WORKING_TREE_DIRTY"
  | "SD_NOT_AVAILABLE"
  | "BFG_NOT_AVAILABLE"
  | "DEPENDENCY_CHECK_FAILED"
  | "REPO_PATH_REQUIRED"; // NEW
```

### Test File Updates

#### ✅ `tests/integration/all-common-patterns-cli.test.ts` - FULLY FIXED

**Changes made**:

1. Removed `cwd` parameter from `runClaude()` helper function
2. Changed all `--repo-path` flags to positional arguments
3. All 6 tests now pass

**Before**:

```typescript
async function runClaude(args: string[], cwd?: string): Promise<CommandResult> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    cwd: cwd || Deno.cwd(), // PROBLEM: defaults to real directory
  });
}

// Test invocations
const dryRunResult = await runClaude(["--repo-path", repoPath, "--files-only"]);
const executeResult = await runClaude(["--repo-path", repoPath, "--files-only", "--execute"]);
```

**After**:

```typescript
async function runClaude(args: string[]): Promise<CommandResult> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", "src/main.ts", ...args],
    cwd: Deno.cwd(), // Safe: always runs in project directory, repo path is explicit
  });
}

// Test invocations
const dryRunResult = await runClaude([repoPath, "--files-only"]);
const executeResult = await runClaude([repoPath, "--files-only", "--execute"]);
```

**Test results**:

```bash
$ deno test --allow-all tests/integration/all-common-patterns-cli.test.ts
✅ all tests passed (6 passed) in 8s
```

#### ⚠️ `tests/integration/cli-options.test.ts` - PARTIALLY FIXED

**Status**: 16 total tests, ~13 failing

**Changes made**:

- Added `"."` as positional argument to most test invocations
- Example: `runClaude([".", "--files-only"])` instead of `runClaude(["--files-only"])`

**Remaining issues**:

1. Some tests don't create test repositories (they test CLI behavior)
2. Need to decide: test error validation OR create test repos for each test
3. Tests that validate `--help`, `check-deps`, etc. don't need repos

**Recommended approach**:

```typescript
// Option A: Test error validation (for tests that don't need repos)
Deno.test("missing repo path shows error", async () => {
  const result = await runClaude(["--files-only"]);
  assertStringIncludes(result.stderr, "REPO_PATH_REQUIRED");
  assertStringIncludes(result.stderr, "Usage: claude-cleaner <path>");
  assertEquals(result.code, 1);
});

// Option B: Create test repo (for integration tests)
Deno.test("files only mode", async () => {
  const testRepo = await createTestGitRepo();
  try {
    const result = await runClaude([testRepo.path, "--files-only"]);
    assertEquals(result.code, 0);
  } finally {
    await cleanup(testRepo);
  }
});
```

---

## What Needs To Be Done

### Priority 1: Fix Remaining Tests

#### Task 1.1: Audit all tests in `cli-options.test.ts`

For each failing test, determine:

- **Validation test**: Does it test CLI argument validation?
  - → Update to expect `REPO_PATH_REQUIRED` error
- **Integration test**: Does it test actual cleaning functionality?
  - → Create test repo and pass path as positional argument

#### Task 1.2: Create test fixture helper (if needed)

```typescript
// tests/utils/test-repo.ts
export async function createMinimalTestRepo(): Promise<
  { path: string; cleanup: () => Promise<void> }
> {
  const tempDir = await Deno.makeTempDir({ prefix: "claude-cleaner-test-" });

  // Initialize git repo
  await $`git init`.cwd(tempDir);
  await $`git config user.name "Test User"`.cwd(tempDir);
  await $`git config user.email "test@example.com"`.cwd(tempDir);

  // Create initial commit
  await Deno.writeTextFile(`${tempDir}/README.md`, "test repo");
  await $`git add .`.cwd(tempDir);
  await $`git commit -m "Initial commit"`.cwd(tempDir);

  return {
    path: tempDir,
    cleanup: async () => {
      await Deno.remove(tempDir, { recursive: true });
    },
  };
}
```

#### Task 1.3: Search for other `--repo-path` usage

```bash
# Find all remaining uses of old flag
grep -r "repo-path" tests/ --include="*.test.ts"
grep -r "repo-path" src/ --include="*.ts"
```

### Priority 2: Update Documentation

#### Task 2.1: Update README.md

**Sections to update**:

1. **Installation** - show new syntax
2. **Usage Examples** - all examples need positional path
3. **Options** - remove `--repo-path`, add positional argument docs

**Example changes**:

````markdown
## Usage

<!-- BEFORE -->

```bash
# Dry-run (default)
claude-cleaner --repo-path /path/to/repo

# Execute cleaning
claude-cleaner --repo-path /path/to/repo --execute
```
````

<!-- AFTER -->

```bash
# Dry-run (default)
claude-cleaner /path/to/repo

# Execute cleaning
claude-cleaner /path/to/repo --execute

# Clean current directory
claude-cleaner .
```

#### Task 2.2: Update help output verification

The help output is generated automatically from Cliffy, but should verify it's correct:

```bash
deno run --allow-all src/main.ts --help
# Should show: Usage: claude-cleaner <repo-path> [options]
```

#### Task 2.3: Create migration guide

Add to README.md:

````markdown
## Migration from v0.1.x to v0.2.0

**Breaking change**: Repository path is now a required positional argument.

**Before**:

```bash
claude-cleaner --files-only                        # Used current directory
claude-cleaner --repo-path /path/to/repo --execute
```
````

**After**:

```bash
claude-cleaner . --files-only                      # Explicit current directory
claude-cleaner /path/to/repo --execute
```

````
### Priority 3: Version Management

#### Task 3.1: Decide on version bump

**Options**:
- `0.2.0` - Minor version bump (breaking change in pre-1.0)
- `1.0.0` - Major version (if considering this stable)

**Recommendation**: `0.2.0` (still in development, not ready for 1.0)

#### Task 3.2: Update version in code

```typescript
// src/main.ts
await new Command()
  .name("claude-cleaner")
  .version("0.2.0") // UPDATE THIS
  .description("Remove Claude artifacts from Git repositories")
````

#### Task 3.3: Create git tag (after all fixes)

```bash
git tag -a v0.2.0 -m "Breaking change: Require explicit repository path"
git push origin v0.2.0
```

### Priority 4: Cleanup

#### Task 4.1: Delete old backup branches

```bash
# List backup branches
git branch | grep backup

# Delete them
git branch -D backup/pre-claude-clean-2025-09-10T22-01-51-000Z
git branch -D backup/pre-claude-clean-2025-09-10T22-01-53-000Z
git branch -D backup/pre-claude-clean-2025-09-10T22-01-55-000Z
```

#### Task 4.2: Add backup refs to .gitignore

```bash
# .gitignore
.git/refs/backup/
```

#### Task 4.3: Verify repository integrity

```bash
# Check commit history
git log --oneline -10

# Verify working tree
git status

# Run all tests
deno test --allow-all
```

---

## Testing Checklist

### Before Committing

- [ ] All unit tests pass: `deno test --allow-all tests/unit/`
- [ ] All integration tests pass: `deno test --allow-all tests/integration/`
- [ ] Type checking passes: `deno check src/main.ts`
- [ ] Linting passes: `deno lint`
- [ ] Formatting passes: `deno fmt --check`

### Manual Testing

- [ ] Help output shows new syntax: `deno run --allow-all src/main.ts --help`
- [ ] Missing path shows error: `deno run --allow-all src/main.ts --files-only`
- [ ] Current directory works: `deno run --allow-all src/main.ts .` (in test repo!)
- [ ] Absolute path works: `deno run --allow-all src/main.ts /tmp/test-repo`
- [ ] Execute mode creates backup: (test in disposable repo only!)

### Regression Testing

- [ ] `check-deps` still works: `deno run --allow-all src/main.ts check-deps`
- [ ] Auto-install still works: `claude-cleaner . --auto-install`
- [ ] All modes still work: `--files-only`, `--commits-only`, combined
- [ ] Verbose output still works: `claude-cleaner . --verbose`

---

## Prevention Analysis

### Why This Solution Works

**Root cause**: Tests could accidentally operate on wrong directory
**Solution**: Make directory explicit and required
**Prevention**: Impossible to forget which directory you're targeting

**Advantages**:

1. **Explicit is better than implicit**: No more dangerous defaults
2. **Fail-safe**: Missing path = error, not silent operation on CWD
3. **Clear intent**: `claude-cleaner .` vs `claude-cleaner` shows deliberate choice
4. **Intuitive**: Follows common CLI patterns (e.g., `cd`, `ls`, `git -C`)

### Alternative Approaches (Rejected)

**A. Interactive confirmation for CWD**:

- ❌ Breaks automation/CI
- ❌ Easy to accidentally confirm
- ❌ Still allows mistake, just adds friction

**B. Environment variable gate**:

- ❌ Hidden state, not obvious from command
- ❌ Easy to forget to set/unset
- ❌ Environment pollution

**C. Test-specific safety check**:

- ❌ Doesn't help users, only developers
- ❌ Fragile (detection can be bypassed)
- ❌ Doesn't prevent user mistakes

**D. Dry-run enforcement without path**:

- ❌ Still allows read operations on wrong directory
- ❌ Confusing UX (why does this flag change defaults?)

**E. Git worktree check**:

- ❌ False positives (main worktree is valid)
- ❌ Doesn't prevent mistakes in all cases

**F. Backup branch verification**:

- ❌ Too late (damage already done)
- ❌ Only catches Git operations, not file scans

**Chosen solution is the strongest**: Prevents the entire class of "wrong directory" bugs.

---

## Repository Context

### File Locations

**Modified files** (not yet committed):

- `src/main.ts` - Core fix implementation
- `src/utils.ts` - New error code
- `tests/integration/all-common-patterns-cli.test.ts` - Fully fixed
- `tests/integration/cli-options.test.ts` - Partially fixed

**Files to update**:

- `README.md` - Usage documentation
- `deno.json` - Version bump (optional, uses src/main.ts version)
- Tests: Any remaining files with `--repo-path` usage

**Test repositories**:

- Tests create: `/tmp/claude-cleaner-test-*`
- Tests create: `/tmp/claude-cleaner-cli-test-*`
- Cleanup: Automatic in `finally` blocks

### Git State

**Current branch**: `main`
**HEAD commit**: `ce6ae60` - "fix: Make repository path a required positional argument"
**Origin status**: Up to date
**Working tree**: Modified (uncommitted changes listed above)

**Backup branches** (to delete):

```
backup/pre-claude-clean-2025-09-10T22-01-51-000Z
backup/pre-claude-clean-2025-09-10T22-01-53-000Z
backup/pre-claude-clean-2025-09-10T22-01-55-000Z
```

### Development Environment

**Runtime**: Deno 1.x
**TypeScript**: Strict mode enabled
**CLI Framework**: Cliffy (@cliffy/command)
**Test Framework**: Deno built-in test runner
**Shell Integration**: dax (for running external commands)

**Key dependencies** (JSR):

- `@cliffy/command@^1.0.0-rc.7` - CLI framework
- `@cliffy/prompt@^1.0.0-rc.7` - Interactive prompts
- `dax@^0.42.0` - Shell integration
- `@std/*` - Deno standard library

**External tools** (auto-installed):

- BFG Repo-Cleaner 1.14.0 (Java JAR)
- sd (modern sed replacement)
- Java (Temurin 21, for BFG)

---

## Common Commands

### Development

```bash
# Run the tool (in test repo!)
deno run --allow-all src/main.ts /tmp/test-repo --files-only

# Type checking
deno check src/main.ts

# Linting
deno lint

# Formatting
deno fmt
```

### Testing

```bash
# All tests
deno test --allow-all

# Specific suite
deno test --allow-all tests/unit/
deno test --allow-all tests/integration/

# Specific file
deno test --allow-all tests/integration/all-common-patterns-cli.test.ts

# Verbose output
deno test --allow-all --reporter=verbose

# Watch mode
deno test --allow-all --watch
```

### Building

```bash
# Compile to binary
deno task build
# or
deno compile --allow-all --output claude-cleaner src/main.ts

# Test binary
./claude-cleaner --help
./claude-cleaner /tmp/test-repo --files-only
```

### Git Operations

```bash
# Check status
git status

# View recent commits
git log --oneline -10

# Delete backup branches
git branch -D backup/pre-claude-clean-*

# Restore if needed
git reset --hard origin/main

# Search codebase
grep -r "repo-path" tests/ src/
```

---

## Key Insights from Debugging Session

### What We Learned

1. **Test isolation is critical**: Always run tests against fixtures, never the real repo
2. **Defaults are dangerous**: Implicit `Deno.cwd()` caused the entire issue
3. **Positional arguments > flags**: For required values, positional is clearer
4. **Evidence-based debugging**: Backup branches revealed the problem immediately
5. **Breaking changes are okay**: Better to break early than ship dangerous defaults

### Debugging Process Used

1. **Observed anomalies**: Backup branches appearing after test runs
2. **Traced execution**: Found tests calling CLI without `--repo-path`
3. **Identified root cause**: Optional flag defaulting to `Deno.cwd()`
4. **Evaluated solutions**: Considered 7+ approaches, chose strongest
5. **Implemented fix**: Made path required, updated tests systematically
6. **Verified solution**: All-common-patterns tests pass, partial fix for cli-options

### Prevention Strategies Implemented

**Primary**: Required positional argument (prevents wrong directory)
**Secondary**: Test fixtures (prevents operating on real repo)
**Tertiary**: Dry-run by default (prevents accidental execution)

### Future Considerations

**Potential enhancements** (not blocking):

- Add `--assume-cwd` flag for opt-in CWD usage
- Add repository validation (check `.git` exists before operations)
- Add git remote check (warn if pushing to remote)
- Consider making `check-deps` not require repo path
- Add pre-flight checks (uncommitted changes, remote tracking)

---

## Session Information

**Date**: 2025-09-30
**Working Directory**: `/home/tylerbu/code/claude-workspace/claude-cleaner`
**Git Branch**: `main`
**Commit**: `ce6ae60`
**Deno Version**: 1.x (exact version from runtime)
**Platform**: Linux (6.8.0-79-generic)

**Related conversations**:

- Root cause analysis and solution design
- Test file updates and refactoring
- Prevention strategy evaluation
- Documentation planning

---

## Success Criteria

The fix is complete when:

✅ **Core implementation**:

- [x] Repository path is required positional argument
- [x] Missing path throws `REPO_PATH_REQUIRED` error
- [x] Error message shows correct usage

✅ **Testing**:

- [x] All-common-patterns tests pass (6/6)
- [ ] CLI-options tests pass (3/16 currently)
- [ ] All other integration tests pass
- [ ] All unit tests still pass

✅ **Documentation**:

- [ ] README.md shows new syntax
- [ ] Migration guide added
- [ ] Help output verified

✅ **Quality**:

- [ ] All tests pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Manual testing complete

✅ **Cleanup**:

- [ ] Old backup branches deleted
- [ ] Working tree clean
- [ ] Version bumped to 0.2.0
- [ ] Changes committed

---

## Next Steps

**Immediate** (next session):

1. Fix remaining tests in `cli-options.test.ts`
2. Run full test suite to find any other broken tests
3. Update README.md usage examples

**Short-term** (same day):
4. Delete backup branches
5. Update version to 0.2.0
6. Commit all changes

**Before release**:
7. Full manual testing in disposable repo
8. Create git tag v0.2.0
9. Update any CI/CD configurations
10. Consider adding CHANGELOG.md entry

---

## Contact / Questions

If continuing this work, review:

1. This handoff document
2. Git log: `git log --oneline origin/main..HEAD`
3. Test results: `deno test --allow-all`
4. Modified files: `git status`

Start with: Fix `cli-options.test.ts` using the pattern from `all-common-patterns-cli.test.ts`.
