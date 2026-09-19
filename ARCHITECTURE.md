# AI PROJECT OS — ARCHITECTURE SPECIFICATION

---

## 1. Tổng quan kiến trúc (High-Level Architecture)

AI PROJECT OS được thiết kế theo mô hình **Hexagonal Architecture (Ports and Adapters)** kết hợp **Local-first Event-Driven Core**. Kiến trúc đảm bảo domain logic hoàn toàn độc lập với các giao diện bên ngoài (MCP Server, Desktop UI, Agent Adapters) và nguồn lưu trữ (SQLite, Git, File System).

```
+-------------------------------------------------------------------------------+
|                             CLIENTS & AGENTS                                  |
|   [Antigravity]     [Claude Code]     [Gemini CLI]     [Cursor]     [Human]   |
+---------+-----------------+-----------------+-------------+--------------+----+
          |                 |                 |             |              |
          v                 v                 v             v              v
+-------------------+---------------------------------------+      +------------+
| Agent Adapters    |            MCP Server                 |      | Desktop UI |
| (Prompt/Envelope) | (Tools: task, handoff, context, graph)|      | (React/Vite|
+---------+---------+-------------------+-------------------+      |  + Tauri)  |
          |                             |                          +-----+------+
          +----------------------+      |                                |
                                 v      v                                v
+-------------------------------------------------------------------------------+
|                               APPLICATION SERVICES                            |
|  +--------------------+ +--------------------+ +----------------------------+ |
|  |    Task Engine     | |   Handoff Engine   | |      Context Engine        | |
|  +---------+----------+ +---------+----------+ +-------------+--------------+ |
|            |                      |                          |                |
|  +---------v----------+ +---------v----------+ +-------------v--------------+ |
|  |   Memory Engine    | |  Validation Engine | |   Code Intelligence Engine | |
|  +---------+----------+ +---------+----------+ +-------------+--------------+ |
|            |                      |                          |                |
|            +----------------------+--------------------------+                |
|                                   v                                           |
|                            Graph Engine                                       |
+-----------------------------------+-------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------------+
|                               INFRASTRUCTURE LAYER                            |
|  +---------------------------+ +-------------------+ +---------------------+  |
|  | SQLite (FTS5 + Relational | | .ai/canonical/    | | Git CLI Engine      |  |
|  | State, Indexes, Graph)    | | (Markdown Truth)  | | (Source of Truth)   |  |
|  +---------------------------+ +-------------------+ +---------------------+  |
|  +---------------------------+ +-------------------+                          |
|  | Obsidian Integration Vault| | NotebookLM Export |                          |
|  +---------------------------+ +-------------------+                          |
+-------------------------------------------------------------------------------+
```

---

## 2. Các Module và Ranh giới Trách nhiệm (Boundaries & Responsibilities)

| Module | Thư mục | Trách nhiệm chính | Phụ thuộc cho phép |
|---|---|---|---|
| **Core** | `src/core/` | Chứa Domain Entities, Interfaces, Event Bus, Custom Errors, Config Schemas. | Không phụ thuộc module nào khác. |
| **Database** | `src/database/` | Quản lý kết nối SQLite, migrations, khởi tạo bảng và FTS5 virtual tables, thực thi transaction an toàn. | `src/core/` |
| **Tasks** | `src/tasks/` | Quản lý vòng đời task (`BACKLOG`, `IN_PROGRESS`, `BLOCKED`, `DONE`), checkpoints, gán việc, tiêu chí nghiệm thu. | `src/core/`, `src/database/` |
| **Handoff** | `src/handoff/` | Ghi nhận trạng thái chuyển giao ca làm việc của agent: uncommitted diffs, blockers, next steps, context dump. | `src/core/`, `src/database/`, `src/tasks/` |
| **Memory** | `src/memory/` | Đọc và đồng bộ hai chiều giữa tài liệu Markdown trong `.ai/canonical/` và SQLite cache; ghi nhận incremental lessons. | `src/core/`, `src/database/` |
| **Code Intelligence** | `src/code-intelligence/` | Phân tích cú pháp AST (Tree-sitter), trích xuất symbols (classes, methods, functions, interfaces), export call hierarchies. | `src/core/`, `src/database/` |
| **Graph** | `src/graph/` | Quản lý đồ thị tri thức và quan hệ code (Nodes: Files, Symbols, Tasks, Decisions; Edges: CALLS, IMPORTS, DEPENDS_ON). | `src/core/`, `src/database/` |
| **Context** | `src/context/` | Thuật toán xếp hạng độ liên quan (BM25 FTS5 + Graph distance) để lắp ráp Context Window tối ưu token cho Task. | `src/core/`, `src/database/`, `src/graph/` |
| **Validation** | `src/validation/` | Kiểm tra tính nhất quán của task, schema markdown `.ai/canonical/`, và tiêu chí acceptance trước khi đóng task. | `src/core/` |
| **Integrations** | `src/integrations/` | Cầu nối xuất nhập liệu cho Obsidian (bi-directional links `[[...]]`) và NotebookLM research packages. | `src/core/`, `src/memory/` |
| **MCP** | `src/mcp/` | Model Context Protocol Server cung cấp JSON-RPC interfaces qua stdio cho các AI coding agents. | `src/core/`, all application engines |
| **Agents** | `src/agents/` | Cung cấp adapter định dạng payload/prompt cho từng công cụ (Antigravity, Claude, Gemini, OpenAI) mà không chứa business logic. | `src/core/` |
| **UI** | `src/ui/` | Giao diện máy tính để bàn (React/Vite/Tailwind) hiển thị Kanban tasks, Code Graph viewer, Memory Explorer. | HTTP/IPC hoặc Direct Engine Service |

