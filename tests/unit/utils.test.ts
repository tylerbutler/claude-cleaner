/**
 * Focused unit tests for utility helpers.
 */

import { assert, assertEquals } from "@std/assert";
import {
  AppError,
  checkForMissingDependencies,
  type DependencyCheckResult,
  type Logger,
} from "../../src/utils.ts";

class RecordingLogger implements Logger {
  readonly infoMessages: string[] = [];
  readonly warnMessages: string[] = [];
  readonly errorMessages: string[] = [];
  readonly verboseMessages: string[] = [];
  readonly debugMessages: string[] = [];

  info(message: string): void {
    this.infoMessages.push(message);
  }

  warn(message: string): void {
    this.warnMessages.push(message);
  }

  error(message: string): void {
    this.errorMessages.push(message);
  }

  verbose(message: string): void {
    this.verboseMessages.push(message);
  }

  debug(message: string): void {
    this.debugMessages.push(message);
  }
}

Deno.test("Utils - missing dependency guidance", () => {
  const logger = new RecordingLogger();
  const depResults: DependencyCheckResult[] = [
    { tool: "git", available: false, error: "not found" },
  ];

  let thrown: unknown;
  try {
    checkForMissingDependencies(depResults, false, logger);
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof AppError);
  assertEquals((thrown as AppError).code, "MISSING_DEPENDENCIES");

  assertEquals(logger.errorMessages[0], "Missing required dependencies:");
  assertEquals(logger.errorMessages[1], "  - git: not found");
  assertEquals(
    logger.errorMessages[2],
    "\n1 required dependency is missing. Please install Git and ensure it is available on your PATH.",
  );

  const combined = logger.errorMessages.join("\n");
  assert(!combined.includes("--auto-install"));
});
