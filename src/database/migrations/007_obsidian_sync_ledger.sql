-- ============================================================================
-- Migration 007: Obsidian Integration & Sync Ledger
-- Tracks synchronized markdown files in .ai/canonical/ with SHA-256 hashes
-- Prevents infinite sync loops between SQLite machine state and Obsidian markdown
-- Facilitates conflict detection for concurrent human and agent modifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS obsidian_sync_ledger (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    last_synced_hash TEXT NOT NULL,
    last_synced_mtime INTEGER NOT NULL,
    last_synced_at INTEGER NOT NULL,
    sync_source TEXT NOT NULL CHECK (sync_source IN ('sqlite_to_markdown', 'markdown_to_sqlite')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_obsidian_ledger_proj_file ON obsidian_sync_ledger(project_id, file_path);
CREATE INDEX IF NOT EXISTS idx_obsidian_ledger_entity ON obsidian_sync_ledger(project_id, entity_type, entity_id);
