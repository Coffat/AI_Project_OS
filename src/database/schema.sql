-- AI PROJECT OS - SQLite Schema DDL

PRAGMA foreign_keys = ON;

-- Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Tasks Table
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('BACKLOG', 'READY', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'DONE')),
    assigned_agent TEXT,
    priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    parent_task_id TEXT,
    acceptance_criteria TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Task Checkpoints Table
CREATE TABLE IF NOT EXISTS task_checkpoints (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    git_commit_hash TEXT,
    agent_identity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Handoffs Table
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    from_agent TEXT NOT NULL,
    status_summary TEXT NOT NULL,
    blockers TEXT,
    next_steps TEXT NOT NULL,
    context_snapshot_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Project Memory Cache Table
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

-- Graph Nodes Table
CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'file', 'symbol', 'module', 'decision', 'constraint', 'memory', 'research', 'test', 'validation')),
    entity_id TEXT NOT NULL,
    label TEXT NOT NULL,
    name TEXT,
    path TEXT,
    line_start INTEGER,
    line_end INTEGER,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, entity_type, entity_id)
);

-- Graph Edges Table
CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'imports', 'calls', 'implements', 'depends_on', 'decides', 'validates',
        'affects', 'contains', 'exports', 'tests', 'tested_by', 'modifies',
        'constrained_by', 'relates_to', 'references', 'dependency'
    )),
    weight REAL DEFAULT 1.0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_node_id, target_node_id, relation_type),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(source_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);

-- FTS5 Full Text Index for Project Memory
CREATE VIRTUAL TABLE IF NOT EXISTS fts_project_memory USING fts5(
    memory_id UNINDEXED,
    title,
    content,
    category,
    source_file
);

-- FTS5 Full Text Index for Code Symbols
CREATE VIRTUAL TABLE IF NOT EXISTS fts_code_symbols USING fts5(
    node_id UNINDEXED,
    identifier,
    label,
    file_path,
    documentation
);

-- Incremental Memory Events
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

-- Semantic Extraction Requests
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

-- Execution Sessions
CREATE TABLE IF NOT EXISTS execution_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    provider TEXT NOT NULL,
    agent TEXT NOT NULL,
    account_label TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended', 'handoff')),
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_execution_sessions_task ON execution_sessions(task_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_sessions_project ON execution_sessions(project_id, status);

