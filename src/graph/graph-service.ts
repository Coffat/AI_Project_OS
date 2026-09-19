import type { DatabaseSync } from 'node:sqlite';
import {
  GraphNode,
  GraphEdge,
  GraphEntityType,
  GraphRelationType,
  GraphTraversalOptions,
  RankedGraphNode,
  GraphPathResult,
  TaskGraphContext,
  DecisionGraphContext,
  FileGraphContext,
  GraphIntegrityReport,
} from '../core/types.js';
import {
  CreateNodeParams,
  CreateEdgeParams,
  GraphRepository,
} from '../database/repositories/graph.repository.js';
import { NodeNotFoundError, ValidationError } from '../core/errors.js';

export class GraphService {
  private readonly repo: GraphRepository;

  constructor(dbOrRepo: DatabaseSync | GraphRepository) {
    if ('addNode' in dbOrRepo && typeof dbOrRepo.addNode === 'function') {
      this.repo = dbOrRepo;
    } else {
      this.repo = new GraphRepository(dbOrRepo as DatabaseSync);
    }
  }

  // ==========================================================================
  // 1. NODE & EDGE MANAGEMENT API
  // ==========================================================================

  public async addNode(params: CreateNodeParams): Promise<GraphNode> {
    return this.repo.addNode(params);
  }

  public async updateNode(nodeId: string, updates: Partial<CreateNodeParams>): Promise<GraphNode> {
    return this.repo.updateNode(nodeId, updates);
  }

  public async removeNode(nodeId: string): Promise<boolean> {
    return this.repo.removeNode(nodeId);
  }

  public async addEdge(params: CreateEdgeParams): Promise<GraphEdge> {
    return this.repo.addEdge(params);
  }

  public async removeEdge(edgeId: string): Promise<boolean> {
    return this.repo.removeEdge(edgeId);
  }

  public async removeEdgeByEndpoints(
    sourceNodeId: string,
    targetNodeId: string,
    relationType?: GraphRelationType
  ): Promise<boolean> {
    return this.repo.removeEdgeByEndpoints(sourceNodeId, targetNodeId, relationType);
  }

  public async getNode(nodeId: string): Promise<GraphNode | null> {
    return this.repo.findNodeById(nodeId);
  }

  public async resolveNode(identifier: string, projectId?: string): Promise<GraphNode | null> {
    return this.repo.findNodeByIdOrEntity(projectId, identifier);
  }

  // ==========================================================================
  // 2. NEIGHBORS & TRAVERSAL WITH DEPTH LIMITS
  // ==========================================================================

  public async getNeighbors(
    nodeIdOrEntity: string,
    options: GraphTraversalOptions & { projectId?: string } = {}
  ): Promise<Array<{ node: GraphNode; edge: GraphEdge; depth: number }>> {
    const startNode = await this.resolveRequiredNode(nodeIdOrEntity, options.projectId);
    const direction = options.direction ?? 'BOTH';
    const rawMaxDepth = options.maxDepth ?? 1;
    // Bounded depth: max 6 to prevent runaway scans
    const maxDepth = Math.max(1, Math.min(rawMaxDepth, 6));

    const results: Array<{ node: GraphNode; edge: GraphEdge; depth: number }> = [];
    const visitedNodes = new Set<string>([startNode.id]);
    const queue: Array<{ nodeId: string; currentDepth: number }> = [{ nodeId: startNode.id, currentDepth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.currentDepth >= maxDepth) continue;

      const rawNeighbors = this.repo.getNeighbors(current.nodeId, direction);

      for (const item of rawNeighbors) {
        // Filter by relation type if specified
        if (options.relationTypes && options.relationTypes.length > 0) {
          if (!options.relationTypes.includes(item.edge.relationType)) {
            continue;
          }
        }

        // Filter by entity type if specified
        if (options.entityTypes && options.entityTypes.length > 0) {
          if (!options.entityTypes.includes(item.node.entityType)) {
            continue;
          }
        }

        if (!visitedNodes.has(item.node.id)) {
          visitedNodes.add(item.node.id);
          const nextDepth = current.currentDepth + 1;
          results.push({
            node: item.node,
            edge: item.edge,
            depth: nextDepth,
          });

          if (nextDepth < maxDepth) {
            queue.push({ nodeId: item.node.id, currentDepth: nextDepth });
          }
        }
      }
    }

    if (options.limit && options.limit > 0) {
      return results.slice(0, options.limit);
    }
    return results;
  }

