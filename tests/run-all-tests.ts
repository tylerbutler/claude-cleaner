/**
 * Test runner script for Claude Cleaner
 * Runs all tests and provides summary reporting
 */

import { parseArgs } from "@std/cli";

interface TestSuite {
  name: string;
  path: string;
  description: string;
}

const TEST_SUITES: TestSuite[] = [
  // Unit suites (tests/unit/) — module-level behavior, no full CLI workflow.
  {
    name: "test-framework",
    path: "tests/unit/test-framework.test.ts",
    description: "Testing framework and fixtures validation",
  },
  {
    name: "utils",
    path: "tests/unit/utils.test.ts",
    description: "Utilities unit tests",
  },
  {
    name: "dependency-manager",
    path: "tests/unit/dependency-manager.test.ts",
    description: "Dependency manager (Git-only) unit tests",
  },
  {
    name: "file-cleaner",
    path: "tests/unit/file-cleaner.test.ts",
    description: "File cleaner detection/planning unit tests",
  },
  {
    name: "commit-cleaner",
    path: "tests/unit/commit-cleaner.test.ts",
    description: "Commit cleaner analysis/branch-resolution unit tests",
  },
  {
    name: "commit-message-filter",
    path: "tests/unit/commit-message-filter.test.ts",
    description: "Shared commit-message attribution parser unit tests",
  },
  {
    name: "internal-filter",
    path: "tests/unit/internal-filter.test.ts",
    description: "Internal self-invocation filter unit tests",
  },
  {
    name: "main",
    path: "tests/unit/main.test.ts",
    description: "Main CLI validation and mode-dispatch tests",
  },
  {
    name: "pattern-matcher",
    path: "tests/unit/pattern-matcher.test.ts",
    description: "Hybrid glob/regex pattern matcher unit tests",
  },
  {
    name: "pattern-validation",
    path: "tests/unit/pattern-validation.test.ts",
    description: "Pattern validation unit tests",
  },
  {
    name: "all-common-patterns",
    path: "tests/unit/all-common-patterns.test.ts",
    description: "Extended (--include-all-common-patterns) pattern tests",
  },
  {
    name: "no-defaults-behavior",
    path: "tests/unit/no-defaults-behavior.test.ts",
    description: "--no-defaults behavior unit tests",
  },
  {
    name: "file-pattern-loading",
    path: "tests/unit/file-pattern-loading.test.ts",
    description: "Directory-pattern file loading unit tests",
  },
  // Integration suites (tests/integration/) — real CLI / git workflows.
  {
    name: "full-workflow",
    path: "tests/integration/full-workflow.test.ts",
    description: "Full workflow: dry-run plans, backups/recovery, no leaks",
  },
  {
    name: "cli-orchestration",
    path: "tests/integration/cli-orchestration.test.ts",
    description: "Full-mode preflight, relative paths, and mode coordination",
  },
  {
    name: "cli-options",
    path: "tests/integration/cli-options.test.ts",
    description: "CLI option parsing and directory-pattern integration",
  },
  {
    name: "exact-path-removal",
    path: "tests/integration/exact-path-removal.test.ts",
    description: "Exact-path history rewriting integration tests",
  },
  {
    name: "commit-branch-scoping",
    path: "tests/integration/commit-branch-scoping.test.ts",
    description: "Branch-scoped commit rewriting integration tests",
  },
  {
    name: "commit-message-filtering",
    path: "tests/integration/commit-message-filtering.test.ts",
    description: "Commit-message filtering via real filter-branch",
  },
  {
    name: "internal-filter-invocation",
    path: "tests/integration/internal-filter-invocation.test.ts",
    description: "Internal self-invocation filter CLI integration tests",
  },
  {
    name: "dependency-management",
    path: "tests/integration/dependency-management.test.ts",
    description: "Dependency reporting and --auto-install no-op tests",
  },
  {
    name: "pattern-matching",
    path: "tests/integration/pattern-matching.test.ts",
    description: "Pattern-matching detection integration tests",
  },
  {
    name: "all-common-patterns-cli",
    path: "tests/integration/all-common-patterns-cli.test.ts",
    description: "Extended-pattern CLI integration tests",
  },
  {
    name: "cross-platform",
    path: "tests/integration/cross-platform.test.ts",
    description: "Cross-platform compatibility tests",
  },
];

