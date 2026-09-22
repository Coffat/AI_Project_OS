-- Migration 008: NotebookLM Knowledge Bridge – Research Proposals
-- Separate from the existing minimal `proposals` table in 001_initial_schema.sql

CREATE TABLE IF NOT EXISTS research_proposals (
    id                   TEXT    PRIMARY KEY,
    project_id           TEXT    NOT NULL,
    task_id              TEXT,
    title                TEXT    NOT NULL,
    question             TEXT    NOT NULL,
    sources              TEXT    NOT NULL DEFAULT '[]',        -- JSON array of source paths/URLs
    findings             TEXT    NOT NULL DEFAULT '',
    proposed_changes     TEXT    NOT NULL DEFAULT '',
    confidence           TEXT    NOT NULL DEFAULT 'medium'
                                 CHECK (confidence IN ('low', 'medium', 'high', 'experimental')),
    open_questions       TEXT    NOT NULL DEFAULT '[]',        -- JSON array of strings
    status               TEXT    NOT NULL DEFAULT 'draft'
                                 CHECK (status IN ('draft', 'under_review', 'approved', 'rejected', 'implemented')),
    reviewed_by          TEXT,
    review_comment       TEXT,
    promoted_decision_id TEXT,
    created_at           INTEGER NOT NULL,
    updated_at           INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)  ON DELETE CASCADE,
    FOREIGN KEY(task_id)    REFERENCES tasks(id)     ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_research_proposals_project
    ON research_proposals(project_id, status);

CREATE INDEX IF NOT EXISTS idx_research_proposals_status
    ON research_proposals(status, updated_at DESC);
