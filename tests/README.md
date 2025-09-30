# Claude Cleaner Test Suite

This directory contains the comprehensive test suite for Claude Cleaner, implementing Stream E from the parallel development plan.

## Test Structure

```
tests/
├── unit/                    # Unit tests for individual modules
│   ├── dependency-manager.test.ts
│   ├── file-cleaner.test.ts
│   ├── commit-cleaner.test.ts
│   ├── utils.test.ts
│   ├── main.test.ts
│   └── test-framework.test.ts
├── integration/             # Integration tests for full workflows
│   ├── full-workflow.test.ts
│   ├── dependency-management.test.ts
│   └── cross-platform.test.ts
├── utils/                   # Test utilities and helpers
│   ├── test-helpers.ts      # Common test helper functions
│   └── fixtures.ts          # Git repository fixtures
├── run-all-tests.ts         # Test runner script
└── README.md               # This file
```

## Running Tests

### Basic Commands

```bash
# Run all tests using Deno's built-in test runner
deno test --allow-all

# Run all tests using the custom test runner (more detailed output)
deno task test:run

# Run only unit tests
deno task test:unit

# Run only integration tests  
deno task test:integration

# Run tests with verbose output
deno task test:verbose

# Run a specific test suite
deno task test:run --suite test-framework
```

### Test Runner Options

The custom test runner (`tests/run-all-tests.ts`) provides additional features:

- **Verbose output**: `--verbose` or `-v`
- **Specific suite**: `--suite <name>` or `-s <name>`
- **Unit tests only**: `--unit-only`
- **Integration tests only**: `--integration-only`
- **Help**: `--help` or `-h`

## Test Categories

### Unit Tests

Unit tests focus on individual modules and functions in isolation:

- **test-framework.test.ts**: Validates the testing framework itself
- **dependency-manager.test.ts**: Tests dependency installation and validation
- **file-cleaner.test.ts**: Tests Claude file detection and BFG integration
- **commit-cleaner.test.ts**: Tests commit message cleaning and git filter-branch
- **utils.test.ts**: Tests utility functions and cross-platform helpers
- **main.test.ts**: Tests CLI argument parsing and command coordination
- **pattern-validation.test.ts**: Tests directory pattern validation and safety
- **file-pattern-loading.test.ts**: Tests loading patterns from files
- **no-defaults-behavior.test.ts**: Tests `--no-defaults` flag behavior

### Integration Tests

Integration tests verify complete workflows and cross-module interactions:

- **full-workflow.test.ts**: End-to-end cleaning workflows (files + commits)
- **dependency-management.test.ts**: Complete dependency installation process
- **cross-platform.test.ts**: Platform-specific behavior and compatibility
- **pattern-matching.test.ts**: Tests directory pattern matching in real repositories
- **cli-options.test.ts**: Tests CLI flag parsing for pattern options

## Test Utilities

### Test Helpers (`utils/test-helpers.ts`)

Provides essential testing utilities:

- `createTestRepo()`: Creates temporary Git repositories
- `addClaudeArtifacts()`: Adds Claude files to repositories
- `createCommitsWithClaudeTrailers()`: Creates commits with Claude attribution
- `assertValidGitRepo()`: Validates Git repository state
- `getRepoFiles()`: Lists all files in a repository
- `getCommitMessages()`: Extracts commit messages
- `hasClaudeArtifacts()`: Detects Claude content
- `assertNoClaudeArtifacts()`: Assertion for clean content
- `createMockTool()`: Creates mock external tools
- `runWithPath()`: Executes commands with custom PATH

### Fixtures (`utils/fixtures.ts`)

Provides pre-configured test repositories:

- `createMinimalRepo()`: Basic empty repository
- `createRepoWithClaudeFiles()`: Repository with Claude files only
- `createRepoWithClaudeCommits()`: Repository with Claude commit trailers only
- `createFullTestRepo()`: Repository with both files and commits
- `createEdgeCaseRepo()`: Repository with special characters and edge cases
- `createPartiallyCleanedRepo()`: Repository that's partially cleaned
- `createCleanRepo()`: Repository with no Claude artifacts

## Test Data

### Common Claude Artifacts

The test suite includes realistic Claude artifacts:

- `CLAUDE.md` files with project instructions
- `.claude/` directories with configuration
- `.vscode/claude.json` VS Code settings
- Temporary Claude files
- Commit trailers with Claude attribution
- Unicode and special character content

### Cross-Platform Testing

Tests verify behavior across platforms:

- **Windows**: CMD/PowerShell execution, path separators, file permissions
- **macOS**: Unix commands, case-insensitive filesystem handling
- **Linux**: Unix commands, case-sensitive filesystem, symlinks

## Directory Pattern Testing

### Test Coverage (41 test steps across 5 test files)

#### Pattern Validation Tests (`pattern-validation.test.ts`)

Tests safety and validation of directory patterns:

- **Invalid pattern rejection**: `../parent`, `/absolute`, `dir/subdir`, `*`, empty patterns
- **Valid pattern acceptance**: `claudedocs`, `.serena`, `hidden-dirs`, `patterns-with-hyphens`
- **Warning system**: Broad patterns (`temp`, `cache`, single chars) trigger warnings
- **Edge cases**: Whitespace-only patterns, special characters

#### File Pattern Loading Tests (`file-pattern-loading.test.ts`)

Tests loading patterns from files:

- **Basic loading**: Read patterns from file, one per line
- **Comment handling**: Skip lines starting with `#`
- **Whitespace handling**: Trim lines, skip empty lines
- **Error handling**: Missing files, permission errors
- **Edge cases**: UTF-8 content, long lines, mixed line endings
- **File formats**: Empty files, comment-only files, mixed content

#### No-Defaults Behavior Tests (`no-defaults-behavior.test.ts`)

Tests the `--no-defaults` flag:

- **Include defaults**: `excludeDefaults: false` includes Claude patterns
- **Exclude defaults**: `excludeDefaults: true` excludes Claude patterns
- **User-only mode**: Only user patterns when defaults disabled
- **Nested patterns**: Handles nested Claude files correctly
- **VS Code integration**: `.vscode/claude.json` file handling
- **Temporary files**: Claude temp file pattern matching

#### Pattern Matching Integration (`pattern-matching.test.ts`)

Tests pattern matching in real Git repositories:

- **Real repository testing**: Creates actual Git repos with directory structures
- **User pattern matching**: Finds directories by basename at any depth
- **Default integration**: Combines user patterns with Claude defaults
- **Exclusion mode**: Tests `--no-defaults` flag behavior
- **Complex structures**: Nested directories, multiple pattern matching

#### CLI Options Integration (`cli-options.test.ts`)

Tests CLI flag parsing:

- **Help output**: New flags appear in `--help`
- **Flag parsing**: `--include-dirs`, `--include-dirs-file`, `--no-defaults`
- **Multiple flags**: Repeatable `--include-dirs` flags
- **Error handling**: Invalid patterns rejected at CLI level
- **File integration**: Pattern file loading through CLI
- **Existing flag compatibility**: Works with `--files-only`, `--verbose`, etc.

### Pattern Matching Behavior

#### ✅ What Gets Matched

- Directory names anywhere in repository history
- Exact basename matches only (`claudedocs` matches `docs/claudedocs/`)
- Case-sensitive matching
- Hidden directories (`.serena`, `.cache`)
- Directories with special characters (`my-docs`, `docs_v2`)

#### ❌ What Gets Rejected

- Partial matches (`temp` does NOT match `temporary`)
- Path-based patterns (`docs/claudedocs` is invalid)
- Parent directory references (`../parent`)
- Absolute paths (`/usr/local`)
- Wildcard-only patterns (`*`)

### Running Pattern Tests

```bash
# Run all pattern-related tests
deno test tests/unit/pattern-validation.test.ts --allow-all
deno test tests/unit/file-pattern-loading.test.ts --allow-all
deno test tests/unit/no-defaults-behavior.test.ts --allow-all
deno test tests/integration/pattern-matching.test.ts --allow-all
deno test tests/integration/cli-options.test.ts --allow-all

# Run all pattern tests together
deno test tests/unit/pattern-*.test.ts tests/unit/no-defaults-*.test.ts tests/integration/pattern-*.test.ts tests/integration/cli-*.test.ts --allow-all
```

## Test Development Guidelines

### Writing New Tests

1. **Choose the right category**: Unit tests for isolated functionality, integration tests for workflows
2. **Use existing utilities**: Leverage test helpers and fixtures
3. **Follow naming conventions**: `*.test.ts` files, descriptive test names
4. **Test both success and failure cases**: Happy path and error conditions
5. **Clean up resources**: Always clean up temporary files and repositories

### Test Structure

```typescript
Deno.test("Module - Feature Group", async (t) => {
  await t.step("should test specific behavior", async () => {
    // Arrange
    const repo = await createTestRepo("test-name");

    try {
      // Act
      const result = await functionUnderTest(repo.path);

      // Assert
      assert(result.success);
      assertEquals(result.count, 5);
    } finally {
      // Cleanup
      await repo.cleanup();
    }
  });
});
```

### Mock Testing

For testing external dependencies:

```typescript
const mockTool = await createMockTool(
  "tool-name",
  `#!/bin/bash
echo "Mock output"
exit 0`,
);

try {
  const result = await runWithPath(["tool-name"], [mockTool.path]);
  assertEquals(result.code, 0);
} finally {
  await mockTool.cleanup();
}
```

## Expected Test Status

Currently, the test suite is designed to work with placeholder implementations. As the actual modules are developed:

1. **Framework tests**: ✅ Should pass immediately (testing framework itself)
2. **Unit tests**: ⏳ Will need implementation updates as modules are developed
3. **Integration tests**: ⏳ Will pass once all modules are integrated

## Continuous Integration

The test suite is designed to be run in CI environments:

- All tests use `--allow-all` for necessary permissions
- Tests clean up temporary resources
- Cross-platform compatibility is built-in
- Mock tools eliminate external dependencies

## Performance Considerations

- Tests use temporary directories that are automatically cleaned up
- Git operations are performed on small repositories
- External tool dependencies are mocked for speed
- Parallel test execution is supported through Deno's test runner

## Troubleshooting

### Common Issues

1. **Permission errors**: Ensure `--allow-all` flag is used
2. **Git not found**: Ensure Git is installed and in PATH
3. **Cleanup failures**: Temporary files may persist on test failures
4. **Platform differences**: Some tests may behave differently on different OS

### Debug Mode

Run tests with verbose output to diagnose issues:

```bash
deno task test:verbose
```

Or run a specific test file directly:

```bash
deno test --allow-all tests/unit/test-framework.test.ts
```
