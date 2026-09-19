# ADR 0001: Khởi tạo kiến trúc nền tảng AI PROJECT OS

- **Ngày quyết định**: 2026-09-19
- **Trạng thái**: Accepted
- **Tác giả**: Lead Software Architect

## Bối cảnh
Cần xây dựng một hệ thống local-first đóng vai trò là "Project Memory + Context + Handoff + Code Intelligence OS" dành cho các AI coding agent, giải quyết bài toán mất mát ngữ cảnh khi phiên hội thoại kết thúc, và tối ưu hóa context window của LLM.

## Quyết định
1. **Kiến trúc**: Áp dụng Hexagonal Architecture (Ports and Adapters). Core domain độc lập hoàn toàn với storage và UI.
2. **Nguồn chân lý**:
   - Git/Codebase: Implementation source of truth.
   - `.ai/canonical/*.md`: Project knowledge source of truth.
   - SQLite: Relational state, graph & FTS5 search index (sử dụng `node:sqlite` tích hợp sẵn trong Node runtime nhằm loại bỏ phụ thuộc C++ gyp compilation, đảm bảo local-first zero-bloat).
3. **Giao tiếp Agent**: Sử dụng Model Context Protocol (MCP) chuẩn qua stdio JSON-RPC.
4. **Ngôn ngữ**: TypeScript/Node.js cho giai đoạn đầu với ranh giới module rõ ràng, sẵn sàng port các thuật toán nặng sang Rust native crate khi cần.

## Hệ quả
- Khả năng kiểm thử độc lập cao.
- Không bị phụ thuộc vào một nhà cung cấp AI cụ thể.
- Hệ thống có khả năng tự phục hồi (re-indexable) từ file markdown và mã nguồn nếu database SQLite bị xóa.