  // ==========================================================================
  // 3. SHORTEST PATH FINDING (BFS WITH BOUNDED DEPTH)
  // ==========================================================================

  public async findPath(
    startNodeOrEntity: string,
    endNodeOrEntity: string,
    options: {
      maxDepth?: number;
      directed?: boolean;
      allowedRelations?: GraphRelationType[];
      projectId?: string;
    } = {}
  ): Promise<GraphPathResult | null> {
    const startNode = await this.resolveRequiredNode(startNodeOrEntity, options.projectId);
    const endNode = await this.resolveRequiredNode(endNodeOrEntity, options.projectId);

    if (startNode.id === endNode.id) {
      return {
        nodes: [startNode],
        edges: [],
        distance: 0,
        totalWeight: 0,
      };
    }

    const rawMaxDepth = options.maxDepth ?? 5;
    const maxDepth = Math.max(1, Math.min(rawMaxDepth, 8));
    const direction = options.directed ? 'OUT' : 'BOTH';

    const visited = new Set<string>([startNode.id]);
    const queue: Array<{
      current: GraphNode;
      pathNodes: GraphNode[];
      pathEdges: GraphEdge[];
      depth: number;
      weight: number;
    }> = [
      {
        current: startNode,
        pathNodes: [startNode],
        pathEdges: [],
        depth: 0,
        weight: 0,
      },
    ];

    while (queue.length > 0) {
      const step = queue.shift()!;
      if (step.depth >= maxDepth) continue;

      const neighbors = this.repo.getNeighbors(step.current.id, direction);

      for (const nb of neighbors) {
        if (options.allowedRelations && !options.allowedRelations.includes(nb.edge.relationType)) {
          continue;
        }

        if (nb.node.id === endNode.id) {
          const finalNodes = [...step.pathNodes, nb.node];
          const finalEdges = [...step.pathEdges, nb.edge];
          return {
            nodes: finalNodes,
            edges: finalEdges,
            distance: step.depth + 1,
            totalWeight: step.weight + (nb.edge.weight ?? 1.0),
          };
        }

        if (!visited.has(nb.node.id)) {
          visited.add(nb.node.id);
          queue.push({
            current: nb.node,
            pathNodes: [...step.pathNodes, nb.node],
            pathEdges: [...step.pathEdges, nb.edge],
            depth: step.depth + 1,
            weight: step.weight + (nb.edge.weight ?? 1.0),
          });
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // 4. DEPENDENCIES & DEPENDENTS
  // ==========================================================================

  public async findDependencies(
    nodeOrEntity: string,
    options: { maxDepth?: number; projectId?: string } = {}
  ): Promise<Array<{ node: GraphNode; relation: GraphRelationType; depth: number }>> {
    const dependencyRelations: GraphRelationType[] = [
      'depends_on',
      'imports',
      'calls',
      'modifies',
      'implements',
      'constrained_by',
      'dependency',
    ];

    const neighbors = await this.getNeighbors(nodeOrEntity, {
      direction: 'OUT',
      maxDepth: options.maxDepth ?? 3,
      relationTypes: dependencyRelations,
      projectId: options.projectId,
    });

    return neighbors.map((n) => ({
      node: n.node,
      relation: n.edge.relationType,
      depth: n.depth,
    }));
  }

  public async findDependents(
    nodeOrEntity: string,
    options: { maxDepth?: number; projectId?: string } = {}
  ): Promise<Array<{ node: GraphNode; relation: GraphRelationType; depth: number }>> {
    const dependencyRelations: GraphRelationType[] = [
      'depends_on',
      'imports',
      'calls',
      'modifies',
      'implements',
      'constrained_by',
      'dependency',
    ];

    const neighbors = await this.getNeighbors(nodeOrEntity, {
      direction: 'IN',
      maxDepth: options.maxDepth ?? 3,
      relationTypes: dependencyRelations,
      projectId: options.projectId,
    });

    return neighbors.map((n) => ({
      node: n.node,
      relation: n.edge.relationType,
      depth: n.depth,
    }));
  }

  // ==========================================================================
  // 5. MULTI-FACTOR RANKING & FIND RELATED
  // ==========================================================================

  public async findRelated(
    nodeOrEntity: string,
    options: {
      maxDepth?: number;
      entityTypes?: GraphEntityType[];
      relationTypes?: GraphRelationType[];
      limit?: number;
      minScore?: number;
      projectId?: string;
    } = {}
  ): Promise<RankedGraphNode[]> {
    const startNode = await this.resolveRequiredNode(nodeOrEntity, options.projectId);
    const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 3, 5));

    // Explore subgraph up to maxDepth
    const neighborsWithEdges = await this.getNeighbors(startNode.id, {
      direction: 'BOTH',
      maxDepth,
      relationTypes: options.relationTypes,
      entityTypes: options.entityTypes,
      projectId: options.projectId,
    });

    const rankedList: RankedGraphNode[] = [];
    const sourceModule = this.extractModuleNamespace(startNode);

    for (const item of neighborsWithEdges) {
      if (item.node.id === startNode.id) continue;

      let score = 0;
      const reasons: string[] = [];

      // 1. Direct Relation
      if (item.depth === 1) {
        score += 100;
        reasons.push('Direct 1-hop relation (+100)');
      } else if (item.depth === 2) {
        score += 45;
        reasons.push('2-hop neighborhood (+45)');
      } else {
        const decayScore = Math.max(5, Math.round(30 / item.depth));
        score += decayScore;
        reasons.push(`${item.depth}-hop distance (+${decayScore})`);
      }

      // 2. Same Module
      const targetModule = this.extractModuleNamespace(item.node);
      if (sourceModule && targetModule && sourceModule === targetModule) {
        score += 35;
        reasons.push(`Same module/subsystem '${sourceModule}' (+35)`);
      }

      // 3. Dependency Relation
      const rel = item.edge.relationType;
      if (['depends_on', 'imports', 'calls', 'modifies', 'dependency', 'implements'].includes(rel)) {
        score += 50;
        reasons.push(`Dependency relation: ${rel} (+50)`);
      }

      // 4. Task History Relation
      if (item.node.entityType === 'task' || rel === 'modifies' || rel === 'affects') {
        score += 30;
        reasons.push('Task execution / history relation (+30)');
      }

      // 5. Decision Relation
      if (item.node.entityType === 'decision' || rel === 'decides') {
        score += 40;
        reasons.push('Architectural decision relation (+40)');
      }

      // 6. Constraint Relation
      if (item.node.entityType === 'constraint' || rel === 'constrained_by' || rel === 'validates') {
        score += 45;
        reasons.push('Active constraint / governance rule (+45)');
      }

      // Edge weight multiplier bonus
      if (item.edge.weight && item.edge.weight > 1.0) {
        const weightBonus = Math.round((item.edge.weight - 1.0) * 10);
        score += weightBonus;
        reasons.push(`Edge weight boost (+${weightBonus})`);
      }

      if (options.minScore && score < options.minScore) {
        continue;
      }

      rankedList.push({
        node: item.node,
        score,
        distance: item.depth,
        reasons,
      });
    }

    // Sort descending by score, then ascending by distance
    rankedList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distance - b.distance;
    });

    if (options.limit && options.limit > 0) {
      return rankedList.slice(0, options.limit);
    }
    return rankedList;
  }

