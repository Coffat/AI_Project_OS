-- ============================================================================
-- Migration 004: Knowledge Graph Engine Schema Enhancements
-- Expands graph_nodes entity_type check to support:
--   'task', 'file', 'symbol', 'module', 'decision', 'constraint',
--   'memory', 'research', 'test', 'validation'
-- Expands graph_edges relation_type check to support:
--   'imports', 'calls', 'implements', 'depends_on', 'decides', 'validates',
--   'affects', 'contains', 'exports', 'tests', 'tested_by', 'modifies',
--   'constrained_by', 'relates_to', 'references', 'dependency'
-- Adds compound indices for high performance bounded traversals
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- 1. Upgrade graph_nodes
CREATE TABLE IF NOT EXISTS graph_nodes_v4 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'task', 'file', 'symbol', 'module', 'decision', 'constraint',
        'memory', 'research', 'test', 'validation'
    )),
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

INSERT OR IGNORE INTO graph_nodes_v4 (
    id, project_id, entity_type, entity_id, label, name, path, line_start, line_end, metadata_json, created_at
)
SELECT id, project_id, entity_type, entity_id, label, name, path, line_start, line_end, metadata_json, created_at
FROM graph_nodes;

DROP TABLE graph_nodes;
ALTER TABLE graph_nodes_v4 RENAME TO graph_nodes;

CREATE INDEX IF NOT EXISTS idx_graph_nodes_entity ON graph_nodes(project_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_path ON graph_nodes(project_id, path);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(project_id, name);

-- 2. Upgrade graph_edges
CREATE TABLE IF NOT EXISTS graph_edges_v4 (
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
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(source_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id, relation_type)
);

INSERT OR IGNORE INTO graph_edges_v4 (
    id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at
)
SELECT id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at
FROM graph_edges;

DROP TABLE graph_edges;
ALTER TABLE graph_edges_v4 RENAME TO graph_edges;

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(project_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_rel ON graph_edges(source_node_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_rel ON graph_edges(target_node_id, relation_type);

PRAGMA foreign_keys = ON;
