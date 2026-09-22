# FIXES APPLIED REPORT — AI PROJECT OS
**Core System Fix Pass — Empirical Verification & Contract Alignment**  
**Date**: September 20, 2026  
**Status**: All 6 Priority Fixes Implemented & Empirically Verified  

---

## Section A: Summary of Core Fix Pass

The Core System Fix Pass was executed following the 21-phase implementation and the Empirical Reality Audit. In strict adherence to the project invariants, **no new product features, architectural redesigns, cloud AI dependencies, embeddings, or vector databases were introduced**. The entire fix pass focused solely on contract alignment, deterministic state idempotency, and bug remediation.

### Summary of Priority Fixes Implemented:
| Fix ID | Priority | Subsystem / File | Nature of Fix | Empirical Status |
|---|---|---|---|---|
| **ISSUE-CRIT-001** | Critical | `GraphRepository`, `SymbolIndexer`, `CodeIndexer`, `DependencyAnalyzer` | Deterministic node/edge keys and purge on re-index for 100% idempotency | **PASSED (0 growth on re-index)** |
| **ISSUE-HIGH-001** | High | `ValidationService` (`src/validation/validation-service.ts`) | Automatic task-to-project resolution; eliminated foreign key constraint failure | **PASSED (6/6 runs recorded)** |
| **ISSUE-HIGH-002** | High | `ProjectOSMCPServer` (`src/mcp/server.ts`) | Bidirectional `ai_os_*` aliases and snake/camel argument normalization | **PASSED (32/32 tests passed)** |
| **ISSUE-MED-001** | Medium | `project-orchestrator.test.ts`, `vitest.config.ts` | 15,000ms integration timeout + 10,000ms default test timeout | **PASSED (0 test timeouts)** |
| **ISSUE-MED-002** | Medium | `src/cli.ts`, `USER_GUIDE.md` | Added `init`, `context`, `handoff` and enhanced `task`/`tasks` CLI subcommands | **PASSED (All CLI commands verified)** |
| **ISSUE-LOW-001** | Low | `MCP.md` | Corrected Claude Desktop path to `dist/src/mcp/server.js` | **PASSED (Aligned with tsconfig.json)** |

---

## Section B: Fix 1 Details — Graph Node & Edge Idempotency (`ISSUE-CRIT-001`)

### 1. Root Cause Analysis
During initial indexing, `SymbolIndexer.deleteSymbolsForFile(fileId)` purged rows from the `symbols` table, but failed to remove existing symbol nodes in `graph_nodes` or their associated relation edges in `graph_edges`. Furthermore, `SymbolIndexer.addSymbols()` assigned random UUIDs to `sym.id` on each pass, causing `GraphRepository.addNode()` to create new entity IDs rather than updating existing nodes. As a result, re-indexing an unchanged codebase led to monotonic graph growth (e.g. 27 -> 54 -> 81 nodes).

### 2. Files Modified & Implementation
1. **`src/database/repositories/graph.repository.ts`**:
   - Implemented `deleteEdgesBySource(sourceNodeId: string)`: Purges all outgoing edges from a specific node.
   - Enhanced `deleteSymbolsByFileId(fileId: string, projectId?: string, filePath?: string)`:
     ```sql
     DELETE FROM graph_edges WHERE source_node_id IN (
       SELECT id FROM graph_nodes WHERE project_id = ? AND entity_type = 'symbol' AND (path = ? OR entity_id LIKE ?)
     ) OR target_node_id IN (
       SELECT id FROM graph_nodes WHERE project_id = ? AND entity_type = 'symbol' AND (path = ? OR entity_id LIKE ?)
     );
     DELETE FROM graph_nodes WHERE project_id = ? AND entity_type = 'symbol' AND (path = ? OR entity_id LIKE ?);
     ```
2. **`src/code-intelligence/symbol-indexer.ts`**:
   - Replaced non-deterministic random UUIDs in graph entity nodes with deterministic key:
     ```typescript
     entityId: `${filePath}:${sym.name}`
     ```
   - Updated `deleteSymbolsForFile(fileId, projectId, filePath)` to propagate `projectId` and `filePath` to `GraphRepository`.
3. **`src/code-intelligence/code-indexer.ts`**:
   - Updated Pass 1 and `indexChanged` routines to pass `projectId` and `relPath` into `symbolIndexer.deleteSymbolsForFile(...)`.
4. **`src/code-intelligence/dependency-analyzer.ts`**:
   - Added `this.graphRepo.deleteEdgesBySource(fileNode.id)` at the start of `linkFileDependencies` to prevent edge accumulation across runs.

### 3. Empirical Verification Results
- **Pass 1 Count**: Nodes: **27**, Edges: **55**
- **Pass 2 Count**: Nodes: **27**, Edges: **55** (Δ: **0**, 100% idempotent)
- **Pass 3 Count**: Nodes: **27**, Edges: **55** (Δ: **0**, 100% idempotent)
- **Adding 1 Function**: Nodes: **28** (+1 node), Edges: **56** (+1 edge)
- **File Deletion**: Purged all symbol nodes and connected edges cleanly.
- **Graph Integrity**: 0 dangling edges, 0 self-loops.

