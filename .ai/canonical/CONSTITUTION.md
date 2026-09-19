# Canonical Constitution

Tài liệu này lưu trữ bản hiến chương bất biến của dự án tại `.ai/canonical/CONSTITUTION.md`.

## Các nguyên lý nền tảng:
1. **Task Outlives Conversation**: Task là thực thể độc lập có vòng đời riêng. Conversation có thể bị reset hoặc kết thúc mà task không bị mất.
2. **Tri thức hai lớp (Dual Layer)**: Markdown là canonical human-readable truth; SQLite là relational index, graph và state machine có thể tái tạo (re-indexable).
3. **Local-First**: Toàn bộ dữ liệu nằm trên đĩa cục bộ của người dùng, không phụ thuộc cloud ngoài trừ agent LLM API.
4. **Agent-Agnostic & Zero Quota-Bypassing**: Không thiết kế bất kỳ cơ chế nào vi phạm chính sách của LLM providers.
5. **Deterministic First**: Dùng AST, SQLite FTS5 và Graph traversal để giải quyết bài toán context, hạn chế tối đa việc đoán mò của LLM.
