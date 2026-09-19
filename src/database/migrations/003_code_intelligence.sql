-- ============================================================================
-- Migration 003: Code Intelligence Engine Schema Enhancements
-- Adds path, lines, and name to graph_nodes
-- Expands graph_edges relation_type check (contains, exports, tests, dependency)
-- Expands symbols kind check (model, api, test)
-- ============================================================================

-- 1. Add extra columns to graph_nodes for rapid path & code range lookup
ALTER TABLE graph_nodes ADD COLUMN name TEXT;
ALTER TABLE graph_nodes ADD COLUMN path TEXT;
ALTER TABLE graph_nodes ADD COLUMN line_start INTEGER;
ALTER TABLE graph_nodes ADD COLUMN line_end INTEGER;

CREATE INDEX IF NOT EXISTS idx_graph_nodes_path ON graph_nodes(project_id, path);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_name ON graph_nodes(project_id, name);

-- 2. Upgrade graph_edges table to support Code Intelligence relation types
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS graph_edges_v3 (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'imports', 'calls', 'implements', 'depends_on', 'decides', 'validates',
        'affects', 'contains', 'exports', 'tests', 'dependency'
    )),
    weight REAL DEFAULT 1.0,
    metadata_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(source_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(target_node_id) REFERENCES graph_nodes(id) ON DELETE CASCADE,
    UNIQUE(source_node_id, target_node_id, relation_type)
);

INSERT OR IGNORE INTO graph_edges_v3 (id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at)
SELECT id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at FROM graph_edges;

DROP TABLE graph_edges;
ALTER TABLE graph_edges_v3 RENAME TO graph_edges;

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(project_id, relation_type);

-- 3. Upgrade symbols table to support extended code kinds
CREATE TABLE IF NOT EXISTS symbols_v3 (
    id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('function', 'class', 'interface', 'method', 'variable', 'type', 'model', 'api', 'test')),
    line_start INTEGER NOT NULL,
    line_end INTEGER NOT NULL,
    signature TEXT,
    docstring TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO symbols_v3 SELECT * FROM symbols;

DROP TABLE symbols;
ALTER TABLE symbols_v3 RENAME TO symbols;

CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(project_id, kind);

PRAGMA foreign_keys = ON;
