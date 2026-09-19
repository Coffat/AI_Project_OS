import type { DatabaseSync } from 'node:sqlite';
import { GraphNode, GraphEdge } from '../core/types.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import { GraphService } from './graph-service.js';

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
  public readonly service: GraphService;
  private readonly repo: GraphRepository;

  constructor(db: DatabaseSync) {
    this.repo = new GraphRepository(db);
    this.service = new GraphService(this.repo);
  }

  public async addNode(node: GraphNode): Promise<void> {
    await this.service.addNode({
      projectId: node.projectId,
      entityType: node.entityType,
      entityId: node.entityId,
      label: node.label,
      name: node.name,
      path: node.path,
      lineStart: node.lineStart,
      lineEnd: node.lineEnd,
      metadata: node.metadataJson ? JSON.parse(node.metadataJson) : undefined,
    });
  }

  public async addEdge(edge: GraphEdge): Promise<void> {
    await this.service.addEdge({
      projectId: edge.projectId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      relationType: edge.relationType,
      weight: edge.weight,
      metadata: edge.metadataJson ? JSON.parse(edge.metadataJson) : undefined,
    });
  }

  public async getNode(nodeId: string): Promise<GraphNode | null> {
    return this.service.getNode(nodeId);
  }

  public async getNeighbors(
    nodeId: string,
    direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'
  ): Promise<Array<{ node: GraphNode; edge: GraphEdge }>> {
    return this.repo.getNeighbors(nodeId, direction);
  }
}

