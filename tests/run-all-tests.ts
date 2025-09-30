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
  {
    name: "test-framework",
    path: "tests/unit/test-framework.test.ts",
    description: "Testing framework validation",
  },
  {
    name: "dependency-manager",
    path: "tests/unit/dependency-manager.test.ts",
    description: "Dependency manager unit tests",
  },
  {
    name: "file-cleaner",
    path: "tests/unit/file-cleaner.test.ts",
    description: "File cleaner unit tests",
  },
  {
    name: "commit-cleaner",
    path: "tests/unit/commit-cleaner.test.ts",
    description: "Commit cleaner unit tests",
  },
  {
    name: "utils",
    path: "tests/unit/utils.test.ts",
    description: "Utilities unit tests",
  },
  {
    name: "main",
    path: "tests/unit/main.test.ts",
    description: "Main CLI unit tests",
  },
  {
    name: "full-workflow",
    path: "tests/integration/full-workflow.test.ts",
    description: "Full workflow integration tests",
  },
  {
    name: "dependency-management",
    path: "tests/integration/dependency-management.test.ts",
    description: "Dependency management integration tests",
  },
  {
    name: "cross-platform",
    path: "tests/integration/cross-platform.test.ts",
    description: "Cross-platform compatibility tests",
  },
];

async function runTestSuite(suite: TestSuite, __verbose: boolean = false): Promise<{
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
    return {
      success: false,
      output: `Error running test: ${error.message}`,
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
      console.error(`Available suites: ${TEST_SUITES.map((s) => s.name).join(", ")}`);
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
