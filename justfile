# claude-cleaner development tasks

# Aliases
alias pr := ci

# Default recipe: show help
default:
    @just --list

# Build standalone binary
build:
    deno compile --allow-all --output claude-cleaner src/main.ts

# Run all tests
test:
    deno test --allow-all

# Format code
format:
    deno fmt

# Lint code
lint:
    deno lint

# Clean build artifacts
clean:
    rm -f claude-cleaner
    rm -f deno.lock

# CI checks: format check, lint, type check, and test
ci: _format-check lint _type-check test

# Run the tool with help
help:
    deno run --allow-all src/main.ts --help

# Run the tool with dry-run mode
run *args:
    deno run --allow-all src/main.ts {{args}}

# Run in dry-run mode (safe preview)
dry-run *args:
    deno run --allow-all src/main.ts --dry-run {{args}}

# Check dependencies
check-deps:
    deno run --allow-all src/main.ts check-deps

# Run unit tests only
test-unit:
    deno run --allow-all tests/run-all-tests.ts --unit-only

# Run integration tests only
test-integration:
    deno run --allow-all tests/run-all-tests.ts --integration-only

# Run tests with verbose output
test-verbose:
    deno run --allow-all tests/run-all-tests.ts --verbose

# Install the tool globally (requires sudo/admin on some systems)
install: build
    cp claude-cleaner /usr/local/bin/

# Uninstall the tool
uninstall:
    rm -f /usr/local/bin/claude-cleaner

# Show version info
version:
    @echo "claude-cleaner v0.1.0"
    @deno --version

# Private: Check formatting without making changes
_format-check:
    deno fmt --check

# Private: Type check
_type-check:
    deno check
