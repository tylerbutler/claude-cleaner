# Semantic Release Implementation Plan

## Overview

Set up semantic-release to automate versioning, CHANGELOG generation, JSR publishing, and GitHub releases via manual workflow dispatch trigger.

## How Automated Commits Work in CI

**The @semantic-release/git plugin:**
1. Runs during CI after other plugins generate CHANGELOG.md and update deno.json
2. Commits these files back to the repo with message: `chore(release): X.Y.Z [skip ci]`
3. Pushes the commit to GitHub using `GITHUB_TOKEN`
4. `[skip ci]` prevents infinite loop (commit won't trigger the workflow again)
5. The commit appears in git history like any other commit
6. Git tag points to this release commit (includes CHANGELOG.md and updated deno.json)

**Execution order in CI:**
1. @semantic-release/commit-analyzer → determines version bump from conventional commits
2. @semantic-release/release-notes-generator → generates release notes from commits
3. @semantic-release/changelog → writes CHANGELOG.md file
4. @sebbo2002/semantic-release-jsr → updates deno.json version + publishes to JSR
5. **@semantic-release/git** → commits CHANGELOG.md + deno.json → pushes to repo
6. @semantic-release/github → creates GitHub release with binaries

**Version Bump Logic:**
- `fix:` commits → patch version bump (0.2.0 → 0.2.1)
- `feat:` commits → minor version bump (0.2.0 → 0.3.0)
- `BREAKING CHANGE:` or `feat!:` → major version bump (0.2.0 → 1.0.0)
- `chore:`, `docs:`, `test:`, etc. → no release triggered

## Files to Create

### 1. `.releaserc.json` - semantic-release configuration

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", {
      "changelogFile": "CHANGELOG.md"
    }],
    ["@sebbo2002/semantic-release-jsr", {
      "allowDirty": true
    }],
    ["@semantic-release/git", {
      "assets": ["CHANGELOG.md", "deno.json"],
      "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
    }],
    ["@semantic-release/github", {
      "assets": [
        {"path": "dist/claude-cleaner-linux-x64"},
        {"path": "dist/claude-cleaner-linux-arm64"},
        {"path": "dist/claude-cleaner-macos-x64"},
        {"path": "dist/claude-cleaner-macos-arm64"},
        {"path": "dist/claude-cleaner-windows-x64.exe"}
      ]
    }]
  ]
}
```

**Key configuration points:**
- Plugins run in order as listed
- `allowDirty: true` needed because version is updated before publish
- Git plugin commits CHANGELOG.md and deno.json with `[skip ci]` message
- GitHub plugin uploads all platform binaries from dist/

### 2. `package.json` - npm dependencies

```json
{
  "name": "@tylerbu/claude-cleaner",
  "private": true,
  "devDependencies": {
    "semantic-release": "^24.0.0",
    "@semantic-release/changelog": "^6.0.3",
    "@semantic-release/git": "^10.0.1",
    "@semantic-release/github": "^11.0.0",
    "@sebbo2002/semantic-release-jsr": "^2.0.0"
  }
}
```

**Key points:**
- `private: true` - not publishing this package.json to npm
- Only devDependencies needed (semantic-release runs in CI only)

### 3. `.npmrc` - npm configuration (optional)

```
package-lock=false
```

**Purpose:** Disable package-lock.json generation for simpler setup

## Files to Modify

### 4. `.github/workflows/release.yml` - GitHub Actions workflow

**Current state:** Triggers on git tags (`v*.*.*`), separate jobs for build/publish/release

**New implementation:**

```yaml
name: Release

on:
  workflow_dispatch:  # Manual trigger only
    inputs:
      dry-run:
        description: 'Dry run (no actual release)'
        required: false
        type: boolean
        default: false

