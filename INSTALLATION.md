# Installation & Setup Guide — AI Project OS

AI Project OS is a local-first, zero-external-dependency orchestration operating system designed for AI coding agents (Antigravity, Claude Code, Gemini CLI, Cursor, and human developers).

---

## 1. Prerequisites

Before installing AI Project OS, ensure your development workstation meets the following minimum requirements:

| Component | Minimum Version | Recommended | Rationale |
|---|---|---|---|
| **Node.js** | `>= 22.0.0` | `22.12.0 LTS` | Required for native `node:sqlite` (`DatabaseSync`) and modern web streams |
| **npm** | `>= 10.0.0` | `10.8.0+` | Package management and script orchestration |
| **Git** | `>= 2.30.0` | Latest | Required for atomic commit tracking, diff generation, and working tree analysis |
| **Operating System** | macOS, Linux, Windows (WSL2) | macOS / Linux | Fully tested across POSIX and Unix environments |

> [!IMPORTANT]
> Node.js version 22.0.0 or higher is strictly required because AI Project OS leverages the built-in, zero-dependency `node:sqlite` native module with WAL (Write-Ahead Logging) mode and full-text search (FTS5).

---

## 2. Installation Methods

### Option A: Local Workspace Integration (Recommended)

Clone and build the repository locally:

```bash
# 1. Clone repository
git clone https://github.com/vuthang/CofAIOS.git
cd CofAIOS

# 2. Install dependencies
npm install

# 3. Build the TypeScript production package
npm run build

# 4. Link CLI globally on your workstation
npm link
```

Verify that the CLI executable is available in your PATH:

```bash
ai-project-os --version
```

### Option B: Installing as a Development Dependency

You can also install AI Project OS directly into an existing software project:

```bash
npm install --save-dev ai-project-os
npx ai-project-os --version
```

---

## 3. Initializing a Workspace

To enable AI Project OS within any software repository, navigate to the target project root and run:

```bash
cd /path/to/your/project
ai-project-os init
```

This command executes the deterministic bootstrapping sequence:
1. Creates the `.ai/` directory structure:
   - `.ai/state/` — Contains SQLite databases (`project-os.sqlite`, WAL files).
   - `.ai/canonical/` — The canonical human-readable memory store (`PROJECT.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DECISIONS/`).
   - `.ai/handoff/` — Contains active and historical agent handoff manifests (`CURRENT.json`, `archive/`).
   - `.ai/tasks/` — Task execution state and session logs.
   - `.ai/proposals/` — Quarantined research and external proposals awaiting approval.
   - `.ai/backups/` — Point-in-time snapshots and disaster recovery archives.
2. Initializes the relational schema and full-text search (FTS5) indexes.
3. Automatically scans and registers project metadata, Git remotes, and architecture rules.

---

## 4. Configuring Agent Integrations (MCP)

AI Project OS exposes an enterprise-grade Model Context Protocol (MCP) server over `stdio` JSON-RPC.

### Claude Desktop Configuration

Add the server to your `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "ai-project-os": {
      "command": "node",
      "args": ["/absolute/path/to/CofAIOS/dist/mcp/server.js"],
      "env": {
        "AI_OS_PROJECT_ROOT": "/path/to/your/workspace"
      }
    }
  }
}
```

### Antigravity & Cursor Configuration

In `.gemini/antigravity/mcp/` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ai-project-os": {
      "command": "ai-project-os",
      "args": ["mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

---

## 5. Verifying Installation Health

Run the built-in system diagnostics to verify your configuration:

```bash
ai-project-os doctor
```

Expected output for a healthy workspace:
```
🩺 AI PROJECT OS — SYSTEM DOCTOR
================================================================================
Timestamp:    2026-09-20T14:40:00.000Z
Project Root: /path/to/your/workspace
Health Status: HEALTHY

SYSTEM INTEGRITY CHECKS:
[PASS] SQLite Database Integrity: PRAGMA integrity_check returned ok
[PASS] Foreign Key Constraints: All relational foreign key references are intact
[PASS] Database Journal Mode: Current journal mode is WAL
[PASS] Filesystem State Directories: All .ai runtime and state directories are present
[PASS] Canonical Memory Files: All required canonical markdown files exist with valid headers
[PASS] Code Intelligence Index Freshness: 42 file(s) indexed in code intelligence graph
[PASS] Handoff State Integrity: No current handoff pending (clean state)

DIAGNOSTIC SUMMARY:
Passed: 7 | Warnings: 0 | Errors: 0
================================================================================
```

If any check fails or warns, run self-repair:

```bash
ai-project-os repair
```
