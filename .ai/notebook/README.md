# NotebookLM Knowledge Pack: AI Project OS Dev Environment

This directory contains the canonical knowledge pack exported from AI Project OS for use with Google NotebookLM as an external research and knowledge synthesis layer.

## Architecture & Context Firewall
- **NotebookLM is a RESEARCH / EXTERNAL KNOWLEDGE LAYER**, NOT the source of truth for project state.
- Source code, build outputs, node_modules, logs, task/handoff runtime states, and secrets (.env, keys) are strictly excluded by the NotebookLM Context Firewall.
- Research output from NotebookLM CANNOT directly overwrite canonical memory. Findings must be submitted as Research Proposals (`.ai/proposals/PROPOSAL-XXX.md`) and undergo Human/Agent review before promotion to Architecture Decision Records (ADRs).

## Files in this Knowledge Pack
- `PROJECT-KNOWLEDGE.md`: High-level project context, requirements, and constraints.
- `ARCHITECTURE.md`: Canonical system architecture and subsystem boundaries.
- `DECISIONS.md`: Summary of accepted Architecture Decision Records.
- `SOURCES.md`: Index of included knowledge documents and firewall exclusions.
- `manifest.json`: Cryptographic hashes, categories, word counts, and token estimates.

## Google Drive & NotebookLM Workflow
1. **Sync / Upload to Google Drive**:
   - Upload this `.ai/notebook/` folder (or sync via Google Drive desktop client) to your Google Drive.
2. **Import to NotebookLM**:
   - Open NotebookLM (https://notebooklm.google.com).
   - Create a new notebook (e.g., "AI Project OS Dev Environment Research").
   - Add sources by choosing "Google Drive" and selecting the uploaded Markdown files (or upload directly).
3. **Conduct Research & Synthesize**:
   - Ask NotebookLM for architectural trade-offs, technology evaluations, or code designs based on existing constraints.
4. **Propose Changes Back to AI Project OS**:
   - Save findings into a proposal:
     ```bash
     notebook proposal create --project-id 3ab7b26e-a27d-4200-8e5c-e52fd354a3ab --title "..." --question "..."
     ```
   - Or save Markdown to `.ai/proposals/PROPOSAL-XXX.md` and ingest:
     ```bash
     notebook proposal ingest .ai/proposals/my-research.md --project-id 3ab7b26e-a27d-4200-8e5c-e52fd354a3ab
     ```
   - Review and approve to promote to canonical ADR:
     ```bash
     notebook proposal approve <PROPOSAL-ID> --reviewed-by "lead-architect"
     ```

---
*This file is auto-generated for NotebookLM. Do not edit manually.*