permissions:
  contents: write
  issues: write
  pull-requests: write
  id-token: write

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for conventional commits
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Deno
        uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Build binaries
        run: |
          mkdir -p dist
          deno compile --allow-all --target x86_64-unknown-linux-gnu --output dist/claude-cleaner-linux-x64 src/main.ts
          deno compile --allow-all --target aarch64-unknown-linux-gnu --output dist/claude-cleaner-linux-arm64 src/main.ts
          deno compile --allow-all --target x86_64-apple-darwin --output dist/claude-cleaner-macos-x64 src/main.ts
          deno compile --allow-all --target aarch64-apple-darwin --output dist/claude-cleaner-macos-arm64 src/main.ts
          deno compile --allow-all --target x86_64-pc-windows-msvc --output dist/claude-cleaner-windows-x64.exe src/main.ts

      - name: Run semantic-release (dry-run)
        if: ${{ inputs.dry-run }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx semantic-release --dry-run

      - name: Run semantic-release
        if: ${{ !inputs.dry-run }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx semantic-release
```

**Key changes:**
- Change trigger: `on.push.tags` → `on.workflow_dispatch`
- Add dry-run input parameter
- Add required permissions for git commits and releases
- Checkout with full history (`fetch-depth: 0`)
- Add Node.js setup step
- Consolidate build matrix into single job (all platforms in dist/)
- Remove separate publish-jsr and create-release jobs (handled by semantic-release)
- Add conditional steps for dry-run vs real release

### 5. `.gitignore` - ignore npm artifacts

**Add these lines:**

```
# npm dependencies (for semantic-release)
node_modules/
package-lock.json

# Build artifacts
dist/
```

### 6. `README.md` - document release process

**Add new section after installation instructions:**

```markdown
## Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) with [conventional commits](https://www.conventionalcommits.org/) for automated versioning and releases.

### Conventional Commit Format

All commits must follow the conventional commit format:

- `feat: description` - New features (minor version bump)
- `fix: description` - Bug fixes (patch version bump)
- `feat!: description` or `BREAKING CHANGE:` - Breaking changes (major version bump)
- `chore:`, `docs:`, `test:`, `refactor:` - No release (maintenance commits)

Examples:

```bash
# Patch release (0.2.0 → 0.2.1)
git commit -m "fix: handle symlinks correctly in directory scanning"

# Minor release (0.2.0 → 0.3.0)
git commit -m "feat: add interactive mode for file selection"

# Major release (0.2.0 → 1.0.0)
git commit -m "feat!: rename --all flag to --include-all

BREAKING CHANGE: The --all flag has been renamed to --include-all for clarity"

# No release
git commit -m "docs: improve README examples"
git commit -m "chore: update dependencies"
```

### Creating a Release

1. **Ensure all commits** since last release follow conventional commit format

2. **Preview the release** (optional):
   - Go to [Actions → Release](../../actions/workflows/release.yml)
   - Click "Run workflow"
   - Check "Dry run" checkbox
   - Click "Run workflow" button
   - Review the logs to see what version would be released

3. **Create the release**:
   - Go to [Actions → Release](../../actions/workflows/release.yml)
   - Click "Run workflow"
   - Leave "Dry run" unchecked
   - Click "Run workflow" button

4. **semantic-release will automatically**:
   - Analyze commits to determine version bump
   - Update `deno.json` with new version
   - Generate/update `CHANGELOG.md`
   - Publish package to [JSR](https://jsr.io/@tylerbu/claude-cleaner)
   - Create [GitHub release](../../releases) with binaries for all platforms
   - Commit `CHANGELOG.md` and `deno.json` back to the repository
   - Create git tag for the release

### What Gets Released

- **Linux**: x86_64, aarch64
- **macOS**: x86_64 (Intel), aarch64 (Apple Silicon)
- **Windows**: x86_64

All binaries are attached to the GitHub release and the package is published to JSR.
```

## Validation Steps (Post-Implementation)

### Step 1: Local Testing

```bash
# Install dependencies
npm install

# Test configuration locally (requires git history with conventional commits)
npx semantic-release --dry-run
```

**Expected output:**
- Analysis of commits since last release
- Calculated next version
- Preview of CHANGELOG.md content
- No actual changes made

### Step 2: CI Dry-Run Testing

1. Push implementation to GitHub
2. Go to Actions → Release workflow
3. Click "Run workflow"
4. Check "Dry run" checkbox
5. Click "Run workflow" button
6. Review logs for:
   - Commit analysis results
   - Version bump calculation
   - CHANGELOG.md preview
   - No actual publish/release operations

### Step 3: First Real Release

**Prerequisites:**
- At least one conventional commit since last tag (v0.2.0)
- All tests passing on main branch

**Steps:**
1. Go to Actions → Release workflow
2. Click "Run workflow" (dry-run unchecked)
3. Monitor workflow execution
4. Verify completion:
   - New commit on main with `chore(release): X.Y.Z [skip ci]`
   - CHANGELOG.md file committed and updated
   - deno.json version updated
   - Git tag created (vX.Y.Z)
   - JSR package published
   - GitHub release created with binaries
   - No workflow triggered by release commit (`[skip ci]` working)

### Step 4: Validation Checklist

- [ ] CHANGELOG.md exists and contains new version section
- [ ] CHANGELOG.md organized by commit types (Features, Bug Fixes, etc.)
- [ ] deno.json version matches released version
- [ ] Git tag exists and points to release commit
- [ ] JSR shows new version at https://jsr.io/@tylerbu/claude-cleaner
- [ ] GitHub release exists with all 5 binary files
- [ ] Release commit has `[skip ci]` in message
- [ ] No duplicate workflow runs triggered

## Migration Considerations

### Existing Tags

**Current tags:** v0.1.0, v0.2.0

**Handling:**
- semantic-release will detect latest tag (v0.2.0) automatically
- Next release will build on top of existing tags
- No manual migration needed

### First Run Requirements

**Scenario 1:** Commits exist since v0.2.0 with conventional format
- semantic-release will detect them and determine version

**Scenario 2:** No conventional commits since v0.2.0
- Need at least one conventional commit (feat/fix) to trigger release
- Or manually create initial CHANGELOG.md to bootstrap

### Commit Discipline Going Forward

**Required:** All commits to main must follow conventional commit format

**Enforcement options (future enhancement):**
- Add commitlint as pre-commit hook
- Add commit message validation in PR checks
- Document in CONTRIBUTING.md

## Dependencies on External Services

### GitHub
- **Workflow execution:** GitHub Actions runner
- **Authentication:** `GITHUB_TOKEN` (automatic, no setup needed)
- **Permissions:** contents:write, issues:write, pull-requests:write
- **Features used:** Releases, commit API, tags

### JSR (JavaScript Registry)
- **Publishing:** `deno publish` with OIDC authentication
- **Permissions:** id-token:write (for OIDC)
- **No secrets needed:** Uses GitHub's OIDC provider

### npm Registry
- **Usage:** Downloading semantic-release dependencies during CI
- **Fallback:** Could vendor dependencies if npm becomes unavailable
- **No authentication needed:** All packages are public

## Rollback Plan

### If semantic-release Doesn't Work

**Backup strategy:**
1. Keep current `release.yml` as `release.yml.backup` before modifying
2. Can restore tag-based workflow if needed
3. Manually maintain CHANGELOG.md if automation fails

**Rollback steps:**
```bash
# Restore old workflow
git restore .github/workflows/release.yml

# Remove semantic-release files
git rm .releaserc.json package.json .npmrc

# Restore .gitignore
git restore .gitignore

# Push changes
git commit -m "revert: rollback to manual release process"
git push
```

### Partial Success Scenarios

**Scenario:** Release created but CHANGELOG.md not committed
- **Fix:** Manually commit CHANGELOG.md and update tag reference

**Scenario:** JSR publish fails but GitHub release succeeds
- **Fix:** Manually run `deno publish` locally

**Scenario:** Version bump incorrect
- **Fix:** Delete tag and release, fix commits, re-run workflow

## Future Enhancements (Optional, Not in This Plan)

### Commit Enforcement

**Option 1: commitlint**
```json
// .commitlintrc.json
{
  "extends": ["@commitlint/config-conventional"]
}
```

**Option 2: GitHub Actions PR check**
```yaml
# .github/workflows/commitlint.yml
- uses: wagoid/commitlint-github-action@v5
```

### Release Branches

If wanting separate development vs release cadence:

```json
// .releaserc.json
{
  "branches": [
    "main",
    {"name": "beta", "prerelease": true}
  ]
}
```

### Release Notifications

Add plugins for notifications:
- `@semantic-release/slack`
- `@semantic-release/discord`
- Custom webhook plugin

### Additional Release Assets

Beyond binaries, could include:
- Checksums (SHA256SUMS)
- Signatures (GPG)
- Installation scripts
- Documentation PDF

## Implementation Checklist

When implementing this plan:

- [ ] Create `.releaserc.json` with plugin configuration
- [ ] Create `package.json` with semantic-release dependencies
- [ ] Create `.npmrc` (optional)
- [ ] Update `.github/workflows/release.yml` to use workflow_dispatch
- [ ] Update `.gitignore` to exclude node_modules, package-lock.json, dist/
- [ ] Update `README.md` with release process documentation
- [ ] Run `npm install` to generate package-lock.json (if not using .npmrc)
- [ ] Test with `npx semantic-release --dry-run` locally
- [ ] Commit all changes with conventional commit message
- [ ] Test workflow with dry-run=true in GitHub Actions
- [ ] Run first real release with dry-run=false
- [ ] Validate all artifacts (CHANGELOG.md, tag, JSR, GitHub release)
- [ ] Document any issues or adjustments needed
- [ ] Update HANDOFF.md with new release process

## Key Success Criteria

✅ **Automated:** No manual version editing required
✅ **Reliable:** Consistent CHANGELOG format and versioning
✅ **Controlled:** Manual trigger prevents unexpected releases
✅ **Testable:** Dry-run mode for validation before release
✅ **Traceable:** CHANGELOG.md tracked in git history
✅ **Complete:** Single action publishes to JSR and GitHub with binaries

## Resources

- [semantic-release documentation](https://semantic-release.gitbook.io/)
- [Conventional Commits specification](https://www.conventionalcommits.org/)
- [@sebbo2002/semantic-release-jsr](https://github.com/sebbo2002/semantic-release-jsr)
- [JSR publishing documentation](https://jsr.io/docs/publishing-packages)
- [GitHub Actions workflow_dispatch](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_dispatch)
