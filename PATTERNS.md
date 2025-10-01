# Claude Cleaner Pattern Reference

This document provides a comprehensive reference of all file patterns that Claude Cleaner can match when using the `--include-all-common-patterns` flag.

> [!NOTE]
> The patterns listed here are only used when `--include-all-common-patterns` is enabled. Without this flag, only the [standard patterns](README.md#files-removed-standard-mode) are used.

## Pattern Matching System

Claude Cleaner uses **exact basename matching** for safety:

- **`CLAUDE.md`** matches only files named exactly `CLAUDE.md` (not `CLAUDE.md.backup` or `MY-CLAUDE.md`)
- **`.claude/`** matches only directories named exactly `.claude` (not `.claude2` or `my.claude`)
- **`.vscode/claude.json`** matches the exact path `.vscode/claude.json` only

Patterns use wildcards (`*`) to match variations:

- `claude-session*` matches `claude-session`, `claude-session-123`, `claude-session.json`, etc.
- `claude*.json` matches `claude.json`, `claude-config.json`, `claude-workspace.json`, etc.

### Matching Examples

**File Pattern Matching:**

```
Pattern: CLAUDE.md
✅ Matches:   CLAUDE.md, docs/CLAUDE.md, src/utils/CLAUDE.md
❌ No match:  CLAUDE.md.backup, MY-CLAUDE.md, claude.md
```

**Wildcard Pattern Matching:**

```
Pattern: claude-session*
✅ Matches:   claude-session, claude-session-123, claude-session.json
❌ No match:  session-claude, my-claude-session
```

**Directory Pattern Matching:**

```
Pattern: .claude/
✅ Matches:   .claude/, src/.claude/, docs/.claude/
❌ No match:  .claude2/, my.claude/, claude/
```

**Specific Path Matching:**

```
Pattern: .vscode/claude.json
✅ Matches:   .vscode/claude.json (exact path only)
❌ No match:  .vscode/claude.config.json, claude.json
```

## Extended Pattern Categories

### Configuration Files

Files that configure Claude behavior and settings:

```
claude*.json
claude*.yaml
claude*.yml
claude*.toml
claude*.ini
claude*.config
claude-config*
claude-settings*
claude-workspace*
claude-env*
```

**Examples:** `claude.json`, `claude-config.yaml`, `claude-settings.toml`, `claude-workspace.json`

### Session & State Files

Files that store Claude session state and history:

```
claude-session*
claude-state*
claude-cache*
claude-history*
```

**Examples:** `claude-session-123.json`, `claude-state.db`, `claude-cache/`, `claude-history.log`

### Temporary & Working Files

Temporary files and working directories:

```
claude-temp*
claude-tmp*
claude-work*
claude-scratch*
claude-draft*
claude*.bak
claude*.backup
claude*.old
claude*.orig
claude*.save
claude-output*
claude-result*
claude-analysis*
claude-report*
```

**Examples:** `claude-temp.txt`, `claude-work/`, `claude-draft-v1.md`, `claude.bak`, `claude-output.json`

### Process Files

Files related to Claude process management:

```
claude*.lock
claude*.pid
claude*.socket
claude-lock*
claude-process*
claude-run*
```

**Examples:** `claude.lock`, `claude-process.pid`, `claude-run.socket`

### Debug & Diagnostic Files

Debugging, profiling, and diagnostic output:

```
claude-debug*
claude-trace*
claude-profile*
claude-diagnostic*
claude*.debug
claude*.trace
claude*.profile
claude*.diagnostic
```

**Examples:** `claude-debug.log`, `claude-trace-001.txt`, `claude-profile.json`, `claude.debug`

### Export & Archive Files

Data exports, archives, dumps, and snapshots:

```
claude-export*
claude-archive*
claude-dump*
claude-snapshot*
```

**Examples:** `claude-export-2024.zip`, `claude-archive.tar.gz`, `claude-dump.sql`, `claude-snapshot.json`

### IDE Integration Files

IDE-specific Claude configuration files:

```
.vscode/*claude*
.idea/*claude*
.eclipse/*claude*
```

**Examples:** `.vscode/claude-settings.json`, `.idea/claude-config.xml`, `.eclipse/claude.properties`

### Directories

Claude-related directories matched by exact name:

```
claude-workspace
claude-project
claude-sessions
claude-temp
claude-cache
claude-data
```

Plus any directory containing `/.claude-` or `/claude_` in its path.

**Examples:** `claude-workspace/`, `project/.claude-temp/`, `src/claude_output/`

### Documentation Files

Claude-generated documentation:

```
claude-notes*.md
claude-notes*.txt
claude-notes*.rst
claude-docs*.md
claude-docs*.txt
claude-docs*.rst
claude-readme*.md
claude-readme*.txt
claude-readme*.rst
claude-instructions*.md
claude-instructions*.txt
claude-instructions*.rst
.claude-*.md
.claude-*.txt
.claude-*.rst
```

**Examples:** `claude-notes.md`, `claude-docs-v2.md`, `claude-readme.txt`, `.claude-instructions.md`

### Scripts & Executables

Claude scripts and executable files:

```
claude-script*
claude-tool*
claude-utility*
claude-helper*
claude*.sh
claude*.bat
claude*.ps1
claude*.py
claude*.js
claude*.ts
```

**Examples:** `claude-script.sh`, `claude-tool.py`, `claude-helper.js`, `claude-init.bat`

### Hidden/Dotfiles

Hidden configuration files and dotfiles:

```
.claude[a-zA-Z0-9]*
```

**Examples:** `.clauderc`, `.claude-config`, `.claudeignore`, `.claude123`

### Numbered/Versioned Files

Files with numbers or version indicators:

```
claude*[0-9]*
claude*v[0-9]*
```

**Examples:** `claude-v1.json`, `claude-session-001.log`, `claude2.config`, `claude-report-v3.md`

## Pattern Safety Features

### Exact Matching

Claude Cleaner uses exact basename matching to prevent false positives:

- **Safe:** `CLAUDE.md` will not match `MY-CLAUDE.md` or `CLAUDE.md.backup`
- **Safe:** `.claude/` will not match `.claude2/` or `my.claude/`
- **Safe:** Patterns only match when the filename/dirname matches exactly (before any extension)

### Pattern Wildcards

Wildcards (`*`) enable flexible matching while maintaining safety:

- `claude-session*` matches any file starting with exactly `claude-session`
- `claude*.json` matches any `.json` file starting with exactly `claude`
- `*claude*` would be dangerous and is **not used** by this tool

## Usage Examples

### Preview Extended Patterns

Always preview before executing to see exactly what will be removed:

```bash
# Preview comprehensive cleanup (recommended first)
claude-cleaner --include-all-common-patterns --verbose
```

### Execute Extended Pattern Cleanup

After reviewing the dry-run output:

```bash
# Execute complete cleanup - find ALL known/possible Claude patterns
claude-cleaner --include-all-common-patterns --execute
```

### Files-Only Extended Cleanup

Remove files only, preserving commit messages:

```bash
# Preview comprehensive file-only cleanup
claude-cleaner --include-all-common-patterns --files-only --verbose

# Execute comprehensive file-only cleanup
claude-cleaner --include-all-common-patterns --files-only --execute
```

## When to Use Extended Patterns

Use `--include-all-common-patterns` when:

- **Preparing repositories for public distribution** - Remove all traces of Claude usage
- **Long-running projects** - Clean up accumulated Claude artifacts over time
- **Complete cleanup needed** - Comprehensive removal of all Claude-related files
- **Unknown artifacts** - Find Claude files you didn't know existed

> [!WARNING]
> The `--include-all-common-patterns` flag finds _many_ more files than standard mode. Always review the dry-run output first before using `--execute`.

## Related Documentation

- [README.md](README.md) - Main user documentation and quick start guide
- [DEV.md](DEV.md) - Development guide and testing information
