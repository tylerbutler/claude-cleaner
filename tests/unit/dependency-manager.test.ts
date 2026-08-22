/**
 * Unit tests for the dependency manager.
 *
 * Claude Cleaner rewrites history using Git plus its own self-invoked
 * `git filter-branch` filters, so **Git is the only external dependency**.
 * These tests pin that contract: the manager reports Git (and nothing else),
 * and it no longer installs, downloads, or references the retired
 * Java/BFG/`sd`/mise toolchain.
 */

import { assert, assertEquals } from "@std/assert";
import { DependencyManager } from "../../src/dependency-manager.ts";
import { ConsoleLogger } from "../../src/utils.ts";

const logger = new ConsoleLogger(false);

Deno.test("DependencyManager - reports Git only", async (t) => {
  await t.step("checkGit reports Git as available with a version", async () => {
    const dm = new DependencyManager(logger);
    const result = await dm.checkGit();

    assertEquals(result.tool, "git");
    assert(result.available, `expected git to be available: ${result.error}`);
    assert(
      typeof result.version === "string" && result.version.length > 0,
      "git version should be reported",
    );
    // A resolved path is best-effort; when present it should point at git.
    if (result.path) {
      assert(
        result.path.toLowerCase().includes("git"),
        `resolved path should reference git, got: ${result.path}`,
      );
    }
  });

  await t.step(
    "checkAllDependencies returns exactly one entry — git",
    async () => {
      const dm = new DependencyManager(logger);
      const results = await dm.checkAllDependencies();

      assertEquals(results.length, 1, "git must be the only dependency");
      assertEquals(results[0]?.tool, "git");
      assert(results[0]?.available);

      // The retired toolchain must not reappear in dependency reporting.
      const tools = results.map((r) => r.tool);
      for (const retired of ["java", "bfg", "sd", "mise"]) {
        assert(
          !tools.includes(retired),
          `${retired} should no longer be reported as a dependency`,
        );
      }
    },
  );

  await t.step(
    "the manager exposes no install/download/cache surface",
    () => {
      const dm = new DependencyManager(logger) as unknown as Record<
        string,
        unknown
      >;
      // These belonged to the removed mise/BFG machinery; none should remain.
      for (
        const removed of [
          "installAllDependencies",
          "installJava",
          "installSd",
          "downloadBfgJar",
          "ensureMiseInstalled",
          "reshimMise",
          "getBfgJarPath",
          "checkDependency",
        ]
      ) {
        assertEquals(
          typeof dm[removed],
          "undefined",
          `${removed}() should have been removed`,
        );
      }
    },
  );
});
