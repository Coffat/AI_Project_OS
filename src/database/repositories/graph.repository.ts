import { BaseRepository } from './base.repository.js';
import {
  FileEntity,
  SymbolEntity,
  SymbolKind,
  GraphNode,
  GraphEdge,
  GraphEntityType,
  GraphRelationType,
  GraphIntegrityReport,
} from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface UpsertFileParams {
  projectId: string;
  path: string;
  language?: string;
  sizeBytes: number;
  lastModifiedAt: number;
  contentHash: string;
}

export interface CreateSymbolParams {
  fileId: string;
  projectId: string;
  name: string;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  docstring?: string;
}

export interface CreateNodeParams {
  projectId: string;
  entityType: GraphEntityType;
  entityId?: string;
  label: string;
  name?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  metadata?: Record<string, unknown>;
}


export interface CreateEdgeParams {
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: GraphRelationType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export class GraphRepository extends BaseRepository {
  // --- Files Management ---
  public upsertFile(params: UpsertFileParams): FileEntity {
    const now = Date.now();
    const existing = this.findFileByPath(params.projectId, params.path);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE files
        SET language = ?, size_bytes = ?, last_modified_at = ?, content_hash = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        params.language ?? null,
        params.sizeBytes,
        params.lastModifiedAt,
        params.contentHash,
        now,
        existing.id
      );

      return {
        ...existing,
        language: params.language,
        sizeBytes: params.sizeBytes,
        lastModifiedAt: params.lastModifiedAt,
        contentHash: params.contentHash,
        updatedAt: now,
      };
    }

    const file: FileEntity = {
      id: randomUUID(),
      projectId: params.projectId,
      path: params.path,
      language: params.language,
      sizeBytes: params.sizeBytes,
      lastModifiedAt: params.lastModifiedAt,
      contentHash: params.contentHash,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO files (id, project_id, path, language, size_bytes, last_modified_at, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      file.id,
      file.projectId,
      file.path,
      file.language ?? null,
      file.sizeBytes,
      file.lastModifiedAt,
      file.contentHash,
      file.createdAt,
      file.updatedAt
    );

    return file;
  }

  public findFileByPath(projectId: string, path: string): FileEntity | null {
    const stmt = this.db.prepare('SELECT * FROM files WHERE project_id = ? AND path = ?');
    const row = stmt.get(projectId, path) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToFile(row);
  }