---

## 3. Database Schema (SQLite Relational + FTS5 + Graph)

### 3.1 Bảng Thực thể Chính

```sql
-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tasks: Đơn vị công việc độc lập với conversation
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('BACKLOG', 'READY', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE')),
    assigned_agent TEXT,
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    parent_task_id TEXT,
    acceptance_criteria TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Task Checkpoints: Điểm mốc snapshot trong quá trình thực thi
CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    git_commit_hash TEXT,
    agent_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Handoffs: Biên bản bàn giao giữa các phiên làm việc của Agent
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    status_summary TEXT NOT NULL,
    blockers TEXT,
    next_steps TEXT NOT NULL,
    context_snapshot_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Project Memory: Tri thức dự án được cache từ .ai/canonical/*.md
CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('CONSTITUTION', 'ARCHITECTURE', 'CONSTRAINT', 'DECISION', 'LESSON')),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_file TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Graph Nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('FILE', 'SYMBOL', 'TASK', 'DECISION', 'MODULE')),
    identifier TEXT NOT NULL,
    label TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Graph Edges
CREATE TABLE IF NOT EXISTS graph_edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('IMPORTS', 'CALLS', 'IMPLEMENTS', 'DEPENDS_ON', 'DECIDED_BY', 'AFFECTS')),
    weight REAL DEFAULT 1.0,
    metadata_json TEXT,
    PRIMARY KEY (source_id, target_id, relation_type),
    FOREIGN KEY(source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);
```

### 3.2 Bảng Full-Text Search (FTS5)

```sql
-- FTS5 Index cho Project Memory
CREATE VIRTUAL TABLE IF NOT EXISTS fts_project_memory USING fts5(
    memory_id UNINDEXED,
    title,
    content,
    category,
    source_file
);

-- FTS5 Index cho Code Symbols
CREATE VIRTUAL TABLE IF NOT EXISTS fts_code_symbols USING fts5(
    node_id UNINDEXED,
    identifier,
    label,
    file_path,
    documentation
);
```

---

## 4. MCP (Model Context Protocol) Server Specification

MCP Server đóng vai trò là "Cổng kết nối" cho các AI agent với hệ thống. Server chạy qua giao thức `stdio` JSON-RPC 2.0.

### 4.1 Danh sách Tools cung cấp cho Agent

1. `ai_os_get_active_task(task_id?)`: Lấy thông tin task đang kích hoạt, bao gồm mô tả, tiêu chí nghiệm thu và trạng thái hiện tại.
2. `ai_os_get_task_context(task_id, budget_tokens?)`: Lấy context pack được tính toán chính xác cho task hiện tại (chứa canonical architecture rules, code slices liên quan, ADRs).
3. `ai_os_create_checkpoint(task_id, summary, git_commit_hash?)`: Tạo checkpoint ghi nhận tiến độ công việc.
4. `ai_os_submit_handoff(task_id, summary, blockers, next_steps)`: Nộp biên bản bàn giao khi agent chuẩn bị kết thúc phiên làm việc hoặc cạn token.
5. `ai_os_query_graph(symbol_or_path, depth?)`: Truy vấn quan hệ dependency, callers/callees xung quanh một file hoặc function.
6. `ai_os_search_knowledge(query, category?)`: Tìm kiếm tri thức trong `.ai/canonical/` bằng FTS5.
7. `ai_os_record_incremental_lesson(task_id, lesson_title, lesson_content)`: Ghi nhận bài học kinh nghiệm mới để Memory Engine cập nhật vào `.ai/canonical/DECISIONS/`.

---

## 5. Khả năng phục hồi & Đồng bộ (Resilience & Sync Policy)

- **Tái lập chỉ mục (Re-indexing)**: SQLite hoàn toàn có thể xóa đi và xây lại (`ai-os reindex`) bất cứ lúc nào từ mã nguồn Git và các tệp `.ai/canonical/*.md`.
- **Obsidian Vault Friendly**: Mọi tệp trong `.ai/` đều là chuẩn Markdown GitHub Flavored với YAML Frontmatter và tương thích hoàn toàn với Obsidian Graph View.
- **Tiến trình chuyển đổi Rust**: Khi khối lượng phân tích mã nguồn (AST parsing, Call Graph traversal) trên các repo hàng trăm nghìn dòng code đòi hỏi hiệu năng CPU cao, các subroutines của `code-intelligence` và `graph` có thể được chuyển sang Rust native crate được gọi qua NAPI-RS hoặc Tauri Core mà không làm biến đổi domain API của TypeScript.
