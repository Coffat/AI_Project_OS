-- Migration 001: Initial Schema for AI PROJECT OS State Core

PRAGMA foreign_keys = ON;

-- 1. Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 2. Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('planned', 'in_progress', 'blocked', 'handoff', 'resumed', 'testing', 'done')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    assigned_agent TEXT,
    parent_task_id TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

-- 3. Task Steps
CREATE TABLE IF NOT EXISTS task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
    result_summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_steps_task_order ON task_steps(task_id, step_order ASC);

-- Task Checkpoints
CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    git_commit_hash TEXT,
    agent_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- 4. Handoffs
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    objective TEXT NOT NULL,
    completed_work TEXT NOT NULL,
    current_step TEXT,
    current_file TEXT,
    modified_files TEXT NOT NULL DEFAULT '[]', -- JSON Array
    decisions TEXT NOT NULL DEFAULT '[]',      -- JSON Array
    blockers TEXT,
    errors TEXT,
    tests TEXT NOT NULL DEFAULT '[]',          -- JSON Array
    next_action TEXT NOT NULL,
    git_state TEXT NOT NULL DEFAULT '{}',      -- JSON Object
    agent_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_handoffs_task ON handoffs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_handoffs_project ON handoffs(project_id, created_at DESC);

-- 5. Decisions
CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    title TEXT NOT NULL,
    context TEXT NOT NULL,
    decision_rationale TEXT NOT NULL,
    consequences TEXT,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'superseded', 'rejected')),
    source_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_project ON decisions(project_id, status);

-- 6. Constraints
CREATE TABLE IF NOT EXISTS constraints (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('architecture', 'technology', 'security', 'performance', 'policy')),
    title TEXT NOT NULL,
    rule_content TEXT NOT NULL,
    enforcement_level TEXT NOT NULL DEFAULT 'mandatory' CHECK (enforcement_level IN ('mandatory', 'advisory')),
    source_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_constraints_project ON constraints(project_id, category);

-- 7. Memory Documents
CREATE TABLE IF NOT EXISTS memory_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('canonical', 'lesson', 'research')),
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    raw_content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_memory_docs_project ON memory_documents(project_id, doc_type);

-- 8. Memory Chunks
CREATE TABLE IF NOT EXISTS memory_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(document_id) REFERENCES memory_documents(id) ON DELETE CASCADE,
    UNIQUE(document_id, chunk_index)
);

-- 9. Files
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    path TEXT NOT NULL,
    language TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    last_modified_at INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_project_path ON files(project_id, path);

-- 10. Symbols
CREATE TABLE IF NOT EXISTS symbols (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('function', 'class', 'interface', 'method', 'variable', 'type')),
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    signature TEXT,
    docstring TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

-- 11. Graph Nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('file', 'symbol', 'task', 'decision', 'constraint', 'module')),
    entity_id TEXT NOT NULL,
    label TEXT NOT NULL,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_entity ON graph_nodes(project_id, entity_type, entity_id);

-- 12. Graph Edges
CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('imports', 'calls', 'implements', 'depends_on', 'decides', 'validates', 'affects')),
    weight REAL DEFAULT 1.0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(source_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);

-- 13. Events (Audit / Event Log)
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    payload_json TEXT,
    agent_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_events_project_created ON events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_type, aggregate_id);

-- 14. Research Documents
CREATE TABLE IF NOT EXISTS research_documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    findings TEXT NOT NULL,
    sources_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 15. Proposals
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'approved', 'rejected', 'implemented')),
    diff_preview TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id, status);

-- 16. Validation Runs
CREATE TABLE IF NOT EXISTS validation_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    validator_type TEXT NOT NULL CHECK (validator_type IN ('acceptance', 'schema', 'security', 'test')),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'warning')),
    results_json TEXT NOT NULL DEFAULT '{}',
    run_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_validation_runs_task ON validation_runs(task_id, created_at DESC);

-- 17. Agent Sessions
CREATE TABLE IF NOT EXISTS agent_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    agent_identity TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'closed', 'disconnected')),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id, status);

-- Canonical Project Memory Table (Markdown Sync Cache)
CREATE TABLE IF NOT EXISTS project_memory (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('CONSTITUTION', 'ARCHITECTURE', 'CONSTRAINT', 'DECISION', 'LESSON')),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_file TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- FTS5 Virtual Tables for Fast Search
CREATE VIRTUAL TABLE IF NOT EXISTS fts_memory_chunks USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    content
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_symbols USING fts5(
    symbol_id UNINDEXED,
    name,
    signature,
    docstring
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_project_memory USING fts5(
    memory_id UNINDEXED,
    title,
    content,
    category,
    source_file
);
