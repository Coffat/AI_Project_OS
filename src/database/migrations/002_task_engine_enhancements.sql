-- Migration 002: Task Engine Enhancements

-- 1. Extend tasks table with goal, current_step, started_at, completed_at
ALTER TABLE tasks ADD COLUMN goal TEXT;
ALTER TABLE tasks ADD COLUMN current_step TEXT;
ALTER TABLE tasks ADD COLUMN started_at INTEGER;
ALTER TABLE tasks ADD COLUMN completed_at INTEGER;

-- 2. Task Files Relation
CREATE TABLE IF NOT EXISTS task_files (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    relation_type TEXT NOT NULL DEFAULT 'modified',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, file_path)
);
CREATE INDEX IF NOT EXISTS idx_task_files_task ON task_files(task_id);

-- 3. Task Symbols Relation
CREATE TABLE IF NOT EXISTS task_symbols (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    symbol_id TEXT,
    symbol_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    UNIQUE(task_id, symbol_name)
);
CREATE INDEX IF NOT EXISTS idx_task_symbols_task ON task_symbols(task_id);

-- 4. Task Blockers
CREATE TABLE IF NOT EXISTS task_blockers (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(task_id, resolved);

-- 5. Task Snapshots
CREATE TABLE IF NOT EXISTS task_snapshots (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_snapshots_task ON task_snapshots(task_id, created_at DESC);