  // ==========================================================================
  // 6. TASK CONTEXT (Unified 4-Graph Query)
  // ==========================================================================

  public async findTaskContext(
    taskIdOrNode: string,
    options: { maxDepth?: number; projectId?: string } = {}
  ): Promise<TaskGraphContext> {
    const taskNode = await this.resolveRequiredNode(taskIdOrNode, options.projectId);
    const maxDepth = options.maxDepth ?? 2;

    const rankedRelated = await this.findRelated(taskNode.id, {
      maxDepth,
      projectId: options.projectId,
    });

    // Gather specific categories
    const modifiedFiles: Array<{ node: GraphNode; path: string; score: number }> = [];
    const dependencies: Array<{ node: GraphNode; relation: GraphRelationType; depth: number }> = [];
    const decisions: Array<{ node: GraphNode; label: string; relation: GraphRelationType }> = [];
    const constraints: Array<{ node: GraphNode; label: string; relation: GraphRelationType }> = [];
    const symbols: Array<{ node: GraphNode; name: string }> = [];
    const tests: Array<{ node: GraphNode; path: string }> = [];
    const memories: Array<{ node: GraphNode; label: string }> = [];

    // Also inspect direct edges from task
    const directNeighbors = await this.getNeighbors(taskNode.id, {
      direction: 'BOTH',
      maxDepth: 1,
      projectId: options.projectId,
    });

    for (const nb of directNeighbors) {
      if (nb.edge.relationType === 'depends_on' || nb.edge.relationType === 'dependency') {
        dependencies.push({ node: nb.node, relation: nb.edge.relationType, depth: 1 });
      }
      if (nb.node.entityType === 'file' && (nb.edge.relationType === 'modifies' || nb.edge.relationType === 'affects')) {
        const matchingRank = rankedRelated.find((r) => r.node.id === nb.node.id);
        modifiedFiles.push({
          node: nb.node,
          path: nb.node.path || nb.node.label,
          score: matchingRank?.score ?? 100,
        });
      }
    }

    for (const item of rankedRelated) {
      const node = item.node;
      if (node.entityType === 'decision') {
        decisions.push({
          node,
          label: node.label,
          relation: 'depends_on',
        });
      } else if (node.entityType === 'constraint') {
        constraints.push({
          node,
          label: node.label,
          relation: 'constrained_by',
        });
      } else if (node.entityType === 'symbol') {
        symbols.push({
          node,
          name: node.name || node.label,
        });
      } else if (node.entityType === 'test' || (node.path && (node.path.includes('.test.') || node.path.includes('.spec.')))) {
        tests.push({
          node,
          path: node.path || node.label,
        });
      } else if (node.entityType === 'memory' || node.entityType === 'research') {
        memories.push({
          node,
          label: node.label,
        });
      } else if (node.entityType === 'file' && !modifiedFiles.some((f) => f.node.id === node.id)) {
        // Connected files (e.g. imports of modified files or tested files)
        modifiedFiles.push({
          node,
          path: node.path || node.label,
          score: item.score,
        });
      }
    }

    return {
      taskNode,
      modifiedFiles,
      dependencies,
      decisions,
      constraints,
      symbols,
      tests,
      memories,
      rankedRelated,
    };
  }

