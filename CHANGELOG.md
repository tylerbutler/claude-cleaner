# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/tylerbutler/claude-cleaner/compare/v0.1.0...v0.2.0) (2025-10-02)

### ⚠ BREAKING CHANGES

* **cli:** Repository path is now a required positional argument instead of an optional --repo-path flag.

Before (v0.1.x):
  claude-cleaner --files-only                        # defaulted to current directory
  claude-cleaner --repo-path /path/to/repo --execute

After (v0.2.0):
  claude-cleaner . --files-only                      # explicit path required
  claude-cleaner /path/to/repo --execute

Changes:
- Remove --repo-path option flag
- Add required positional <repo-path> argument
- Update all tests to use isolated test repositories
- Fix critical bug where integration tests corrupted actual repository
- Add CHANGELOG.md documenting breaking change
- Update README.md with new syntax throughout
- Bump version to 0.2.0

Test Changes:
- Create test repository helpers in cli-options.test.ts
- All tests now use temporary test repos instead of operating on real repo
- All 52 tests pass (221 test steps)

Cleanup:
- Delete backup branches created by test corruption
- Fix error message referencing old --repo-path flag

Other:
- Add comprehensive ErrorCode type union with all error codes
- Consolidate NOT_GIT_REPOSITORY to NOT_GIT_REPO
- Delete HANDOFF.md development artifact
- Add tests for REPO_PATH_REQUIRED error path

### ✨ Features

