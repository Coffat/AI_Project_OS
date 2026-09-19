# AI PROJECT OS — DEVELOPMENT ROADMAP

Tài liệu này định hình lộ trình phát triển của hệ thống **AI PROJECT OS** qua các giai đoạn có cấu trúc, kèm tiêu chí hoàn thành (Definition of Done) nghiêm ngặt cho từng phase.

---

## Lộ trình Tổng thể

```
[Phase 1: Foundation & Skeleton]  <-- Giai đoạn hiện tại
              │
              ▼
[Phase 2: Database & Task/Handoff Engine]
              │
              ▼
[Phase 3: Memory Engine & Canonical Sync]
              │
              ▼
[Phase 4: Code Intelligence & Graph Engine]
              │
              ▼
[Phase 5: Context Engine & MCP Server]
              │
              ▼
[Phase 6: Integrations (Obsidian, NotebookLM) & Agent Adapters]
              │
              ▼
[Phase 7: Desktop UI & Tauri Distribution]
```

---

## Chi tiết các Giai đoạn

### Phase 1: Foundation, Architecture & Skeleton (Current)
- [x] Thiết lập cấu trúc thư mục mục tiêu chuẩn (`.ai/`, `src/`, `tests/`).
- [x] Tạo lập các tài liệu nền tảng: `CONSTITUTION.md`, `PROJECT.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`.
- [x] Khởi tạo Git repository và cấu hình `.gitignore`.
- [x] Cấu hình môi trường Node.js / TypeScript, Vitest test runner, ESLint linter.
- [x] Xây dựng khung interface và skeleton classes cho 12 module cốt lõi trong `src/`.
- [x] Tạo unit test nền tảng và bảo đảm pass 100% tests, typecheck và lint.

### Phase 2: Database Layer & Task / Handoff Engine
- Triển khai `SQLiteClient` hỗ trợ in-memory, file-based, WAL mode, migrations.
- Cài đặt đầy đủ `TaskEngine`: Tạo task, chuyển đổi trạng thái (`BACKLOG` -> `READY` -> `IN_PROGRESS` -> `BLOCKED` -> `DONE`), checkpointing.
- Cài đặt `HandoffEngine`: Thu thập uncommitted git diffs, ghi nhận blocker, tự động sinh handoff report dạng markdown lưu tại `.ai/handoff/`.
- Unit tests & integration tests cho luồng Task -> Checkpoint -> Handoff.

### Phase 3: Memory Engine & Canonical Knowledge Sync
- Tạo trình phân tích Markdown với frontmatter cho `.ai/canonical/*.md`.
- Triển khai bộ đồng bộ hóa hai chiều (Two-way Sync) giữa `.ai/canonical/` và bảng SQLite `project_memory`.
- Kích hoạt FTS5 cho `fts_project_memory` và thuật toán tìm kiếm ngữ nghĩa theo từ khóa.
- Cơ chế ghi nhận bài học mới (Incremental Lesson) sau khi task hoàn thành.

### Phase 4: Code Intelligence & Graph Engine
- Tích hợp Tree-sitter cho TypeScript/JavaScript, Python, Rust.
- Trích xuất định danh: functions, classes, methods, imports, exports, interfaces.
- Xây dựng đồ thị phụ thuộc mã nguồn (Code Graph) lưu vào SQLite `graph_nodes` và `graph_edges`.
- Thuật toán duyệt đồ thị (BFS / DFS / Shortest Path) để tìm caller/callee context.

### Phase 5: Context Engine & MCP Server
- Triển khai thuật toán tính Relevance Score cho task: kết hợp FTS5 + lân cận đồ thị Code Graph.
- Thuật toán context budget packing: sinh prompt context vừa vặn trong ngưỡng token quy định.
- Hoàn thiện MCP Server qua stdio JSON-RPC với đầy đủ bộ tools cho AI agents.

### Phase 6: Integrations (Obsidian, NotebookLM) & Agent Adapters
- Tương thích Obsidian: Tự động format liên kết `[[...]]`, tag `#decision`, `#task` và xuất layout đồ thị.
- NotebookLM Export: Đóng gói tài liệu nghiên cứu từ `.ai/research/` thành source pack cho NotebookLM.
- Agent Adapters: Mẫu prompt inject context cho Antigravity, Claude Code, Gemini CLI, Cursor.

### Phase 7: Desktop UI & Tauri App
- Phát triển giao diện React + Vite + Tailwind CSS:
  - Task Kanban Board
  - Interactive Code Graph Visualization
  - Memory & Decisions Browser
  - Handoff Inspector
- Đóng gói ứng dụng desktop đa nền tảng với Tauri (macOS, Linux, Windows).
