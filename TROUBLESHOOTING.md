# Troubleshooting & Recovery Guide — AI Project OS

This guide provides systematic diagnostic and remediation procedures for resolving runtime errors, database anomalies, index staleness, and session interruptions in AI Project OS.

---

## 1. Quick Diagnostic Checklist

When encountering any unexpected behavior, always start by running the built-in system doctor:

```bash
ai-project-os doctor
```

If issues are detected, execute automatic self-repair:

```bash
ai-project-os repair
```

If self-repair does not resolve the condition, consult the specific scenarios below.

---

## 2. Common Scenarios & Remediation

### Scenario A: SQLite Database Locked / WAL Congestion

**Symptom**:
- Error message: `SqliteError: database is locked` or `busy timeout`.
- The `.ai/state/project-os.sqlite-wal` file grows abnormally large.

**Root Cause**:
An uncheckpointed Write-Ahead Log (WAL) or a lingering SQLite connection that failed to close gracefully following an unhandled crash.

**Remediation**:
1. Terminate any hanging background Node.js or MCP processes:
   ```bash
   pkill -f "ai-project-os"
   ```
2. Run self-repair to force a WAL checkpoint and vacuum:
   ```bash
   ai-project-os repair
   ```
3. Alternatively, force checkpoint manually via SQLite CLI:
   ```bash
   sqlite3 .ai/state/project-os.sqlite "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"
   ```

---

### Scenario B: Stale or Inaccurate Code Intelligence Index

**Symptom**:
- `ai-project-os context` does not find recently added files or exports.
- Graph queries return outdated line ranges or missing callers/callees.

**Root Cause**:
Files were created or modified outside of the tracked Git working tree without triggering an indexing update.

**Remediation**:
1. Re-index the codebase:
   ```bash
   ai-project-os reindex
   ```
2. Rebuild the complete dependency and AST symbol graph:
   ```bash
   ai-project-os rebuild-graph
   ```

---

### Scenario C: Corrupted Handoff State (`CURRENT.json`)

**Symptom**:
- `ai-project-os doctor` reports: `Failed to parse .ai/handoff/CURRENT.json` or `Handoff state diverges from working tree`.
- Resuming agent fails to load previous session context.

**Root Cause**:
An agent process was forcibly terminated midway through serializing `.ai/handoff/CURRENT.json`, leaving incomplete JSON on disk.

**Remediation**:
Run self-repair:
```bash
ai-project-os repair
```
The repair engine will automatically archive the malformed file to `.ai/handoff/CURRENT.corrupted.<timestamp>.json` and reset the active handoff pointer to a clean state.

---

### Scenario D: Orphaned Graph Edges & Foreign Key Violations

**Symptom**:
- `ai-project-os doctor` reports foreign key violations or dangling graph edges.
- Graph queries crash with entity lookup errors.

**Root Cause**:
Files or symbols were deleted from the project, but residual relational rows remained in `graph_edges`.

**Remediation**:
1. Automatically purge orphaned edges:
   ```bash
   ai-project-os repair
   ```
2. Rebuild the graph from scratch:
   ```bash
   ai-project-os rebuild-graph
   ```

---

### Scenario E: Stale or Zombie Execution Sessions

**Symptom**:
- `ai-project-os doctor` reports: `Found X stale/interrupted session(s) exceeding timeout`.
- Agents complain that a task is locked by an active session that is no longer running.

**Root Cause**:
An agent exited without invoking `handoff` or `complete`, leaving its session marked as `active` in SQLite.

**Remediation**:
Run repair to transition all sessions older than 60 minutes into the `ended` state:
```bash
ai-project-os repair
```

---

## 3. Disaster Recovery: Backup & Restore

AI Project OS features point-in-time, zero-lock snapshot backups using SQLite `VACUUM INTO` combined with SHA-256 manifest verification.

### Creating a Backup
```bash
ai-project-os backup ./backups
```
Output:
```
Backed up state to: ./backups/backup-1726843200000
Manifest created with SHA-256 checksums for 14 files.
```

### Restoring from Backup
```bash
ai-project-os restore ./backups/backup-1726843200000 --force
```
The restore command automatically:
1. Validates the integrity and SHA-256 checksums of all backup files against `manifest.json`.
2. Creates a safety rollback snapshot of the current workspace (`.ai/backups/pre-restore-<timestamp>`).
3. Replaces `.ai/state/project-os.sqlite` and all canonical memory directories.
4. Verifies database schema and runs PRAGMA integrity checks.

---

## 4. Resetting Workspace to Clean State

If the local `.ai/` directory becomes irreparably damaged:
```bash
# 1. Back up any notes or decisions you wrote
cp -r .ai/canonical/DECISIONS /tmp/saved-decisions

# 2. Re-initialize workspace
ai-project-os init

# 3. Restore your custom decisions
cp -r /tmp/saved-decisions/* .ai/canonical/DECISIONS/

# 4. Reindex
ai-project-os reindex
ai-project-os rebuild-graph
```
