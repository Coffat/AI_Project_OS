-- ============================================================================
-- Migration 005: Incremental Memory Engine & Deterministic Event Sourcing
-- Adds memory_events table for tracking granular memory changes (events)
-- Adds semantic_extraction_requests table for optional LLM extraction
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    entity TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_events_project ON memory_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events(project_id, event_type);
CREATE INDEX IF NOT EXISTS idx_memory_events_entity ON memory_events(project_id, entity);

CREATE TABLE IF NOT EXISTS semantic_extraction_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    diff_summary TEXT NOT NULL,
    suggested_target_layer TEXT NOT NULL,
    entity_identifier TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped')),
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_semantic_requests_proj_status ON semantic_extraction_requests(project_id, status);
