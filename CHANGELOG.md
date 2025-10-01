# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-09-30

### Changed

- **BREAKING**: Repository path is now a required positional argument instead of an optional `--repo-path` flag
  - **Before**: `claude-cleaner --files-only` (defaulted to current directory)
  - **After**: `claude-cleaner . --files-only` (explicit path required)
  - **Reason**: Prevents accidental operations on wrong directory by requiring explicit repository path

### Fixed

- Fixed critical bug where integration tests corrupted the actual repository by running `--execute` mode on `Deno.cwd()` instead of test fixtures
- Updated all integration tests to use isolated test repositories instead of operating on the real repository

## [0.1.0] - 2025-09-10

### Added

- Initial release
- File cleaning with BFG Repo-Cleaner integration
- Commit message cleaning with sd (modern sed)
- Automatic dependency installation
- Cross-platform support (Windows, macOS, Linux)
- Dry-run mode by default with `--execute` flag for actual changes
- Selective cleaning modes: `--files-only`, `--commits-only`
- Automatic backup branch creation before destructive operations
- Directory pattern matching with `--include-dirs` and `--include-dirs-file`
- Comprehensive pattern support with `--include-all-common-patterns`
- Pattern validation to prevent dangerous operations

[0.2.0]: https://github.com/tylerbutler/claude-cleaner/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tylerbutler/claude-cleaner/releases/tag/v0.1.0
