# AI PROJECT OS — CONSTITUTION

Bản hiến chương này xác định các nguyên tắc thiết kế bất biến và các ràng buộc cốt lõi chi phối toàn bộ vòng đời phát triển, vận hành và tiến hóa của **AI PROJECT OS**. Mọi agent, lập trình viên và module phần mềm khi tương tác với hệ thống phải tuân thủ nghiêm ngặt các điều khoản dưới đây.

---

## Điều 1: Độc lập giữa Task và Conversation
1. **Task là đơn vị công việc tối cao**: Mọi tác vụ lập trình, điều tra, refactor hoặc thiết kế đều phải gắn liền với một Task có định danh duy nhất (`task_id`).
2. **Conversation chỉ là ephemeral transport**: Phiên làm việc (chat session, CLI process, API thread) của AI agent có thể bị ngắt kết nối, mất context window hoặc bị hủy bất kỳ lúc nào. Tuyệt đối không lưu trữ trạng thái công việc trọng yếu duy nhất trong bộ nhớ hội thoại. Trạng thái task phải tồn tại bền vững trên đĩa.
3. **Seamless Handoff**: Bất kỳ AI agent tiếp theo nào (dù khác model, khác provider hay khác account) khi nhận task đều phải có khả năng đọc trạng thái, uncommitted diffs, blockers, context snapshot và tiếp tục công việc ngay lập tức mà không cần hỏi lại người dùng những gì đã làm.

## Điều 2: Phân định ranh giới "Nguồn chân lý" (Source of Truth)
1. **Git & Codebase là chân lý của Implementation**: Mã nguồn thực thi, cấu hình và lịch sử commit nằm trong Git repository là nguồn sự thật duy nhất cho trạng thái hiện tại của phần mềm đang được xây dựng.
2. **`.ai/canonical/` là chân lý của Tri thức dự án**: Các tệp Markdown trong `.ai/canonical/` (`PROJECT.md`, `CONSTITUTION.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DECISIONS/`) là nguồn chân lý bất biến về quy tắc nghiệp vụ, quyết định kiến trúc và ràng buộc kỹ thuật.
3. **SQLite là Index, Cache và State Store**: Cơ sở dữ liệu SQLite là bản chiếu (projection) máy học có thể tái sinh từ mã nguồn và Markdown. Nếu SQLite database bị hỏng hoặc xóa, hệ thống phải có khả năng re-index hoàn toàn từ Git và `.ai/canonical/`.

## Điều 3: Local-First và Quyền riêng tư tuyệt đối
1. Toàn bộ index, graph quan hệ, context assembly và handoff state được xử lý và lưu trữ cục bộ (local disk).
2. Không phụ thuộc vào máy chủ đám mây độc quyền để lưu trữ metadata của project.
3. Tương thích tự nhiên với Obsidian (human-readable knowledge interface) và các công cụ offline markdown.

## Điều 4: Tối ưu Token và Xử lý tất định (Deterministic First)
1. **Không ném cả codebase vào LLM context**: Tuyệt đối không đưa toàn bộ repository vào context window của AI. Context Engine phải trích xuất chính xác lát cắt code (code slice), symbol liên quan, architecture rules và constraints dựa trên Code Graph + SQLite FTS5.
2. **Ưu tiên AST & Static Analysis**: Mọi tác vụ có thể giải quyết chính xác bằng thuật toán tất định (Tree-sitter AST, regex, dependency graph, topological sort) phải được thực hiện bằng máy, không dùng LLM đoán mò.

## Điều 5: Độc lập Agent và Tuân thủ Policy
1. Hệ thống phải trung lập về Agent: Hoạt động đồng nhất cho Claude Code, Gemini CLI, OpenAI Codex, Antigravity, Cursor, hoặc Local LLM (Ollama, vLLM).
2. **Tuân thủ chuẩn mực nhà cung cấp**: Tuyệt đối không xây dựng bất kỳ cơ chế nào nhằm lách luật, né tránh hoặc bypass quota/rate limit của các nhà cung cấp AI. Session/account chỉ đóng vai trò là danh tính thực thi (execution identity).
3. Sử dụng Model Context Protocol (MCP) làm giao diện tiêu chuẩn mở để các AI agent tương tác với Project OS.

## Điều 6: Tiến hóa tri thức Incremental
1. Sau mỗi task hoàn thành, Memory Engine phải tự động phân tích diff và tóm tắt những quyết định, thay đổi kiến trúc hoặc bài học rút ra để cập nhật ngược lại vào `.ai/canonical/` hoặc tạo Architecture Decision Record (ADR) mới.
2. Tránh suy thoái tri thức theo thời gian (knowledge drift).

## Điều 7: Tính tối giản và Kỷ luật kỹ thuật
1. Không over-engineer: Không tạo abstraction khi chưa có ít nhất 2 trường hợp sử dụng thực tế.
2. Mọi module phải có interface rõ ràng, tách biệt giữa Domain, Data Access, Transport (MCP/UI) và Agent Adapters.
3. Kiểm thử tự động (Unit / Integration Tests) là bắt buộc cho mọi thay đổi logic cốt lõi.
