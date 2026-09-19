# Canonical Technical Constraints

1. **Local Disk Footprint**:
   - Dữ liệu SQLite index đặt tại `.ai/indexes/project_os.sqlite`.
   - Các file database không commit vào git (đã có trong `.gitignore`).

2. **Concurrency**:
   - SQLite phải chạy ở chế độ WAL (Write-Ahead Logging) để cho phép nhiều agent hoặc MCP process đọc đồng thời mà không bị lock database.

3. **Dependency Discipline**:
   - Không cài thư viện cồng kềnh nếu native Node.js API đã giải quyết tốt.
   - Code intelligence ban đầu dùng Tree-sitter core bindings hoặc parser chuẩn.
   - Không bắt buộc vector database hay embedding server trong MVP.

4. **Agent Independence**:
   - Không hardcode logic nghiệp vụ vào bất kỳ agent adapter nào.
   - MCP Server là giao diện chuẩn duy nhất mà agent tương tác.
