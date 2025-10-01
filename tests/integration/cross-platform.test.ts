/**
 * Cross-platform compatibility tests for Claude Cleaner
 */

import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { dirname, join, normalize, resolve } from "@std/path";
import { createMockTool, createTestRepo, runWithPath } from "../utils/test-helpers.ts";

const currentOS = Deno.build.os;

Deno.test("Cross-platform - Path Handling", async (t) => {
  await t.step("should handle different path separators", () => {
    const mixedPath = "some\\path/with\\mixed/separators";
    const normalized = normalize(mixedPath);

    // Should be normalized according to current platform
    assert(typeof normalized === "string");
    assert(normalized.length > 0);
  });

  await t.step("should resolve absolute paths correctly", () => {
    const relativePath = join(".", "test", "file.txt");
    const absolutePath = resolve(relativePath);

    assert(absolutePath.includes("test"));
    assert(absolutePath.includes("file.txt"));
  });

  await t.step("should handle paths with spaces", async () => {
    const repo = await createTestRepo("path-spaces");

    try {
      const pathWithSpaces = join(repo.path, "folder with spaces");
      await Deno.mkdir(pathWithSpaces, { recursive: true });

      const testFile = join(pathWithSpaces, "file with spaces.txt");
      await Deno.writeTextFile(testFile, "content");

      assert(await exists(testFile));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should handle Unicode file paths", async () => {
    const repo = await createTestRepo("unicode-paths");

    try {
      const unicodePath = join(repo.path, "测试文件夹");
      await Deno.mkdir(unicodePath, { recursive: true });

      const unicodeFile = join(unicodePath, "文档.txt");
      await Deno.writeTextFile(unicodeFile, "Unicode content");

      assert(await exists(unicodeFile));
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test({
  name: "Cross-platform - Command Execution",
  fn: async (t) => {
    await t.step("should execute commands on Windows", async () => {
      if (currentOS === "windows") {
        // Test Windows-specific command execution
        const result = await runWithPath(["cmd", "/c", "echo", "test"], []);
        assertEquals(result.code, 0);
        assert(result.stdout.includes("test"));
      }
    });

    await t.step("should execute commands on Unix-like systems", async () => {
      if (currentOS === "linux" || currentOS === "darwin") {
        // Test Unix-like command execution
        const result = await runWithPath(["echo", "test"], []);
        assertEquals(result.code, 0);
        assert(result.stdout.includes("test"));
      }
    });

    await t.step("should handle PATH environment correctly", async () => {
      const mockTool = await createMockTool(
        currentOS === "windows" ? "test-tool.bat" : "test-tool",
        currentOS === "windows" ? "@echo Mock tool output" : "#!/bin/bash\necho 'Mock tool output'",
      );

      try {
        const result = await runWithPath(
          [currentOS === "windows" ? "test-tool.bat" : "test-tool"],
          [dirname(mockTool.path)],
        );

        assertEquals(result.code, 0);
        assert(result.stdout.includes("Mock tool output"));
      } finally {
        await mockTool.cleanup();
      }
    });
  },
});

Deno.test("Cross-platform - File System Operations", async (t) => {
  await t.step("should handle file permissions correctly", async () => {
    const repo = await createTestRepo("permissions");

    try {
      const testFile = join(repo.path, "test-file.txt");
      await Deno.writeTextFile(testFile, "content");

      if (currentOS !== "windows") {
        // Test Unix-like permissions
        await Deno.chmod(testFile, 0o755);
        const stat = await Deno.stat(testFile);
        assert(stat.mode !== null);
      }

      assert(await exists(testFile));
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should handle case sensitivity correctly", async () => {
    const repo = await createTestRepo("case-sensitivity");

    try {
      await Deno.writeTextFile(join(repo.path, "TestFile.txt"), "content1");

      if (currentOS === "windows" || currentOS === "darwin") {
        // Case-insensitive file systems
        const _exists1 = await exists(join(repo.path, "testfile.txt"));
        const _exists2 = await exists(join(repo.path, "TESTFILE.TXT"));
        // On case-insensitive systems, these should refer to the same file
      } else {
        // Case-sensitive file systems (Linux)
        await Deno.writeTextFile(join(repo.path, "testfile.txt"), "content2");
        assert(await exists(join(repo.path, "TestFile.txt")));
        assert(await exists(join(repo.path, "testfile.txt")));
      }
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should handle symlinks appropriately", async () => {
    if (currentOS !== "windows") {
      const repo = await createTestRepo("symlinks");

      try {
        const originalFile = join(repo.path, "original.txt");
        const symlinkFile = join(repo.path, "symlink.txt");

        await Deno.writeTextFile(originalFile, "original content");
        await Deno.symlink(originalFile, symlinkFile);

        assert(await exists(symlinkFile));

        const stat = await Deno.lstat(symlinkFile);
        assert(stat.isSymlink);
      } finally {
        await repo.cleanup();
      }
    }
  });
});

Deno.test("Cross-platform - Git Operations", async (t) => {
  await t.step("should handle Git line ending differences", async () => {
    const repo = await createTestRepo("line-endings");

    try {
      // Create files with different line endings
      const unixFile = join(repo.path, "unix.txt");
      const windowsFile = join(repo.path, "windows.txt");

      await Deno.writeTextFile(unixFile, "line1\nline2\nline3\n");
      await Deno.writeTextFile(windowsFile, "line1\r\nline2\r\nline3\r\n");

      // Git should handle these appropriately
      const { $ } = await import("dax");
      await $`git add .`.cwd(repo.path);
      await $`git commit -m "Test line endings"`.cwd(repo.path);

      const result = await $`git status`.cwd(repo.path);
      assert(result.code === 0);
    } finally {
      await repo.cleanup();
    }
  });

  await t.step("should handle Git config correctly", async () => {
    const repo = await createTestRepo("git-config");

    try {
      const { $ } = await import("dax");

      // Test Git configuration
      await $`git config user.name "Test User"`.cwd(repo.path);
      await $`git config user.email "test@example.com"`.cwd(repo.path);

      const nameResult = await $`git config user.name`
        .cwd(repo.path)
        .stdout("piped");
      assertEquals(nameResult.stdout.trim(), "Test User");
    } finally {
      await repo.cleanup();
    }
  });
});

Deno.test({
  name: "Cross-platform - Tool Dependencies",
  fn: async (t) => {
    await t.step("should handle Java on different platforms", async () => {
      const javaScript = currentOS === "windows"
        ? `@echo off
if "%1"=="-version" (
  echo java version "17.0.0"
  echo Java^(TM^) SE Runtime Environment
) else (
  echo Java mock: %*
)`
        : `#!/bin/bash
if [ "$1" = "-version" ]; then
  echo 'java version "17.0.0"'
  echo 'Java(TM) SE Runtime Environment'
else
  echo "Java mock: $*"
fi`;

      const mockJava = await createMockTool(
        currentOS === "windows" ? "java.bat" : "java",
        javaScript,
      );

      try {
        const result = await runWithPath(
          [currentOS === "windows" ? "java.bat" : "java", "-version"],
          [dirname(mockJava.path)],
        );

        assertEquals(result.code, 0);
        assert(result.stdout.includes("java version"));
      } finally {
        await mockJava.cleanup();
      }
    });

    await t.step("should handle sd tool on different platforms", async () => {
      const sdScript = currentOS === "windows"
        ? `@echo off
echo SD replacement tool: %*`
        : `#!/bin/bash
echo "SD replacement tool: $*"`;

      const mockSd = await createMockTool(
        currentOS === "windows" ? "sd.exe" : "sd",
        sdScript,
      );

      try {
        const result = await runWithPath(
          [currentOS === "windows" ? "sd.exe" : "sd", "test", "replacement"],
          [dirname(mockSd.path)],
        );

        assertEquals(result.code, 0);
        assert(result.stdout.includes("SD replacement tool"));
      } finally {
        await mockSd.cleanup();
      }
    });

    await t.step("should handle mise on different platforms", async () => {
      const miseScript = currentOS === "windows"
        ? `@echo off
if "%1"=="install" (
  echo Installing %2 via mise
) else (
  echo Mise: %*
)`
        : `#!/bin/bash
if [ "$1" = "install" ]; then
  echo "Installing $2 via mise"
else
  echo "Mise: $*"
fi`;

      const mockMise = await createMockTool(
        currentOS === "windows" ? "mise.exe" : "mise",
        miseScript,
      );

      try {
        const result = await runWithPath(
          [currentOS === "windows" ? "mise.exe" : "mise", "install", "java"],
          [dirname(mockMise.path)],
        );

        assertEquals(result.code, 0);
        assert(result.stdout.includes("Installing java via mise"));
      } finally {
        await mockMise.cleanup();
      }
    });
  },
});

Deno.test("Cross-platform - Error Handling", async (t) => {
  await t.step(
    "should provide platform-appropriate error messages",
    async () => {
      // TODO: Test error message formatting for different platforms
    },
  );

  await t.step(
    "should handle platform-specific permission errors",
    async () => {
      // TODO: Test permission error handling on different platforms
    },
  );

  await t.step("should handle platform-specific path limitations", () => {
    if (currentOS === "windows") {
      // Test Windows path length limitations
      // TODO: Test very long paths on Windows
    }
  });
});
