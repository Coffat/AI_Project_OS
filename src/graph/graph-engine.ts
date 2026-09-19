import type { DatabaseSync } from 'node:sqlite';
import { GraphNode, GraphEdge, GraphNodeType, RelationType } from '../core/types.js';

export interface IGraphEngine {
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;
  getNode(nodeId: string): Promise<GraphNode | null>;
  getNeighbors(
    nodeId: string,
    direction?: 'OUT' | 'IN' | 'BOTH'
  ): Promise<Array<{ node: GraphNode; edge: GraphEdge }>>;
}

export class GraphEngine implements IGraphEngine {
  constructor(private readonly db: DatabaseSync) {}

  public async addNode(node: GraphNode): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, project_id, type, identifier, label, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type = excluded.type,
        identifier = excluded.identifier,
        label = excluded.label,
        metadata_json = excluded.metadata_json
    `);
    stmt.run(node.id, node.projectId, node.type, node.identifier, node.label, node.metadataJson ?? null);
  }

  public async addEdge(edge: GraphEdge): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (source_id, target_id, relation_type, weight, metadata_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_id, target_id, relation_type) DO UPDATE SET
        weight = excluded.weight,
        metadata_json = excluded.metadata_json
    `);
    stmt.run(edge.sourceId, edge.targetId, edge.relationType, edge.weight ?? 1.0, edge.metadataJson ?? null);
  }

  public async getNode(nodeId: string): Promise<GraphNode | null> {
    const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE id = ?');
    const row = stmt.get(nodeId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToNode(row);
  }

  public async getNeighbors(
    nodeId: string,
    direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'
  ): Promise<Array<{ node: GraphNode; edge: GraphEdge }>> {
    const results: Array<{ node: GraphNode; edge: GraphEdge }> = [];

    if (direction === 'OUT' || direction === 'BOTH') {
      const stmt = this.db.prepare(`
        SELECT e.*, n.* FROM graph_edges e
        JOIN graph_nodes n ON e.target_id = n.id
        WHERE e.source_id = ?
      `);
      const rows = stmt.all(nodeId) as Record<string, unknown>[];
      for (const r of rows) {
        results.push({
          node: this.mapRowToNode(r),
          edge: {
            sourceId: String(r['source_id']),
            targetId: String(r['target_id']),
            relationType: r['relation_type'] as RelationType,
            weight: Number(r['weight']),
            metadataJson: r['metadata_json'] ? String(r['metadata_json']) : undefined,
          },
        });
      }
    }

    if (direction === 'IN' || direction === 'BOTH') {
      const stmt = this.db.prepare(`
        SELECT e.*, n.* FROM graph_edges e
        JOIN graph_nodes n ON e.source_id = n.id
        WHERE e.target_id = ?
      `);
      const rows = stmt.all(nodeId) as Record<string, unknown>[];
      for (const r of rows) {
        results.push({
          node: this.mapRowToNode(r),
          edge: {
            sourceId: String(r['source_id']),
            targetId: String(r['target_id']),
            relationType: r['relation_type'] as RelationType,
            weight: Number(r['weight']),
            metadataJson: r['metadata_json'] ? String(r['metadata_json']) : undefined,
          },
        });
      }
    }

    return results;
  }

  private mapRowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      type: row['type'] as GraphNodeType,
      identifier: String(row['identifier']),
      label: String(row['label']),
      metadataJson: row['metadata_json'] ? String(row['metadata_json']) : undefined,
    };
  }
}
