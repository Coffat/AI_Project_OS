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

---

## 6. Token Optimization Engine (Hierarchical Context L0–L4)

Hệ thống context engine giải quyết vấn đề token bloat mà không làm mất thông tin quan trọng thông qua 4 thành phần chính:
1. **TokenBudgetManager**: Thực thi ngân sách token nghiêm ngặt, cắt giảm các tầng context vượt quá giới hạn và ghi nhận tỷ lệ nén (`compression ratio`).
2. **ContextDeduplicator**: Phát hiện và loại bỏ thông tin trùng lặp giữa tài liệu kiến trúc, ADRs và code comments. Nếu một tài liệu canonical đã phản ánh đầy đủ ràng buộc, các bản sao trích dẫn sẽ bị loại bỏ kèm lý do giải trình (`reason excluded`).
3. **ContextPrioritizer**: Phân loại mức độ ưu tiên theo tầng:
   - **L0 (Task Objective)**: Mục tiêu nhiệm vụ, tiêu chí hoàn thành, ràng buộc cốt lõi (luôn tải).
   - **L1 (Session Continuity)**: Bước hiện tại, các rào cản (`blockers`), hành động kế tiếp (`next action`).
   - **L2 (Graph Locality)**: Các tệp, biểu tượng (`symbols`), quyết định trực tiếp liên quan đến task.
   - **L3 (Architecture & Constraints)**: Các quy tắc kiến trúc tầng, ràng buộc bảo mật, checklist kiểm thử.
   - **L4 (Broader Project Knowledge)**: Tri thức toàn diện của dự án (chỉ nạp khi ngân sách cho phép).
4. **ContextEstimator**: Ước lượng token chính xác bằng thuật toán Heuristic/BPE mà không tiêu tốn API call đến LLM ngoài.

---

## 7. Security Hardening & Zero-Trust Boundary

AI Project OS áp dụng mô hình phòng thủ theo chiều sâu (Defense-in-Depth):
- **Phân tách Rõ rệt giữa SYSTEM INSTRUCTIONS và UNTRUSTED DATA**:
  - Tệp Markdown trong repository (`README.md`, PR comments, research proposals từ NotebookLM) được phân loại là **Dữ liệu không tin cậy (Untrusted Data)**.
  - Tuyệt đối không để nội dung tệp repository đóng vai trò hướng dẫn thực thi (`System Prompt Hijack`). Mọi đầu vào từ repo được escape và bao bọc trong data delimiters an toàn.
- **AST Parsing thay thế Dynamic Shell Evaluation**: Toàn bộ thao tác phân tích mã nguồn sử dụng Babel parser thuần túy, loại bỏ hoàn toàn nguy cơ Command Injection khi duyệt repo.
- **Bảo vệ Hệ thống Tệp (Filesystem Guard)**: Ngăn chặn triệt để Path Traversal (các mẫu `../`, symlink attacks) thông qua hàm chuẩn hóa `path.resolve` và đối chiếu tiền tố `projectRoot`.
- **Zero-Secret Leakage**: Tự động nhận diện và che giấu (redact) các secret key, token GitHub/OpenAI, thông tin xác thực nhạy cảm trong logs, handoff manifests và error dumps.

---

## 8. Production Readiness & System Doctor

Hệ thống cung cấp module tự chẩn đoán và khắc phục sự cố tích hợp:
- **`DoctorService` (`ai-project-os doctor`)**:
  - Kiểm tra toàn vẹn cơ sở dữ liệu (`PRAGMA integrity_check`, `foreign_key_check`).
  - Kiểm tra trạng thái thư mục hệ thống `.ai/`.
  - Phát hiện các liên kết mồ côi trong đồ thị phụ thuộc (`orphaned edges`) và các phiên làm việc bị treo (`stale sessions`).
  - Kiểm tra tính nhất quán giữa biên bản bàn giao (`CURRENT.json`) và cây Git làm việc.
- **Tự động Khắc phục (`ai-project-os repair`)**: Tái tạo các thư mục cấu trúc bị thiếu, dọn sạch orphaned edges, chuyển trạng thái session chết sang `ended`, và checkpoint WAL.
- **Sao lưu Không Khóa (Zero-Lock Atomic Backup)**: Sử dụng lệnh SQLite chuẩn `VACUUM INTO 'target.sqlite'` kết hợp manifest SHA-256 để tạo bản snapshot point-in-time mà không làm nghẽn tiến trình đọc/ghi đồng thời.

---

## 9. 7 Bất biến Vận hành Cốt lõi (System Invariants)

1. **Task Entity Invariant**: Một nhiệm vụ luôn duy trì duy nhất một `task_id` xuyên suốt mọi phiên làm việc của các agent khác nhau.
2. **Session Continuity Invariant**: Mỗi agent bắt đầu phiên đều được cấp một `session_id` độc lập và được liên kết tuần tự vào lịch sử task.
3. **Uncommitted Diff Awareness**: Agent tiếp theo tiếp quản cùng một cây thư mục làm việc Git luôn nhận được bản tóm tắt chính xác các thay đổi chưa commit của agent trước.
4. **Validation Gate Invariant**: Không một task nào được chuyển sang trạng thái `done` nếu các cổng kiểm tra (unit tests, types, linter) chưa vượt qua.
5. **Knowledge Isolation Invariant**: Đề xuất từ nguồn bên ngoài (như NotebookLM) chỉ được phép lưu vào `.ai/proposals/` và không bao giờ tự động trở thành chỉ dẫn thực thi nếu chưa qua con người phê duyệt.
6. **Granular Memory Invariant**: Bộ biên dịch bộ nhớ chỉ cập nhật đúng các tài liệu tri thức liên quan trực tiếp đến task đã hoàn thành.
7. **Zero External Dependency**: Lõi điều phối vận hành 100% cục bộ trên Node.js và SQLite, không phụ thuộc vào internet, docker daemon hay cloud storage ngoài.
