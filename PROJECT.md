# AI PROJECT OS

> **Hệ điều hành Quản trị Ngữ cảnh, Bộ nhớ, Handoff & Trí tuệ Mã nguồn Cục bộ dành cho AI Coding Agents.**

---

## 1. Bối cảnh & Vấn đề cốt lõi

Trong kỷ nguyên lập trình cùng AI (Agentic Coding), các nhà phát triển và đội ngũ kỹ thuật đối mặt với các nút thắt cố hữu:

1. **Context Amnesia & Ephemeral Chat**: Khi một phiên chat (conversation) đầy hoặc bị gián đoạn, ngữ cảnh dự án bị biến mất. Agent mới không biết agent cũ đã làm gì, tại sao lại viết code như vậy.
2. **Context Window Saturation**: Việc ném toàn bộ codebase vào context của LLM gây lãng phí chi phí token, tăng độ trễ (latency) và khiến model dễ hallucinate hoặc quên các quy tắc quan trọng.
3. **Multi-Agent / Multi-Account Collaboration**: Khi nhiều agent (hoặc các account khác nhau) cùng làm việc trên một working tree, xung đột về context và thiếu cơ chế handoff đồng bộ khiến công việc bị đứt gãy.
4. **Knowledge Drift**: Các quyết định kiến trúc, quy ước code và bài học sửa lỗi chỉ nằm rải rác trong log chat thay vì được tích lũy có hệ thống vào tài liệu dự án.

---

## 2. Tầm nhìn & Mục tiêu của AI Project OS

**AI PROJECT OS** được thiết kế như một lớp nền tảng cục bộ (Local-first OS Layer) nằm giữa Codebase và các AI Coding Agent:

- **Task-Centric Lifecycle**: Tách biệt hoàn toàn khái niệm Task khỏi Conversation. Conversation có thể kết thúc nhưng Task vẫn tồn tại với đầy đủ checkpoint, diff, mục tiêu và blockers.
- **Incremental Project Memory**: Tri thức dự án được cập nhật tăng dần sau mỗi task hoàn tất, đảm bảo bộ nhớ dự án sống cùng mã nguồn.
- **High-Precision Context Retrieval**: Sử dụng Tree-sitter AST, SQLite FTS5 và Relational Code Graph để chỉ nạp vào context những lát cắt code, quyết định kiến trúc và ràng buộc thực sự liên quan.
- **Dual Knowledge Layer**:
  - **Obsidian**: Giao diện tri thức cho con người (Human-in-the-loop) thông qua Markdown chuẩn và liên kết hai chiều.
  - **NotebookLM**: Lớp nghiên cứu sâu và tri thức mở rộng bên ngoài.
  - **SQLite**: Máy trạng thái, index tốc độ cao và quan hệ đồ thị cho máy đọc.
- **Giao tiếp qua Chuẩn Mở MCP (Model Context Protocol)**: Cho phép bất kỳ AI agent nào (Antigravity, Claude Code, Gemini CLI, Cursor, OpenAI) truy cập dữ liệu và công cụ của Project OS một cách thống nhất.

---

## 3. Khách hàng & Tác nhân thụ hưởng

1. **AI Coding Agents**: Truy cập qua MCP Server để lấy task, đọc context được tinh gọn sẵn, ghi nhận checkpoint và thực hiện handoff.
2. **Software Engineers / Tech Leads**: Kiểm soát tiến độ task, xem sơ đồ quan hệ code, rà soát quyết định kiến trúc thông qua giao diện Obsidian hoặc Desktop UI.

---

## 4. Phạm vi MVP (Minimum Viable Product)

- [x] **Bootstrap Architecture & Skeleton**: Thiết kế module rành mạch, tài liệu chuẩn hiến chương, thiết lập test runner và cơ sở dữ liệu SQLite.
- [ ] **Task Engine & Handoff Engine**: Khởi tạo, theo dõi, lưu trữ trạng thái task và sinh bản tóm tắt chuyển giao (handoff report).
- [ ] **Memory Engine**: Đồng bộ hai chiều giữa tài liệu `.ai/canonical/*.md` và SQLite state store.
- [ ] **Code Intelligence & Graph Engine**: Phân tích AST qua Tree-sitter, lập chỉ mục symbol và xây dựng quan hệ dependency giữa các file/class/function.
- [ ] **Context Engine**: Thuật toán tính toán relevance score để sinh context pack tối ưu theo task ID.
- [ ] **MCP Server**: Triển khai các MCP tools chuẩn (`get_task`, `submit_handoff`, `query_symbols`, `get_architecture_rules`).
- [ ] **Desktop UI (Tauri + React)**: Bảng điều khiển cục bộ hiển thị task board, tri thức dự án và trạng thái agent.
