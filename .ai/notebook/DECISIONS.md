# Architecture Decision Records

*1 decision(s) exported for NotebookLM.*

## 515f6635-147b-4c50-8a56-203145633d86: Use native node:sqlite over better-sqlite3

**Status:** accepted
**Date:** 2026-09-19

### Context
Node v26 has breaking V8 C++ API changes causing native compilation issues with better-sqlite3

### Decision
Native node:sqlite DatabaseSync is zero-dependency, ultra-fast, and natively supports FTS5 and WAL mode

### Consequences
Eliminated native build step and gyp compilation errors completely

---

*This file is auto-generated for NotebookLM. Do not edit manually.*