# Canonical Architecture Reference

Bản tóm lược kiến trúc chuẩn đặt tại `.ai/canonical/ARCHITECTURE.md`.

## Phân rã hệ thống
1. `src/core/`: Domain types, errors, event bus.
2. `src/database/`: SQLite wrapper, migrations, schema DDL.
3. `src/tasks/`: Task lifecycle state engine.
4. `src/handoff/`: Handoff generator, git diff snapshot, blocker tracker.
5. `src/memory/`: Two-way sync engine giữa Markdown và SQLite.
6. `src/context/`: Relevance score & context budget optimizer.
7. `src/code-intelligence/`: AST symbol parser & dependency analyzer.
8. `src/graph/`: Relational graph queries & path finding.
9. `src/validation/`: Task acceptance & markdown schema validation.
10. `src/integrations/`: Obsidian vault format & NotebookLM research export.
11. `src/mcp/`: JSON-RPC Stdio MCP Server.
12. `src/agents/`: Protocol serialization adapters.
13. `src/ui/`: React + Vite + Tailwind desktop client.
