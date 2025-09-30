# claude-cleaner development tasks

# Default recipe: show help
default:
    @just --list

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

# Build standalone binary
build:
    deno compile --allow-all --output claude-cleaner src/main.ts

# Run all tests
test:
    deno test --allow-all

# Run unit tests only
test-unit:
    deno run --allow-all tests/run-all-tests.ts --unit-only

# Run integration tests only
test-integration:
    deno run --allow-all tests/run-all-tests.ts --integration-only

# Run tests with verbose output
test-verbose:
    deno run --allow-all tests/run-all-tests.ts --verbose

# Format code
fmt:
    deno fmt

# Check formatting without making changes
fmt-check:
    deno fmt --check

# Lint code
lint:
    deno lint

# Type check
check:
    deno check src/main.ts

# Run all quality checks (format, lint, type check)
qa: fmt-check lint check

# Clean build artifacts
clean:
    rm -f claude-cleaner
    rm -f deno.lock

# Development: format, lint, check, and test
dev: fmt lint check test

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