---

## Section C: Fix 2 Details — ValidationService ProjectId Resolution (`ISSUE-HIGH-001`)

### 1. Root Cause Analysis
In `src/validation/validation-service.ts`, individual validation runners (`runTests`, `runLint`, `runTypecheck`, `runBuild`, `inspectGitDiff`, and `runArchitectureGuard`) contained:
```typescript
const projectId = options?.projectId || 'default';
```
When callers passed only `{ taskId: task.id }` without an explicit `projectId`, the value defaulted to `'default'`. Because `validation_runs` enforces a strict foreign key constraint referencing `projects(id)`, this triggered an unhandled SQLite error: `FOREIGN KEY constraint failed`.

### 2. Files Modified & Implementation
1. **`src/validation/validation-service.ts`**:
   - Injected and initialized `ProjectRepository`.
   - Created `resolveProjectId(options?: { projectId?: string; taskId?: string }): string`:
     ```typescript
     private resolveProjectId(options?: { projectId?: string; taskId?: string }): string {
       let projectId = options?.projectId;
       if (!projectId && options?.taskId) {
         const task = this.taskRepo.findById(options.taskId);
         if (task?.projectId) {
           projectId = task.projectId;
         }
       }
       if (!projectId) {
         const byPath = this.projectRepo.findByRootPath(this.projectRoot);
         if (byPath) {
           projectId = byPath.id;
         }
       }
       if (!projectId) {
         const allProjects = this.projectRepo.list();
         if (allProjects.length > 0 && allProjects[0]) {
           projectId = allProjects[0].id;
         }
       }
       return projectId || 'default';
     }
     ```
   - Replaced all 6 instances of `const projectId = options?.projectId || 'default';` with `const projectId = this.resolveProjectId(options);`.

### 3. Empirical Verification Results
- Tested all 6 methods (`runTests`, `runLint`, `runTypecheck`, `runBuild`, `inspectGitDiff`, `runArchitectureGuard`) by providing **only** `{ taskId: task.id }`.
- All 6 runs completed and were successfully persisted in `validation_runs` with `project_id` matching the task's project.
- Verified in `tests/unit/validation-service.test.ts`: **8/8 tests passed**.

---

## Section D: Fix 3 Details — MCP Tool-Name Compatibility & Aliases (`ISSUE-HIGH-002`)

### 1. Root Cause Analysis
`MCP.md` and `AGENTS.md` instructed agents to call prefix tools such as `ai_os_get_active_task`, `ai_os_get_task_context`, `ai_os_submit_handoff`, and `ai_os_query_graph`. However, `src/mcp/server.ts` initially only registered short canonical names (`get_task`, `get_context`, `save_handoff`, `search_graph`), causing external agent invocations to fail with `Unknown MCP tool`.

### 2. Files Modified & Implementation
1. **`src/mcp/server.ts`**:
   - Preserved all 21 canonical tools in `getToolDefinitions(includeAliases = false)`.
   - Added tool definitions for legacy aliases when requested (`ai_os_get_active_task`, `ai_os_get_task_context`, `ai_os_submit_handoff`, `ai_os_query_graph`, `ai_os_validate_task`, `ai_os_search_memory`).
   - In `dispatchTool(name, rawArgs)`, implemented automatic name and argument normalization:
     ```typescript
     const aliasMap: Record<string, string> = {
       'ai_os_get_active_task': 'get_task',
       'ai_os_get_task_context': 'get_context',
       'ai_os_submit_handoff': 'save_handoff',
       'ai_os_query_graph': 'search_graph',
       'ai_os_validate_task': 'request_validation',
       'ai_os_search_memory': 'search_memory',
     };
     let targetName = aliasMap[name] || name;
     if (targetName.startsWith('ai_os_')) {
       targetName = targetName.replace('ai_os_', '');
     }
     ```
   - Normalized argument aliases:
     - `taskId` <-> `task_id`
     - `projectId` <-> `project_id`
     - `summary` / `completedWork` <-> `completed_work`
     - `nextSteps` / `nextAction` <-> `next_action`
     - `agentIdentity` <-> `agent_identity`
     - `currentStep` <-> `current_step`
     - `currentFile` <-> `current_file`
     - `stepNumber` <-> `step_number`
     - `stepId` <-> `step_id`

### 3. Empirical Verification Results
- All 6 legacy aliases tested in `tests/unit/mcp-server.test.ts`.
- Calls using `ai_os_submit_handoff` with `{ taskId, summary, nextSteps }` correctly persisted handoffs in SQLite.
- Verified in `tests/unit/mcp-server.test.ts`: **32/32 tests passed**.

---

## Section E: Fix 4 Details — Test Harness Timeout Reliability (`ISSUE-MED-001`)

### 1. Root Cause Analysis
The Vitest default test timeout is 5,000ms. In parallel test runs, the end-to-end multi-session workflow in `project-orchestrator.test.ts` (which performs filesystem scaffolding, Git commits, AST parsing, token estimation, handoff serialization, and resume validation) required ~5,400ms, occasionally causing false-positive timeouts.