  // ==========================================================================
  // 7. DECISION CONTEXT (ADR & Architecture Governance Query)
  // ==========================================================================

  public async findDecisionContext(
    decisionIdOrNode: string,
    options: { maxDepth?: number; projectId?: string } = {}
  ): Promise<DecisionGraphContext> {
    const decisionNode = await this.resolveRequiredNode(decisionIdOrNode, options.projectId);
    const maxDepth = options.maxDepth ?? 2;

    const rankedRelated = await this.findRelated(decisionNode.id, {
      maxDepth,
      projectId: options.projectId,
    });

    const constraints: Array<{ node: GraphNode; label: string }> = [];
    const dependentTasks: Array<{ node: GraphNode; label: string }> = [];
    const affectedFiles: Array<{ node: GraphNode; path: string }> = [];
    const affectedSymbols: Array<{ node: GraphNode; name: string }> = [];
    const relatedMemories: Array<{ node: GraphNode; label: string }> = [];

    for (const item of rankedRelated) {
      const node = item.node;
      if (node.entityType === 'constraint') {
        constraints.push({ node, label: node.label });
      } else if (node.entityType === 'task') {
        dependentTasks.push({ node, label: node.label });
      } else if (node.entityType === 'file') {
        affectedFiles.push({ node, path: node.path || node.label });
      } else if (node.entityType === 'symbol') {
        affectedSymbols.push({ node, name: node.name || node.label });
      } else if (node.entityType === 'memory' || node.entityType === 'research') {
        relatedMemories.push({ node, label: node.label });
      }
    }

    return {
      decisionNode,
      constraints,
      dependentTasks,
      affectedFiles,
      affectedSymbols,
      relatedMemories,
    };
  }

  // ==========================================================================
  // 8. FILE CONTEXT & RELEVANT FILES
  // ==========================================================================

