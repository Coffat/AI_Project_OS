import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { NodeNotFoundError } from '../../src/core/errors.js';

describe('GraphService (Project Knowledge Graph Engine)', () => {
  let client: SQLiteDatabaseClient;
  let service: GraphService;
  let projectId: string;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    service = new GraphService(client.db);
    const projectRepo = new ProjectRepository(client.db);
    const proj = projectRepo.create({
      name: 'Graph Test Project',
      rootPath: '/workspace/test',
    });
    projectId = proj.id;
  });

  afterEach(() => {
    client.close();
  });

  // 1. Basic Node & Edge CRUD
  describe('Node and Edge Management', () => {
    it('creates, reads, updates, and removes nodes', async () => {
      const node = await service.addNode({
        projectId,
        entityType: 'task',
        entityId: 'TASK-100',
        label: 'Implement Auth Service',
        name: 'auth_task',
        metadata: { priority: 'high' },
      });

      expect(node.id).toBeDefined();
      expect(node.label).toBe('Implement Auth Service');

      const retrieved = await service.getNode(node.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.entityId).toBe('TASK-100');

      const updated = await service.updateNode(node.id, {
        label: 'Implement Enhanced Auth Service',
        metadata: { priority: 'critical' },
      });
      expect(updated.label).toBe('Implement Enhanced Auth Service');

      const removed = await service.removeNode(node.id);
      expect(removed).toBe(true);

      const afterRemove = await service.getNode(node.id);
      expect(afterRemove).toBeNull();
    });

    it('creates, queries, and removes edges', async () => {
      const nodeA = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/a.ts',
        label: 'a.ts',
        path: 'src/a.ts',
      });
      const nodeB = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/b.ts',
        label: 'b.ts',
        path: 'src/b.ts',
      });

      const edge = await service.addEdge({
        projectId,
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
        relationType: 'imports',
        weight: 1.5,
      });

      expect(edge.id).toBeDefined();
      expect(edge.relationType).toBe('imports');
      expect(edge.weight).toBe(1.5);

      const neighbors = await service.getNeighbors(nodeA.id, { direction: 'OUT' });
      expect(neighbors).toHaveLength(1);
      expect(neighbors[0]!.node.id).toBe(nodeB.id);

      const removed = await service.removeEdge(edge.id);
      expect(removed).toBe(true);

      const afterNeighbors = await service.getNeighbors(nodeA.id, { direction: 'OUT' });
      expect(afterNeighbors).toHaveLength(0);
    });

    it('cascades edge deletion when a node is removed', async () => {
      const nodeA = await service.addNode({
        projectId,
        entityType: 'task',
        entityId: 'TASK-001',
        label: 'Task 1',
      });
      const nodeB = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/main.ts',
        label: 'main.ts',
      });

      await service.addEdge({
        projectId,
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
        relationType: 'modifies',
      });

      await service.removeNode(nodeA.id);

      const neighbors = await service.getNeighbors(nodeB.id, { direction: 'IN' });
      expect(neighbors).toHaveLength(0);
    });
  });

  // 2. Full 4-Graph Integration Scenario
  describe('4-Graph Unified Relationships', () => {
    let taskNodeId: string;
    let oauthFileNodeId: string;
    let tokenFileNodeId: string;
    let testFileNodeId: string;
    let decisionNodeId: string;
    let securityConstraintNodeId: string;

    beforeEach(async () => {
      // 1. Task Graph: TASK-042
      const task = await service.addNode({
        projectId,
        entityType: 'task',
        entityId: 'TASK-042',
        label: 'Implement OAuth PKCE Flow',
        name: 'TASK-042',
      });
      taskNodeId = task.id;

      // 2. Code Graph: oauth.ts & token.ts
      const oauth = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/auth/oauth.ts',
        label: 'oauth.ts',
        path: 'src/auth/oauth.ts',
      });
      oauthFileNodeId = oauth.id;

      const token = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/auth/token.ts',
        label: 'token.ts',
        path: 'src/auth/token.ts',
      });
      tokenFileNodeId = token.id;

      const test = await service.addNode({
        projectId,
        entityType: 'test',
        entityId: 'tests/auth/oauth.test.ts',
        label: 'oauth.test.ts',
        path: 'tests/auth/oauth.test.ts',
      });
      testFileNodeId = test.id;

      // 3. Decision Graph: DECISION-012
      const dec = await service.addNode({
        projectId,
        entityType: 'decision',
        entityId: 'DECISION-012',
        label: 'Use SHA-256 for PKCE Code Challenge',
      });
      decisionNodeId = dec.id;

      // 4. Memory / Constraint Graph: SECURITY-003
      const sec = await service.addNode({
        projectId,
        entityType: 'constraint',
        entityId: 'SECURITY-003',
        label: 'Require Cryptographic Nonce and SHA-256 for OAuth',
      });
      securityConstraintNodeId = sec.id;

      // Wire edges as specified in prompt:
      // TASK-042 -> modifies -> oauth.ts
      await service.addEdge({
        projectId,
        sourceNodeId: taskNodeId,
        targetNodeId: oauthFileNodeId,
        relationType: 'modifies',
      });

      // TASK-042 -> depends_on -> DECISION-012
      await service.addEdge({
        projectId,
        sourceNodeId: taskNodeId,
        targetNodeId: decisionNodeId,
        relationType: 'depends_on',
      });

      // oauth.ts -> imports -> token.ts
      await service.addEdge({
        projectId,
        sourceNodeId: oauthFileNodeId,
        targetNodeId: tokenFileNodeId,
        relationType: 'imports',
      });

      // oauth.ts -> tested_by -> oauth.test.ts
      await service.addEdge({
        projectId,
        sourceNodeId: oauthFileNodeId,
        targetNodeId: testFileNodeId,
        relationType: 'tested_by',
      });

      // DECISION-012 -> constrained_by -> SECURITY-003
      await service.addEdge({
        projectId,
        sourceNodeId: decisionNodeId,
        targetNodeId: securityConstraintNodeId,
        relationType: 'constrained_by',
      });
    });

    it('resolves nodes by human-readable identifiers and entity IDs', async () => {
      const task = await service.resolveNode('TASK-042', projectId);
      expect(task).not.toBeNull();
      expect(task?.id).toBe(taskNodeId);

      const decision = await service.resolveNode('DECISION-012', projectId);
      expect(decision).not.toBeNull();
      expect(decision?.id).toBe(decisionNodeId);

      const file = await service.resolveNode('src/auth/oauth.ts', projectId);
      expect(file).not.toBeNull();
      expect(file?.id).toBe(oauthFileNodeId);
    });

    it('findPath discovers shortest path across heterogeneous graphs', async () => {
      // Find path from TASK-042 to SECURITY-003
      // Expected: TASK-042 -> DECISION-012 -> SECURITY-003 (2 hops)
      const pathResult = await service.findPath('TASK-042', 'SECURITY-003', { projectId });
      expect(pathResult).not.toBeNull();
      expect(pathResult?.distance).toBe(2);
      expect(pathResult?.nodes.map((n) => n.label)).toEqual([
        'Implement OAuth PKCE Flow',
        'Use SHA-256 for PKCE Code Challenge',
        'Require Cryptographic Nonce and SHA-256 for OAuth',
      ]);
      expect(pathResult?.edges.map((e) => e.relationType)).toEqual([
        'depends_on',
        'constrained_by',
      ]);
    });

    it('findDependencies and findDependents trace outgoing and incoming chains', async () => {
      const deps = await service.findDependencies('TASK-042', { projectId, maxDepth: 2 });
      const depLabels = deps.map((d) => d.node.label);

      expect(depLabels).toContain('oauth.ts');
      expect(depLabels).toContain('Use SHA-256 for PKCE Code Challenge');

      // Dependents on SECURITY-003
      const dependents = await service.findDependents('SECURITY-003', { projectId, maxDepth: 2 });
      const dependentLabels = dependents.map((d) => d.node.label);
      expect(dependentLabels).toContain('Use SHA-256 for PKCE Code Challenge');
    });

    it('findTaskContext unifies files, decisions, constraints, and tests', async () => {
      const context = await service.findTaskContext('TASK-042', { projectId, maxDepth: 2 });

      expect(context.taskNode.entityId).toBe('TASK-042');
      expect(context.modifiedFiles.map((f) => f.path)).toContain('src/auth/oauth.ts');
      expect(context.decisions.map((d) => d.label)).toContain('Use SHA-256 for PKCE Code Challenge');
      expect(context.constraints.map((c) => c.label)).toContain('Require Cryptographic Nonce and SHA-256 for OAuth');
      expect(context.tests.map((t) => t.path)).toContain('tests/auth/oauth.test.ts');
      expect(context.rankedRelated.length).toBeGreaterThan(0);
    });

    it('findDecisionContext retrieves constraints and dependent tasks', async () => {
      const context = await service.findDecisionContext('DECISION-012', { projectId, maxDepth: 2 });

      expect(context.decisionNode.entityId).toBe('DECISION-012');
      expect(context.constraints.map((c) => c.label)).toContain('Require Cryptographic Nonce and SHA-256 for OAuth');
      expect(context.dependentTasks.map((t) => t.label)).toContain('Implement OAuth PKCE Flow');
    });

    it('findRelevantFiles discovers and ranks connected files', async () => {
      const files = await service.findRelevantFiles('TASK-042', { projectId, maxDepth: 2 });

      const paths = files.map((f) => f.path);
      expect(paths).toContain('src/auth/oauth.ts');
      expect(paths).toContain('src/auth/token.ts');
      expect(paths).toContain('tests/auth/oauth.test.ts');

      // Direct modified file should have high relevance score
      const oauthFile = files.find((f) => f.path === 'src/auth/oauth.ts');
      expect(oauthFile?.score).toBeGreaterThanOrEqual(100);
      expect(oauthFile?.reasons.some((r) => r.includes('Direct 1-hop'))).toBe(true);
    });
  });

  // 3. Depth-Bounded Traversal Enforcement
  describe('Strict Depth Limits & Bounded Traversal', () => {
    it('strictly confines traversal to maxDepth and does not scan distant nodes', async () => {
      // Create a chain of 6 nodes: N0 -> N1 -> N2 -> N3 -> N4 -> N5
      const nodes = [];
      for (let i = 0; i <= 5; i++) {
        const node = await service.addNode({
          projectId,
          entityType: 'file',
          entityId: `src/chain_${i}.ts`,
          label: `chain_${i}.ts`,
          path: `src/chain_${i}.ts`,
        });
        nodes.push(node);
      }

      for (let i = 0; i < 5; i++) {
        await service.addEdge({
          projectId,
          sourceNodeId: nodes[i]!.id,
          targetNodeId: nodes[i + 1]!.id,
          relationType: 'imports',
        });
      }

      // Max depth = 2 from N0
      const neighborsDepth2 = await service.getNeighbors(nodes[0]!.id, {
        direction: 'OUT',
        maxDepth: 2,
        projectId,
      });

      const neighborIds = neighborsDepth2.map((n) => n.node.id);
      expect(neighborIds).toContain(nodes[1]!.id); // 1-hop
      expect(neighborIds).toContain(nodes[2]!.id); // 2-hop
      expect(neighborIds).not.toContain(nodes[3]!.id); // 3-hop (PRUNED)
      expect(neighborIds).not.toContain(nodes[4]!.id); // 4-hop (PRUNED)
      expect(neighborIds).not.toContain(nodes[5]!.id); // 5-hop (PRUNED)
    });
  });

  // 4. Multi-Factor Ranking Engine
  describe('Multi-Factor Ranking Engine', () => {
    it('applies bonuses for direct relation, same module, dependency, decision, and constraint', async () => {
      const startNode = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/services/user-service.ts',
        label: 'user-service.ts',
        path: 'src/services/user-service.ts',
      });

      // Target 1: Same module + Direct dependency
      const targetSameModule = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/services/user-helper.ts',
        label: 'user-helper.ts',
        path: 'src/services/user-helper.ts',
      });

      await service.addEdge({
        projectId,
        sourceNodeId: startNode.id,
        targetNodeId: targetSameModule.id,
        relationType: 'imports',
      });

      // Target 2: Different module, direct call
      const targetDiffModule = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/utils/string.ts',
        label: 'string.ts',
        path: 'src/utils/string.ts',
      });

      await service.addEdge({
        projectId,
        sourceNodeId: startNode.id,
        targetNodeId: targetDiffModule.id,
        relationType: 'calls',
      });

      const ranked = await service.findRelated(startNode.id, { projectId, maxDepth: 1 });

      const sameModuleRank = ranked.find((r) => r.node.id === targetSameModule.id);
      const diffModuleRank = ranked.find((r) => r.node.id === targetDiffModule.id);

      expect(sameModuleRank).toBeDefined();
      expect(diffModuleRank).toBeDefined();

      // Same module gets +35 bonus, so it ranks higher
      expect(sameModuleRank!.score).toBeGreaterThan(diffModuleRank!.score);
      expect(sameModuleRank!.reasons.some((r) => r.includes('Same module'))).toBe(true);
    });
  });

  // 5. Graph Integrity Verification
  describe('Graph Integrity Verification', () => {
    it('reports valid status on healthy graph', async () => {
      const nodeA = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/ok_a.ts',
        label: 'ok_a.ts',
      });
      const nodeB = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/ok_b.ts',
        label: 'ok_b.ts',
      });

      await service.addEdge({
        projectId,
        sourceNodeId: nodeA.id,
        targetNodeId: nodeB.id,
        relationType: 'imports',
      });

      const report = await service.verifyGraphIntegrity(projectId);
      expect(report.isValid).toBe(true);
      expect(report.danglingEdges).toHaveLength(0);
      expect(report.selfLoops).toHaveLength(0);
    });

    it('detects dangling edges if edge references a missing node', async () => {
      const nodeA = await service.addNode({
        projectId,
        entityType: 'file',
        entityId: 'src/dangling_src.ts',
        label: 'dangling_src.ts',
      });

      // Temporarily disable foreign keys to force-insert a corrupted edge
      client.db.exec('PRAGMA foreign_keys = OFF;');
      client.db.prepare(`
        INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation_type, weight, created_at)
        VALUES ('bad_edge_1', ?, ?, 'nonexistent_target_id', 'imports', 1.0, ?)
      `).run(projectId, nodeA.id, Date.now());
      client.db.exec('PRAGMA foreign_keys = ON;');

      const report = await service.verifyGraphIntegrity(projectId);
      expect(report.isValid).toBe(false);
      expect(report.danglingEdges.length).toBeGreaterThan(0);
      expect(report.danglingEdges[0]!.missingNodeId).toBe('nonexistent_target_id');
      expect(report.details.some((d) => d.includes('dangling edge'))).toBe(true);
    });

    it('throws NodeNotFoundError when attempting to query an invalid node', async () => {
      await expect(service.getNeighbors('NONEXISTENT_NODE_XYZ', { projectId }))
        .rejects.toThrow(NodeNotFoundError);
    });
  });
});