  public listFiles(projectId: string): FileEntity[] {
    const stmt = this.db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY path ASC');
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToFile(r));
  }

  // --- Symbols Management ---
  public addSymbols(symbols: CreateSymbolParams[]): SymbolEntity[] {
    const now = Date.now();
    const insertSymbol = this.db.prepare(`
      INSERT INTO symbols (id, file_id, project_id, name, kind, line_start, line_end, signature, docstring, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO fts_symbols (symbol_id, name, signature, docstring)
      VALUES (?, ?, ?, ?)
    `);

    const created: SymbolEntity[] = [];
    for (const s of symbols) {
      const entity: SymbolEntity = {
        id: randomUUID(),
        fileId: s.fileId,
        projectId: s.projectId,
        name: s.name,
        kind: s.kind,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        signature: s.signature,
        docstring: s.docstring,
        createdAt: now,
      };

      insertSymbol.run(
        entity.id,
        entity.fileId,
        entity.projectId,
        entity.name,
        entity.kind,
        entity.lineStart,
        entity.lineEnd,
        entity.signature ?? null,
        entity.docstring ?? null,
        entity.createdAt
      );

      insertFts.run(entity.id, entity.name, entity.signature ?? '', entity.docstring ?? '');
      created.push(entity);
    }

    return created;
  }

  public searchSymbolsFTS(query: string, limit = 20): SymbolEntity[] {
    if (!query || query.trim() === '') return [];

    try {
      const stmt = this.db.prepare(`
        SELECT s.* FROM symbols s
        JOIN fts_symbols fts ON s.id = fts.symbol_id
        WHERE fts_symbols MATCH ?
        LIMIT ?
      `);
      const rows = stmt.all(query, limit) as Record<string, unknown>[];
      return rows.map((r) => this.mapRowToSymbol(r));
    } catch {
      const stmt = this.db.prepare(`
        SELECT * FROM symbols WHERE name LIKE ? LIMIT ?
      `);
      const rows = stmt.all(`%${query}%`, limit) as Record<string, unknown>[];
      return rows.map((r) => this.mapRowToSymbol(r));
    }
  }

  // --- Graph Nodes & Edges ---
  public addNode(params: CreateNodeParams): GraphNode {
    const entityId =
      params.entityId ||
      (params.path && params.name ? `${params.path}:${params.name}` : params.name || params.path || params.label);
    const existing = this.findNodeByEntity(params.projectId, params.entityType, entityId);
    const now = Date.now();



    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE graph_nodes
        SET label = ?, name = ?, path = ?, line_start = ?, line_end = ?, metadata_json = ?
        WHERE id = ?
      `);
      stmt.run(
        params.label,
        params.name ?? existing.name ?? null,
        params.path ?? existing.path ?? null,
        params.lineStart ?? existing.lineStart ?? null,
        params.lineEnd ?? existing.lineEnd ?? null,
        this.serializeJson(params.metadata, '{}'),
        existing.id
      );
      return {
        ...existing,
        label: params.label,
        name: params.name ?? existing.name,
        path: params.path ?? existing.path,
        lineStart: params.lineStart ?? existing.lineStart,
        lineEnd: params.lineEnd ?? existing.lineEnd,
        metadataJson: this.serializeJson(params.metadata, '{}'),
      };
    }

    const node: GraphNode = {
      id: randomUUID(),
      projectId: params.projectId,
      entityType: params.entityType,
      entityId,
      label: params.label,

      name: params.name,
      path: params.path,
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
      metadataJson: this.serializeJson(params.metadata, '{}'),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO graph_nodes (id, project_id, entity_type, entity_id, label, name, path, line_start, line_end, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.id,
      node.projectId,
      node.entityType,
      node.entityId,
      node.label,
      node.name ?? null,
      node.path ?? null,
      node.lineStart ?? null,
      node.lineEnd ?? null,
      node.metadataJson ?? null,
      node.createdAt
    );

    return node;
  }

  public updateNode(id: string, updates: Partial<CreateNodeParams>): GraphNode {
    const existing = this.findNodeById(id);
    if (!existing) {
      throw new ValidationError(`Node with ID ${id} not found`);
    }

    const label = updates.label ?? existing.label;
    const name = updates.name !== undefined ? updates.name : existing.name;
    const path = updates.path !== undefined ? updates.path : existing.path;
    const lineStart = updates.lineStart !== undefined ? updates.lineStart : existing.lineStart;
    const lineEnd = updates.lineEnd !== undefined ? updates.lineEnd : existing.lineEnd;
    const metadataJson = updates.metadata !== undefined
      ? this.serializeJson(updates.metadata, '{}')
      : existing.metadataJson;

    const stmt = this.db.prepare(`
      UPDATE graph_nodes
      SET label = ?, name = ?, path = ?, line_start = ?, line_end = ?, metadata_json = ?
      WHERE id = ?
    `);
    stmt.run(label, name ?? null, path ?? null, lineStart ?? null, lineEnd ?? null, metadataJson ?? null, id);

    return {
      ...existing,
      label,
      name,
      path,
      lineStart,
      lineEnd,
      metadataJson,
    };
  }

  public removeNode(id: string): boolean {
    // Delete connected edges first to respect foreign keys or manual cascade
    const delEdges = this.db.prepare('DELETE FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?');
    delEdges.run(id, id);

    const stmt = this.db.prepare('DELETE FROM graph_nodes WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public removeEdge(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM graph_edges WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  public removeEdgeByEndpoints(
    sourceNodeId: string,
    targetNodeId: string,
    relationType?: GraphRelationType
  ): boolean {
    let query = 'DELETE FROM graph_edges WHERE source_node_id = ? AND target_node_id = ?';
    const params: string[] = [sourceNodeId, targetNodeId];
    if (relationType) {
      query += ' AND relation_type = ?';
      params.push(relationType);
    }
    const stmt = this.db.prepare(query);
    const result = stmt.run(...params);
    return result.changes > 0;
  }

  public findEdgeById(id: string): GraphEdge | null {
    const stmt = this.db.prepare('SELECT * FROM graph_edges WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToEdge(row);
  }

  public findEdge(
    sourceNodeId: string,
    targetNodeId: string,
    relationType: GraphRelationType
  ): GraphEdge | null {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_edges
      WHERE source_node_id = ? AND target_node_id = ? AND relation_type = ?
    `);
    const row = stmt.get(sourceNodeId, targetNodeId, relationType) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToEdge(row);
  }

  public findNodeByIdOrEntity(projectId: string | undefined, identifier: string): GraphNode | null {
    // 1. Check direct node id
    const byId = this.findNodeById(identifier);
    if (byId) {
      if (!projectId || byId.projectId === projectId) return byId;
    }

    // 2. Check entity_id (e.g. TASK-042, DECISION-012, file path, symbol name)
    if (projectId) {
      const stmtEntity = this.db.prepare(`
        SELECT * FROM graph_nodes
        WHERE project_id = ? AND (entity_id = ? OR label = ? OR name = ? OR path = ?)
        LIMIT 1
      `);
      const rowEntity = stmtEntity.get(projectId, identifier, identifier, identifier, identifier) as Record<string, unknown> | undefined;
      if (rowEntity) return this.mapRowToNode(rowEntity);

      const stmtPath = this.db.prepare(`
        SELECT * FROM graph_nodes
        WHERE project_id = ? AND path LIKE ?
        LIMIT 1
      `);
      const rowPath = stmtPath.get(projectId, `%${identifier}%`) as Record<string, unknown> | undefined;
      if (rowPath) return this.mapRowToNode(rowPath);
    } else {
      const stmtEntity = this.db.prepare(`
        SELECT * FROM graph_nodes
        WHERE entity_id = ? OR label = ? OR name = ? OR path = ?
        LIMIT 1
      `);
      const rowEntity = stmtEntity.get(identifier, identifier, identifier, identifier) as Record<string, unknown> | undefined;
      if (rowEntity) return this.mapRowToNode(rowEntity);

      const stmtPath = this.db.prepare(`
        SELECT * FROM graph_nodes
        WHERE path LIKE ?
        LIMIT 1
      `);
      const rowPath = stmtPath.get(`%${identifier}%`) as Record<string, unknown> | undefined;
      if (rowPath) return this.mapRowToNode(rowPath);
    }

    return null;
  }

  public getAllNodes(projectId?: string): GraphNode[] {
    const query = projectId
      ? 'SELECT * FROM graph_nodes WHERE project_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM graph_nodes ORDER BY created_at ASC';
    const stmt = this.db.prepare(query);
    const rows = (projectId ? stmt.all(projectId) : stmt.all()) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToNode(r));
  }

  public getAllEdges(projectId?: string): GraphEdge[] {
    const query = projectId
      ? 'SELECT * FROM graph_edges WHERE project_id = ? ORDER BY created_at ASC'
      : 'SELECT * FROM graph_edges ORDER BY created_at ASC';
    const stmt = this.db.prepare(query);
    const rows = (projectId ? stmt.all(projectId) : stmt.all()) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToEdge(r));
  }

  public checkIntegrity(projectId?: string): GraphIntegrityReport {
    const nodes = this.getAllNodes(projectId);
    const edges = this.getAllEdges(projectId);
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) {
      nodeMap.set(n.id, n);
    }

    const danglingEdges: Array<{ edgeId: string; missingNodeId: string; reason: string }> = [];
    const selfLoops: Array<{ edgeId: string; nodeId: string }> = [];
    const connectedNodeIds = new Set<string>();

    for (const edge of edges) {
      if (edge.sourceNodeId === edge.targetNodeId) {
        selfLoops.push({ edgeId: edge.id, nodeId: edge.sourceNodeId });
      }

      if (!nodeMap.has(edge.sourceNodeId)) {
        danglingEdges.push({
          edgeId: edge.id,
          missingNodeId: edge.sourceNodeId,
          reason: `Edge source node ${edge.sourceNodeId} does not exist in graph_nodes`,
        });
      } else {
        connectedNodeIds.add(edge.sourceNodeId);
      }

      if (!nodeMap.has(edge.targetNodeId)) {
        danglingEdges.push({
          edgeId: edge.id,
          missingNodeId: edge.targetNodeId,
          reason: `Edge target node ${edge.targetNodeId} does not exist in graph_nodes`,
        });
      } else {
        connectedNodeIds.add(edge.targetNodeId);
      }
    }

    const isolatedNodes: Array<{ nodeId: string; label: string; entityType: GraphEntityType }> = [];
    for (const node of nodes) {
      if (!connectedNodeIds.has(node.id)) {
        isolatedNodes.push({
          nodeId: node.id,
          label: node.label,
          entityType: node.entityType,
        });
      }
    }

    const details: string[] = [];
    if (danglingEdges.length > 0) {
      details.push(`Found ${danglingEdges.length} dangling edge(s)`);
    }
    if (selfLoops.length > 0) {
      details.push(`Found ${selfLoops.length} self-loop edge(s)`);
    }
    if (isolatedNodes.length > 0) {
      details.push(`Found ${isolatedNodes.length} isolated node(s) with 0 connections`);
    }
    if (details.length === 0) {
      details.push('Graph structure is fully consistent and healthy');
    }

    return {
      isValid: danglingEdges.length === 0 && selfLoops.length === 0,
      totalNodes: nodes.length,
      totalEdges: edges.length,
      danglingEdges,
      isolatedNodes,
      selfLoops,
      details,
    };
  }

  public findNodeById(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM graph_nodes WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToNode(row);
  }

  public findNodeByEntity(
    projectId: string,
    entityType: GraphEntityType,
    entityId: string
  ): GraphNode | null {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_nodes
      WHERE project_id = ? AND entity_type = ? AND entity_id = ?
    `);
    const row = stmt.get(projectId, entityType, entityId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToNode(row);
  }

  public addEdge(params: CreateEdgeParams): GraphEdge {
    if (params.sourceNodeId === params.targetNodeId) {
      throw new ValidationError('Source and target node cannot be the same');
    }

    const now = Date.now();
    const edge: GraphEdge = {
      id: randomUUID(),
      projectId: params.projectId,
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      relationType: params.relationType,
      weight: params.weight ?? 1.0,
      metadataJson: this.serializeJson(params.metadata, '{}'),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_node_id, target_node_id, relation_type) DO UPDATE SET
        weight = excluded.weight,
        metadata_json = excluded.metadata_json
    `);

    stmt.run(
      edge.id,
      edge.projectId,
      edge.sourceNodeId,
      edge.targetNodeId,
      edge.relationType,
      edge.weight ?? 1.0,
      edge.metadataJson ?? null,
      edge.createdAt
    );

    return edge;
  }

  public getNeighbors(
    nodeId: string,
    direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'
  ): Array<{ node: GraphNode; edge: GraphEdge }> {
    const results: Array<{ node: GraphNode; edge: GraphEdge }> = [];

    if (direction === 'OUT' || direction === 'BOTH') {
      const stmt = this.db.prepare(`
        SELECT e.id as edge_id, e.project_id as edge_project_id, e.source_node_id, e.target_node_id,
               e.relation_type, e.weight, e.metadata_json as edge_metadata, e.created_at as edge_created_at,
               n.id as node_id, n.project_id as node_project_id, n.entity_type, n.entity_id,
               n.label, n.name, n.path, n.line_start, n.line_end, n.metadata_json as node_metadata, n.created_at as node_created_at
        FROM graph_edges e
        JOIN graph_nodes n ON e.target_node_id = n.id
        WHERE e.source_node_id = ?
      `);

      const rows = stmt.all(nodeId) as Record<string, unknown>[];
      for (const r of rows) {
        results.push({
          node: {
            id: String(r['node_id']),
            projectId: String(r['node_project_id']),
            entityType: r['entity_type'] as GraphEntityType,
            entityId: String(r['entity_id']),
            label: String(r['label']),
            name: r['name'] ? String(r['name']) : undefined,
            path: r['path'] ? String(r['path']) : undefined,
            lineStart: r['line_start'] != null ? Number(r['line_start']) : undefined,
            lineEnd: r['line_end'] != null ? Number(r['line_end']) : undefined,
            metadataJson: r['node_metadata'] ? String(r['node_metadata']) : undefined,
            createdAt: Number(r['node_created_at']),
          },
          edge: {
            id: String(r['edge_id']),
            projectId: String(r['edge_project_id']),
            sourceNodeId: String(r['source_node_id']),
            targetNodeId: String(r['target_node_id']),
            relationType: r['relation_type'] as GraphRelationType,
            weight: Number(r['weight']),
            metadataJson: r['edge_metadata'] ? String(r['edge_metadata']) : undefined,
            createdAt: Number(r['edge_created_at']),
          },
        });
      }
    }

    if (direction === 'IN' || direction === 'BOTH') {
      const stmt = this.db.prepare(`
        SELECT e.id as edge_id, e.project_id as edge_project_id, e.source_node_id, e.target_node_id,
               e.relation_type, e.weight, e.metadata_json as edge_metadata, e.created_at as edge_created_at,
               n.id as node_id, n.project_id as node_project_id, n.entity_type, n.entity_id,
               n.label, n.name, n.path, n.line_start, n.line_end, n.metadata_json as node_metadata, n.created_at as node_created_at
        FROM graph_edges e
        JOIN graph_nodes n ON e.source_node_id = n.id
        WHERE e.target_node_id = ?
      `);

      const rows = stmt.all(nodeId) as Record<string, unknown>[];
      for (const r of rows) {
        results.push({
          node: {
            id: String(r['node_id']),
            projectId: String(r['node_project_id']),
            entityType: r['entity_type'] as GraphEntityType,
            entityId: String(r['entity_id']),
            label: String(r['label']),
            name: r['name'] ? String(r['name']) : undefined,
            path: r['path'] ? String(r['path']) : undefined,
            lineStart: r['line_start'] != null ? Number(r['line_start']) : undefined,
            lineEnd: r['line_end'] != null ? Number(r['line_end']) : undefined,
            metadataJson: r['node_metadata'] ? String(r['node_metadata']) : undefined,
            createdAt: Number(r['node_created_at']),
          },
          edge: {
            id: String(r['edge_id']),
            projectId: String(r['edge_project_id']),
            sourceNodeId: String(r['source_node_id']),
            targetNodeId: String(r['target_node_id']),
            relationType: r['relation_type'] as GraphRelationType,
            weight: Number(r['weight']),
            metadataJson: r['edge_metadata'] ? String(r['edge_metadata']) : undefined,
            createdAt: Number(r['edge_created_at']),
          },
        });
      }
    }

    return results;
  }

  public findNodesByName(projectId: string, name: string): GraphNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_nodes
      WHERE project_id = ? AND (name = ? OR label = ?)
    `);
    const rows = stmt.all(projectId, name, name) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToNode(r));
  }

  public findNodesByPath(projectId: string, path: string): GraphNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_nodes
      WHERE project_id = ? AND path = ?
    `);
    const rows = stmt.all(projectId, path) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToNode(r));
  }

  public findNodesByType(projectId: string, entityType: GraphEntityType): GraphNode[] {
    const stmt = this.db.prepare(`
      SELECT * FROM graph_nodes
      WHERE project_id = ? AND entity_type = ?
    `);
    const rows = stmt.all(projectId, entityType) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToNode(r));
  }

  public findEdgesBySource(sourceNodeId: string, relationType?: GraphRelationType): GraphEdge[] {
    let query = 'SELECT * FROM graph_edges WHERE source_node_id = ?';
    const params: Array<string | number | null> = [sourceNodeId];
    if (relationType) {
      query += ' AND relation_type = ?';
      params.push(relationType);
    }
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToEdge(r));
  }

  public findEdgesByTarget(targetNodeId: string, relationType?: GraphRelationType): GraphEdge[] {
    let query = 'SELECT * FROM graph_edges WHERE target_node_id = ?';
    const params: Array<string | number | null> = [targetNodeId];
    if (relationType) {
      query += ' AND relation_type = ?';
      params.push(relationType);
    }
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToEdge(r));
  }

  public deleteEdgesBySource(sourceNodeId: string): void {
    const delEdges = this.db.prepare('DELETE FROM graph_edges WHERE source_node_id = ?');
    delEdges.run(sourceNodeId);
  }

  public deleteSymbolsByFileId(fileId: string, projectId?: string, filePath?: string): void {
    const delFts = this.db.prepare(`
      DELETE FROM fts_symbols WHERE symbol_id IN (SELECT id FROM symbols WHERE file_id = ?)
    `);
    delFts.run(fileId);

    const delSymbols = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    delSymbols.run(fileId);

    // Clean corresponding symbol nodes in graph_nodes to maintain graph idempotency
    let projId = projectId;
    let fPath = filePath;
    if (!projId || !fPath) {
      const fileRow = this.db.prepare('SELECT project_id, path FROM files WHERE id = ?').get(fileId) as
        | { project_id: string; path: string }
        | undefined;
      if (fileRow) {
        projId = projId ?? fileRow.project_id;
        fPath = fPath ?? fileRow.path;
      }
    }

    if (projId && fPath) {
      const symbolNodes = this.db.prepare(
        "SELECT id FROM graph_nodes WHERE project_id = ? AND path = ? AND entity_type = 'symbol'"
      ).all(projId, fPath) as Array<{ id: string }>;

      for (const node of symbolNodes) {
        this.db.prepare('DELETE FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?').run(node.id, node.id);
        this.db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(node.id);
      }
    }
  }

  public deleteFileGraph(projectId: string, filePath: string): void {
    const file = this.findFileByPath(projectId, filePath);
    if (!file) return;

    // 1. Find symbol nodes and file node for this path
    const nodes = this.findNodesByPath(projectId, filePath);
    for (const node of nodes) {
      // Deleting graph node will CASCADE delete edges in graph_edges
      const delNode = this.db.prepare('DELETE FROM graph_nodes WHERE id = ?');
      delNode.run(node.id);
    }

    // 2. Delete file node by entity_id if path didn't catch it
    const fileNode = this.findNodeByEntity(projectId, 'file', file.id);
    if (fileNode) {
      const delNode = this.db.prepare('DELETE FROM graph_nodes WHERE id = ?');
      delNode.run(fileNode.id);
    }

    // 3. Delete symbols
    this.deleteSymbolsByFileId(file.id);

    // 4. Delete file record
    const delFile = this.db.prepare('DELETE FROM files WHERE id = ?');
    delFile.run(file.id);
  }

  public updateFilePath(projectId: string, oldPath: string, newPath: string): void {
    const now = Date.now();
    const updateFiles = this.db.prepare(`
      UPDATE files SET path = ?, updated_at = ? WHERE project_id = ? AND path = ?
    `);
    updateFiles.run(newPath, now, projectId, oldPath);

    const updateNodes = this.db.prepare(`
      UPDATE graph_nodes SET path = ? WHERE project_id = ? AND path = ?
    `);
    updateNodes.run(newPath, projectId, oldPath);
  }

  private mapRowToFile(row: Record<string, unknown>): FileEntity {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      path: String(row['path']),
      language: row['language'] ? String(row['language']) : undefined,
      sizeBytes: Number(row['size_bytes']),
      lastModifiedAt: Number(row['last_modified_at']),
      contentHash: String(row['content_hash']),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  private mapRowToSymbol(row: Record<string, unknown>): SymbolEntity {
    return {
      id: String(row['id']),
      fileId: String(row['file_id']),
      projectId: String(row['project_id']),
      name: String(row['name']),
      kind: row['kind'] as SymbolKind,
      lineStart: Number(row['line_start']),
      lineEnd: Number(row['line_end']),
      signature: row['signature'] ? String(row['signature']) : undefined,
      docstring: row['docstring'] ? String(row['docstring']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }

  private mapRowToNode(row: Record<string, unknown>): GraphNode {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      entityType: row['entity_type'] as GraphEntityType,
      entityId: String(row['entity_id']),
      label: String(row['label']),
      name: row['name'] ? String(row['name']) : undefined,
      path: row['path'] ? String(row['path']) : undefined,
      lineStart: row['line_start'] != null ? Number(row['line_start']) : undefined,
      lineEnd: row['line_end'] != null ? Number(row['line_end']) : undefined,
      metadataJson: row['metadata_json'] ? String(row['metadata_json']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }

  private mapRowToEdge(row: Record<string, unknown>): GraphEdge {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      sourceNodeId: String(row['source_node_id']),
      targetNodeId: String(row['target_node_id']),
      relationType: row['relation_type'] as GraphRelationType,
      weight: Number(row['weight']),
      metadataJson: row['metadata_json'] ? String(row['metadata_json']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }
}