  public async findFileContext(
    filePathOrNode: string,
    options: { maxDepth?: number; projectId?: string } = {}
  ): Promise<FileGraphContext> {
    const fileNode = await this.resolveRequiredNode(filePathOrNode, options.projectId);
    const neighbors = await this.getNeighbors(fileNode.id, {
      direction: 'BOTH',
      maxDepth: options.maxDepth ?? 2,
      projectId: options.projectId,
    });

    const modifyingTasks: Array<{ node: GraphNode; label: string }> = [];
    const relatedTests: Array<{ node: GraphNode; path: string }> = [];
    const importedFiles: Array<{ node: GraphNode; path: string }> = [];
    const importerFiles: Array<{ node: GraphNode; path: string }> = [];
    const symbols: Array<{ node: GraphNode; name: string; kind?: string }> = [];
    const relatedDecisions: Array<{ node: GraphNode; label: string }> = [];

    for (const item of neighbors) {
      const n = item.node;
      const rel = item.edge.relationType;

      if (n.entityType === 'task') {
        modifyingTasks.push({ node: n, label: n.label });
      } else if (rel === 'tested_by' || rel === 'tests' || (n.path && (n.path.includes('.test.') || n.path.includes('.spec.')))) {
        relatedTests.push({ node: n, path: n.path || n.label });
      } else if (rel === 'imports' && item.edge.sourceNodeId === fileNode.id) {
        importedFiles.push({ node: n, path: n.path || n.label });
      } else if (rel === 'imports' && item.edge.targetNodeId === fileNode.id) {
        importerFiles.push({ node: n, path: n.path || n.label });
      } else if (n.entityType === 'symbol') {
        symbols.push({ node: n, name: n.name || n.label, kind: n.metadataJson ? JSON.parse(n.metadataJson).kind : undefined });
      } else if (n.entityType === 'decision') {
        relatedDecisions.push({ node: n, label: n.label });
      }
    }

    return {
      fileNode,
      path: fileNode.path || fileNode.label,
      modifyingTasks,
      relatedTests,
      importedFiles,
      importerFiles,
      symbols,
      relatedDecisions,
    };
  }

  public async findRelevantFiles(
    targetOrNode: string,
    options: { maxDepth?: number; limit?: number; projectId?: string } = {}
  ): Promise<Array<{ fileNode: GraphNode; path: string; score: number; reasons: string[] }>> {
    const startNode = await this.resolveRequiredNode(targetOrNode, options.projectId);
    const ranked = await this.findRelated(startNode.id, {
      maxDepth: options.maxDepth ?? 3,
      projectId: options.projectId,
    });

    const fileList: Array<{ fileNode: GraphNode; path: string; score: number; reasons: string[] }> = [];

    for (const item of ranked) {
      if (item.node.entityType === 'file' || (item.node.path && item.node.entityType !== 'task')) {
        const filePath = item.node.path || item.node.label;
        if (!fileList.some((f) => f.path === filePath)) {
          fileList.push({
            fileNode: item.node,
            path: filePath,
            score: item.score,
            reasons: item.reasons,
          });
        }
      }
    }

    if (options.limit && options.limit > 0) {
      return fileList.slice(0, options.limit);
    }
    return fileList;
  }

  // ==========================================================================
  // 9. GRAPH INTEGRITY VERIFICATION
  // ==========================================================================

  public async verifyGraphIntegrity(projectId?: string): Promise<GraphIntegrityReport> {
    return this.repo.checkIntegrity(projectId);
  }

  // ==========================================================================
  // INTERNAL HELPERS
  // ==========================================================================

  private async resolveRequiredNode(identifier: string, projectId?: string): Promise<GraphNode> {
    if (!identifier || identifier.trim() === '') {
      throw new ValidationError('Graph node identifier cannot be empty');
    }

    const node = await this.resolveNode(identifier.trim(), projectId);
    if (!node) {
      throw new NodeNotFoundError(identifier);
    }
    return node;
  }

  private extractModuleNamespace(node: GraphNode): string | null {
    if (node.path) {
      const parts = node.path.split(/[/\\]/).filter(Boolean);
      if (parts.length > 1) {
        // Return first 1 or 2 directory segments (e.g., 'src/auth' or 'src/database')
        if (parts[0] === 'src' && parts.length > 2) {
          return `${parts[0]}/${parts[1]}`;
        }
        return parts[0]!;
      }
    }
    if (node.entityType === 'module') {
      return node.name || node.label;
    }
    return null;
  }
}
