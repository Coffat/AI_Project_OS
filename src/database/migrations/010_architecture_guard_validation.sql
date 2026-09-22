-- Migration 010: Add architecture_guard validator type to validation_runs
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS validation_runs_v10 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT,
    validator_type TEXT NOT NULL CHECK (validator_type IN (
        'test', 'lint', 'typecheck', 'build', 'git_diff', 'memory_update', 'pipeline',
        'acceptance', 'schema', 'security', 'architecture_guard'
    )),
    status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'stale', 'skipped', 'warning')),
    command TEXT,
    exit_code INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    affected_files_json TEXT,
    results_json TEXT NOT NULL DEFAULT '{}',
    run_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO validation_runs_v10 (
    id, project_id, task_id, validator_type, status, command, exit_code, started_at, finished_at, affected_files_json, results_json, run_by, created_at
)
SELECT id, project_id, task_id, validator_type, status, command, exit_code, started_at, finished_at, affected_files_json, results_json, run_by, created_at
FROM validation_runs;

DROP TABLE validation_runs;
ALTER TABLE validation_runs_v10 RENAME TO validation_runs;

CREATE INDEX IF NOT EXISTS idx_validation_runs_task ON validation_runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_runs_proj ON validation_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validation_runs_type ON validation_runs(task_id, validator_type, created_at DESC);

PRAGMA foreign_keys = ON;
