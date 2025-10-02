export default {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          // User-facing changes that trigger releases
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "revert", release: "patch" },
          // Internal changes that don't affect runtime behavior - no release
          { type: "docs", release: false },
          { type: "style", release: false },
          { type: "refactor", release: false },
          { type: "test", release: false },
          { type: "build", release: false },
          { type: "ci", release: false },
          { type: "chore", release: false },
          // Breaking changes bump minor version in pre-1.0 (0.x.x)
          // This prevents 0.x.x → 1.0.0 until we're ready for stable release
          // Change to "major" when ready for 1.0.0+
          { breaking: true, release: "minor" },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          // All commit types are documented in release notes, even if they don't trigger releases
          // This provides visibility into all changes between versions
          types: [
            { type: "feat", section: "✨ Features" },
            { type: "fix", section: "🐛 Bug Fixes" },
            { type: "perf", section: "⚡ Performance Improvements" },
            { type: "revert", section: "⏪ Reverts" },
            { type: "docs", section: "📝 Documentation" },
            { type: "style", section: "💄 Styles" },
            { type: "refactor", section: "♻️ Code Refactoring" },
            { type: "test", section: "✅ Tests" },
            { type: "build", section: "📦 Build System" },
            { type: "ci", section: "👷 CI/CD" },
            { type: "chore", section: "🔧 Chores", hidden: true },
          ],
        },
        writerOpts: {
          commitsSort: ["subject", "scope"],
        },
      },
    ],
    [
      "@semantic-release/changelog",
      {
        changelogFile: "CHANGELOG.md",
        changelogTitle:
          "# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
      },
    ],
    [
      "@semantic-release/git",
      {
        // Commit updated CHANGELOG.md and deno.json (version bump) back to repo
        assets: ["CHANGELOG.md", "deno.json"],
        message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    [
      "@sebbo2002/semantic-release-jsr",
      {
        // Allow publishing with uncommitted changes since @semantic-release/git
        // commits after this plugin runs (creates temporal ordering issue)
        allowDirty: true,
      },
    ],
    [
      "@semantic-release/github",
      {
        // Upload compiled binaries to GitHub release
        assets: [
          { path: "dist/claude-cleaner-linux-x64", label: "Linux x64 binary" },
          {
            path: "dist/claude-cleaner-linux-arm64",
            label: "Linux ARM64 binary",
          },
          { path: "dist/claude-cleaner-macos-x64", label: "macOS x64 binary" },
          {
            path: "dist/claude-cleaner-macos-arm64",
            label: "macOS ARM64 binary",
          },
          {
            path: "dist/claude-cleaner-windows-x64.exe",
            label: "Windows x64 binary",
          },
        ],
        // Comment on PRs/issues when they're included in a release
        successComment:
          "🎉 This ${issue.pull_request ? 'PR is included' : 'issue has been resolved'} in version ${nextRelease.version}.\n\nThe release is available:\n- [GitHub release](${releases[0].url})\n- [JSR package](https://jsr.io/@tylerbu/claude-cleaner)\n\n### Installation\n\n```bash\n# Via JSR\ndeno add @tylerbu/claude-cleaner\n\n# Or download binaries from the GitHub release\n```",
        // ERB-style template for release labels (supports release channels)
        releasedLabels: [
          'released<%= nextRelease.channel ? ` on @${nextRelease.channel}` : "" %>',
        ],
      },
    ],
  ],
};
