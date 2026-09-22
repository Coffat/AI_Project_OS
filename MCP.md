# Model Context Protocol (MCP) Specification — AI Project OS

AI Project OS exposes a standards-compliant **Model Context Protocol (MCP)** server over standard input/output (`stdio`) using JSON-RPC 2.0. This allows AI coding agents—such as Antigravity, Claude Code, Cursor, and Gemini CLI—to query project context, record progress, inspect code dependencies, and submit handoffs natively.

---

## 1. Connecting to the MCP Server

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "ai-project-os": {
      "command": "node",
      "args": ["/Users/vuthang/Documents/CofAIOS/dist/src/mcp/server.js"],
      "env": {
        "AI_OS_PROJECT_ROOT": "/path/to/target/project"
      }
    }
  }
}
```

### Cursor & Antigravity Configuration
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

## 2. Available MCP Tools

### 1. `ai_os_get_active_task`
Retrieves details of the currently assigned task, including acceptance criteria, status, and constraints.
- **Parameters**:
  - `taskId` (string, optional): Specific task ID. If omitted, returns current active task.
- **Output**:
  ```json
  {
    "id": "task-uuid",
    "title": "Implement OAuth callback handling",
    "type": "feature",
    "status": "in_progress",
    "acceptanceCriteria": ["Validates state param", "Exchanges code for token"]
  }
  ```

### 2. `ai_os_get_task_context`
Generates a token-budgeted, deduplicated context package (L0–L4) tailored specifically to the task.
- **Parameters**:
  - `taskId` (string, required): Target task ID.
  - `budgetTokens` (number, optional): Max tokens permitted (default: 8,000).
- **Output**:
  ```json
  {
    "taskId": "task-uuid",
    "budgetTokens": 8000,
    "actualTokens": 1476,
    "compressionRatio": "99.7%",
    "levels": ["L0", "L1", "L2", "L3"],
    "markdown": "# Context Package\n..."
  }
  ```

### 3. `ai_os_create_checkpoint`
Saves an interim milestone during task execution.
- **Parameters**:
  - `taskId` (string, required): Target task ID.
  - `summary` (string, required): Description of work done in this milestone.
  - `gitCommitHash` (string, optional): Git commit hash if committed.

### 4. `ai_os_submit_handoff`
Submits an end-of-session handoff report so the next agent can seamlessly resume work without context loss.
- **Parameters**:
  - `taskId` (string, required): Target task ID.
  - `summary` (string, required): High-level summary of changes made.
  - `blockers` (string[], optional): Unresolved blockers or questions.
  - `nextSteps` (string[], required): Actionable steps for the resuming agent.

### 5. `ai_os_query_graph`
Queries the dependency graph for callers, callees, imports, and related architecture decisions around a symbol or file.
- **Parameters**:
  - `query` (string, required): Symbol name (e.g. `handleCallback`) or file path.
  - `depth` (number, optional): Traversal depth (default: 1, max: 3).

### 6. `ai_os_search_knowledge`
Full-text search (FTS5) across canonical architecture, constraints, and ADRs.
- **Parameters**:
  - `query` (string, required): Search query string.
  - `category` (string, optional): Filter by `'decision' | 'architecture' | 'constraint'`.

### 7. `ai_os_record_incremental_lesson`
Records an architectural insight, gotcha, or bug resolution directly into project memory.
- **Parameters**:
  - `taskId` (string, required): Associated task ID.
  - `title` (string, required): Title of the ADR or lesson.
  - `content` (string, required): Detailed rationale and outcome.

---

## 3. Security & Input Sanitization in MCP

All MCP tool invocations are guarded by the `MCPSecurityValidator`:
- **Untrusted Content Containment**: Text returned from repository files is escaped and tagged with `<untrusted_data>` delimiters to prevent prompt injection attacks against LLMs.
- **Filesystem Traversal Prevention**: File paths passed to MCP tools are normalized and constrained within the project boundary; any attempt to access `../../` triggers a security validation error.
- **Secret Redaction**: API keys and tokens are automatically scrubbed before JSON-RPC transmission.