* enable sticky comments for Claude code reviews ([#12](https://github.com/tylerbutler/claude-cleaner/issues/12)) ([8813394](https://github.com/tylerbutler/claude-cleaner/commit/881339465021cb86870e42a75b4d096ec87094d1))
* re-enable Windows tests to diagnose CI failures ([#18](https://github.com/tylerbutler/claude-cleaner/issues/18)) ([d99a41b](https://github.com/tylerbutler/claude-cleaner/commit/d99a41bf80827988723d05daa6c9f9af8943e2c9))

### 🐛 Bug Fixes

* add missing conventional-changelog-conventionalcommits dependency ([#11](https://github.com/tylerbutler/claude-cleaner/issues/11)) ([b4422f9](https://github.com/tylerbutler/claude-cleaner/commit/b4422f9c6a0fc8739a816d18cdb7510aaffebd08))
* **release:** configure semantic-release-jsr to use deno.json ([51bfaef](https://github.com/tylerbutler/claude-cleaner/commit/51bfaefedeff74287d11bf8538bcb3f11af50661))
* **release:** prevent breaking changes from bumping to 1.0.0 ([#22](https://github.com/tylerbutler/claude-cleaner/issues/22)) ([c5b6020](https://github.com/tylerbutler/claude-cleaner/commit/c5b6020ca23a70e930cf62988988d3ab59366037))
* **release:** push version commit after JSR publish and GitHub release ([38cf100](https://github.com/tylerbutler/claude-cleaner/commit/38cf10054ca133581764d0c3640c6e23e9d78b30))
* **cli:** require repository path as positional argument ([#3](https://github.com/tylerbutler/claude-cleaner/issues/3)) ([a27a486](https://github.com/tylerbutler/claude-cleaner/commit/a27a486aa3c4602b56cafca1657a70c57a081c1b))
* **ci:** use official Deno caching in release workflow ([#21](https://github.com/tylerbutler/claude-cleaner/issues/21)) ([ed25572](https://github.com/tylerbutler/claude-cleaner/commit/ed255727d92e72350d1a06587ecf60de25f3a445))
* **ci:** use official Deno caching instead of manual actions/cache ([#19](https://github.com/tylerbutler/claude-cleaner/issues/19)) ([a144be6](https://github.com/tylerbutler/claude-cleaner/commit/a144be6b36ad42abe796e6a1c571dc7ecf537017))

### ⚡ Performance Improvements

* batch BFG operations into single pass ([#13](https://github.com/tylerbutler/claude-cleaner/issues/13)) ([a7747c7](https://github.com/tylerbutler/claude-cleaner/commit/a7747c705e88540fdf660559786e040a2fb32b21))

### 📝 Documentation

* Add jsr installation info ([21e8fc1](https://github.com/tylerbutler/claude-cleaner/commit/21e8fc1075378d44ec8e4840a31e6f02eeab77da))
* improve pattern matching and basename logic clarity ([#9](https://github.com/tylerbutler/claude-cleaner/issues/9)) ([e9f05e5](https://github.com/tylerbutler/claude-cleaner/commit/e9f05e5d3b577d053ab9f66e1901725b24c88c45))

### ♻️ Code Refactoring

* hybrid glob/regex pattern matching ([#2](https://github.com/tylerbutler/claude-cleaner/issues/2)) ([a826f09](https://github.com/tylerbutler/claude-cleaner/commit/a826f093ce9f05d66794d9f0e19ac0d8e231c391))

### 👷 CI/CD

* add Deno caching and enhance release configuration ([#6](https://github.com/tylerbutler/claude-cleaner/issues/6)) ([c1ada5c](https://github.com/tylerbutler/claude-cleaner/commit/c1ada5c5e36e1dfabdf1eff6eea4bb5e5e4e2792))
* implement semantic-release for automated versioning ([#5](https://github.com/tylerbutler/claude-cleaner/issues/5)) ([ac1abf8](https://github.com/tylerbutler/claude-cleaner/commit/ac1abf8e30b5e23b945f395fddad66f9665c7738))
* pin GitHub Actions to commit SHAs with ratchet ([#8](https://github.com/tylerbutler/claude-cleaner/issues/8)) ([b8cf9b4](https://github.com/tylerbutler/claude-cleaner/commit/b8cf9b4f4f3e8c7719ef5b4c6614919a15b662f1))
* use GitHub App token for semantic-release ([d4d71a3](https://github.com/tylerbutler/claude-cleaner/commit/d4d71a3d0ff09cf16fd3083455f8360a4f88ab67))

> **Note**: Starting from v0.3.0, this changelog is automatically generated by [semantic-release](https://semantic-release.gitbook.io/) based on [conventional commits](https://www.conventionalcommits.org/). Earlier versions were manually curated.

---

## Historical Releases (Pre-Automation)

### [v0.2.0](https://github.com/tylerbutler/claude-cleaner/compare/v0.1.0...v0.2.0) (2025-09-30)

**Breaking Changes:**

- CLI now requires repository path as a positional argument instead of `--path` flag

**Features:**

- Implemented semantic-release for automated versioning and releases
- Added comprehensive release workflow with multi-platform binary builds
- Added GitHub Actions workflow for CI/CD

**Documentation:**

- Moved release process documentation to DEV.md
- Added JSR installation information
- Created initial CHANGELOG.md with auto-changelog format

**Internal:**

- Version bump to 0.2.0

### [v0.1.0](https://github.com/tylerbutler/claude-cleaner/releases/tag/v0.1.0) (2025-09-30)

**Initial Release**

Claude Cleaner is a tool that removes Claude artifacts (files and commit trailers) from Git repositories.

**Features:**

- File removal using BFG Repo-Cleaner for efficient Git history cleaning
- Commit trailer removal using git filter-branch with sd
- Pattern-based detection for Claude files (CLAUDE.md, .claude/, claudedocs/, etc.)
- Commit message cleaning for Claude Code attribution and co-authorship trailers
- Dry-run mode by default with explicit `--execute` flag for safety
- Automatic backup creation before destructive operations
- Pre-commit hooks for improved git operations
- Detection of earliest commit containing Claude artifacts
- Cross-platform support (Linux, macOS, Windows)

**Documentation:**

- Comprehensive README with usage examples
- Development guide with testing information
- Pattern documentation for file matching

**CI/CD:**

- GitHub Actions workflows for continuous integration
- Automated release process with binary compilation
- JSR package publishing support

---

## Automated Releases (v0.3.0+)

_Future releases will appear below this section, automatically generated by semantic-release._
