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
    type TEXT NOT NULL CHECK (type IN ('FILE', 'SYMBOL', 'TASK', 'DECISION', 'MODULE')),
    identifier TEXT NOT NULL,
    label TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Graph Edges Table
CREATE TABLE IF NOT EXISTS graph_edges (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN ('IMPORTS', 'CALLS', 'IMPLEMENTS', 'DEPENDS_ON', 'DECIDED_BY', 'AFFECTS')),
    weight REAL DEFAULT 1.0,
    metadata_json TEXT,
    PRIMARY KEY (source_id, target_id, relation_type),
    FOREIGN KEY(source_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
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
