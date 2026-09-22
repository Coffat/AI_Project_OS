# Obsidian Integration Guide — AI Project OS

AI Project OS stores all human-facing canonical knowledge and memory in standard GitHub-Flavored Markdown inside the `.ai/` directory. This allows developers to open `.ai/` directly as an **Obsidian Vault** for visual exploration, graph mapping, and real-time knowledge synthesis.

---

## 1. Opening `.ai/` as an Obsidian Vault

1. Open **Obsidian**.
2. Click **Open folder as vault**.
3. Select your project root or the `.ai/` directory directly (e.g., `/Users/vuthang/Documents/CofAIOS/.ai`).
4. Obsidian will index all markdown documents and render the bidirectional links.

---

## 2. Vault Structure & Conventions

```
.ai/
├── canonical/
│   ├── PROJECT.md               <-- Root project domain & business scope
│   ├── ARCHITECTURE.md          <-- Architectural boundaries & module rules
│   ├── CONSTRAINTS.md           <-- Security, latency, and code guidelines
│   └── DECISIONS/               <-- Architectural Decision Records (ADRs)
│       ├── ADR-001.md
│       └── ADR-002.md
├── handoff/
│   ├── CURRENT.json             <-- Active session handoff
│   └── archive/                 <-- Historical handoffs for audit
└── proposals/                   <-- Staged external research (NotebookLM, etc.)
```

---

## 3. Bidirectional Wikilinks (`[[...]]`) & Graph View

AI Project OS automatically formats internal references in Markdown using Obsidian-compatible wikilinks:

```markdown
# ADR-002: OAuth PKCE Implementation

## Status
Accepted

## Relates To
- [[PROJECT]]
- [[ARCHITECTURE]]
- [[ADR-001]]
- Source File: `src/backend/api/oauth-router.ts`

## Decision
All OAuth callbacks must enforce PKCE with SHA-256 code challenge verification as specified in [[CONSTRAINTS]].
```

### Obsidian Graph View
In Obsidian, press `Ctrl/Cmd + G` to open the **Graph View**:
- **Core Nodes**: `PROJECT.md`, `ARCHITECTURE.md`, `CONSTRAINTS.md`.
- **Satellite Nodes**: Each ADR connects back to the relevant architecture principles and constraints.
- **Color Coding**: You can filter notes by tags such as `#adr`, `#security`, `#database` in Obsidian's graph settings.

---

## 4. Human-in-the-Loop Collaboration

- Human engineers can edit ADRs or update `ARCHITECTURE.md` directly inside Obsidian.
- After saving edits, run `ai-project-os reindex` from your terminal to re-sync the SQLite FTS5 index and knowledge graph.
- Agents reading context through the Token Optimization Engine will immediately reflect your updated architectural guidance.
