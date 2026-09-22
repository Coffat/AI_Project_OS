-- 009_execution_sessions.sql
-- Execution Sessions for AI Agent Sessions decoupled from Tasks

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