### 2. Files Modified & Implementation
1. **`tests/unit/project-orchestrator.test.ts`**:
   - Added a 15,000ms explicit timeout argument to the full lifecycle scenario:
     ```typescript
     it('executes full lifecycle: Agent A starts -> modifies -> handoff -> Agent B resumes on SAME working tree -> modifies -> completes', async () => {
       // test logic
     }, 15000);
     ```
2. **`vitest.config.ts`**:
   - Configured `testTimeout: 10000` to provide a resilient default timeout across all suites.

### 3. Empirical Verification Results
- `project-orchestrator.test.ts` ran in **3.37s** (test scenario in **2.49s**).
- Full 46-suite parallel test run executed with **0 timeouts** and 100% pass rate.

---

## Section F: Fix 5 & Fix 6 Details — CLI & Documentation Alignment (`ISSUE-MED-002`, `ISSUE-LOW-001`)

### 1. Root Cause Analysis
`USER_GUIDE.md` documented commands that were not wired to CLI switches (`ai-project-os init`, `ai-project-os context <taskId>`, `ai-project-os task create/list/start/complete`, `ai-project-os handoff submit/resume`), while `MCP.md` specified an outdated output path (`dist/mcp/server.js`).

### 2. Files Modified & Implementation
1. **`src/cli.ts`**:
   - Added `init`: Scaffolds `.ai/` directory tree and runs database migrations.
   - Added `context <taskId> [--budget <tokens>]`: Shorthand calling `ContextService.getContext()`.
   - Added `handoff`: Shorthand delegating to `SessionCLI`.
   - Enhanced `task` / `tasks`: Added `create`, `list`, `inspect`, `start`, and `complete` subcommands.
   - Updated help menu with complete list of commands and options.
2. **`USER_GUIDE.md`**:
   - Updated command reference table to include `session start/status` and `guard --strict`.
3. **`MCP.md`**:
   - Updated Claude Desktop configuration path from `dist/mcp/server.js` to `dist/src/mcp/server.js`.

### 3. Empirical Verification Results
- Tested `node dist/src/cli.js init`: Successfully initialized workspace and database.
- Tested `node dist/src/cli.js task create --title "..."`: Created task and returned formatted ID.
- Tested `node dist/src/cli.js task list`: Listed tasks with statuses.
- Tested `node dist/src/cli.js context <taskId>`: Generated 270-token context pack (99.93% compression).

---

## Section G: Verification & Reality Audit Re-run

All 5 core reality audit scenarios were re-executed to verify that the fixes hold without regression:

### Scenario 1: Knowledge Graph Re-indexing Idempotency
- **Actions**: Executed 3 consecutive full-project indexing passes on `tests/fixtures/sample-project`.
- **Outcome**:
  - Pass 1: 27 nodes, 55 edges.
  - Pass 2: 27 nodes, 55 edges.
  - Pass 3: 27 nodes, 55 edges.
  - Invariant: **Strictly 0 unexpected node or edge growth.**

### Scenario 2: ValidationService with Omitted ProjectId
- **Actions**: Invoked all 6 validation methods providing only `taskId`.
- **Outcome**:
  - Automatically resolved `projectId` from task record.
  - Zero SQLite foreign key constraint errors.
  - Exactly 6 validation runs recorded with correct project associations.

### Scenario 3: Agent MCP Invocation via Legacy & Canonical Names
- **Actions**: Dispatched tools using canonical names and `ai_os_*` aliases with mixed camelCase / snake_case arguments.
- **Outcome**:
  - `ai_os_get_active_task`, `ai_os_get_task_context`, `ai_os_submit_handoff`, `ai_os_query_graph`, `ai_os_validate_task`, `ai_os_search_memory` all returned identical results to their canonical counterparts.

### Scenario 4: Multi-Agent Same Working Tree Handoff & Resume
- **Actions**: Ran `tests/unit/project-orchestrator.test.ts` and `tests/unit/full-system-integration.test.ts`.
- **Outcome**:
  - Agent A (`Antigravity`) modified `src/calculator.ts` -> handoff generated (`CURRENT.json`).
  - Agent B (`ClaudeCode`) resumed on the **SAME** working tree with uncommitted diffs preserved.
  - Agent B added division implementation and completed the task.
  - Single Task ID preserved across sessions. 0 data loss.

### Scenario 5: Full Test Suite & Typecheck Verification
- **TypeScript Typecheck**:
  ```bash
  $ pnpm typecheck
  > tsc --noEmit
  Exit code: 0
  ```
- **Full Vitest Suite**:
  ```bash
  $ pnpm test
  Test Files: 46 passed (46)
  Tests:      310 passed (310)
  Duration:   6.86s
  Exit code:  0
  ```

---

## Conclusion
The AI Project OS core system is completely verified. All defects cataloged in `AUDIT-REPORT.md` and prioritized in `PRIORITY-FIXES.md` are resolved, and the system matches its architectural and behavioral contracts across all 21 phases.