async function runTestSuite(
  suite: TestSuite,
  __verbose: boolean = false,
): Promise<{
  success: boolean;
  output: string;
  duration: number;
}> {
  const startTime = Date.now();

  try {
    const command = new Deno.Command("deno", {
      args: ["test", "--allow-all", suite.path],
      stdout: "piped",
      stderr: "piped",
    });

    const result = await command.output();
    const duration = Date.now() - startTime;

    const output = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    const success = result.code === 0;
    const fullOutput = output + (stderr ? `\nStderr:\n${stderr}` : "");

    return {
      success,
      output: fullOutput,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: `Error running test: ${errorMessage}`,
      duration,
    };
  }
}

async function main() {
  const args = parseArgs(Deno.args, {
    boolean: ["verbose", "help", "unit-only", "integration-only"],
    string: ["suite"],
    alias: {
      v: "verbose",
      h: "help",
      s: "suite",
    },
  });

  if (args.help) {
    console.log(`
Claude Cleaner Test Runner

Usage: deno run --allow-all tests/run-all-tests.ts [options]

Options:
  -v, --verbose              Show detailed output for each test
  -s, --suite <name>         Run specific test suite only
      --unit-only            Run only unit tests  
      --integration-only     Run only integration tests
  -h, --help                 Show this help message

Available test suites:
${TEST_SUITES.map((s) => `  ${s.name.padEnd(20)} ${s.description}`).join("\n")}
`);
    return;
  }

  let suitesToRun = TEST_SUITES;

  // Filter by suite name
  if (args.suite) {
    suitesToRun = TEST_SUITES.filter((s) => s.name === args.suite);
    if (suitesToRun.length === 0) {
      console.error(`❌ Test suite "${args.suite}" not found`);
      console.error(
        `Available suites: ${TEST_SUITES.map((s) => s.name).join(", ")}`,
      );
      Deno.exit(1);
    }
  }

  // Filter by test type
  if (args["unit-only"]) {
    suitesToRun = suitesToRun.filter((s) => s.path.includes("/unit/"));
  } else if (args["integration-only"]) {
    suitesToRun = suitesToRun.filter((s) => s.path.includes("/integration/"));
  }

  console.log(`🧪 Running ${suitesToRun.length} test suite(s)...\n`);

  const results: Array<{
    suite: TestSuite;
    success: boolean;
    output: string;
    duration: number;
  }> = [];

  for (const suite of suitesToRun) {
    console.log(`▶️  Running ${suite.name}...`);

    const result = await runTestSuite(suite, args.verbose);
    results.push({ suite, ...result });

    if (result.success) {
      console.log(`✅ ${suite.name} passed (${result.duration}ms)`);
    } else {
      console.log(`❌ ${suite.name} failed (${result.duration}ms)`);
    }

    if (args.verbose || !result.success) {
      console.log(`\n--- ${suite.name} output ---`);
      console.log(result.output);
      console.log(`--- end ${suite.name} output ---\n`);
    }
  }

  // Summary
  const totalSuites = results.length;
  const passedSuites = results.filter((r) => r.success).length;
  const failedSuites = totalSuites - passedSuites;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`\n📊 Test Summary:`);
  console.log(`   Total: ${totalSuites} suites`);
  console.log(`   Passed: ${passedSuites} suites`);
  console.log(`   Failed: ${failedSuites} suites`);
  console.log(`   Duration: ${totalDuration}ms`);

  if (failedSuites > 0) {
    console.log(`\n❌ Failed test suites:`);
    results
      .filter((r) => !r.success)
      .forEach((r) => console.log(`   - ${r.suite.name}`));

    Deno.exit(1);
  } else {
    console.log(`\n🎉 All tests passed!`);
  }
}

if (import.meta.main) {
  await main();
}
