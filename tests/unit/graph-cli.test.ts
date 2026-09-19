import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { GraphCLI } from '../../src/graph/graph-cli.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';

describe('GraphCLI (Terminal Graph Inspection)', () => {
  let client: SQLiteDatabaseClient;
  let service: GraphService;
  let cli: GraphCLI;
  let projectId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    service = new GraphService(client.db);
    cli = new GraphCLI(client.db);

    const projectRepo = new ProjectRepository(client.db);
    const proj = projectRepo.create({
      name: 'CLI Graph Test Project',
      rootPath: '/workspace/cli-test',
    });
    projectId = proj.id;

    // Build the test scenario:
    // TASK-042 -> modifies -> oauth.ts
    // TASK-042 -> depends_on -> DECISION-012
    // oauth.ts -> imports -> token.ts
    // oauth.ts -> tested_by -> oauth.test.ts
    // DECISION-012 -> constrained_by -> SECURITY-003
    const task = await service.addNode({
      projectId,
      entityType: 'task',
      entityId: 'TASK-042',
      label: 'Implement OAuth Flow',
      name: 'TASK-042',
    });

    const oauthFile = await service.addNode({
      projectId,
      entityType: 'file',
      entityId: 'src/auth/oauth.ts',
      label: 'oauth.ts',
      path: 'src/auth/oauth.ts',
    });

    const tokenFile = await service.addNode({
      projectId,
      entityType: 'file',
      entityId: 'src/auth/token.ts',
      label: 'token.ts',
      path: 'src/auth/token.ts',
    });

    const testFile = await service.addNode({
      projectId,
      entityType: 'test',
      entityId: 'tests/auth/oauth.test.ts',
      label: 'oauth.test.ts',
      path: 'tests/auth/oauth.test.ts',
    });

    const decision = await service.addNode({
      projectId,
      entityType: 'decision',
      entityId: 'DECISION-012',
      label: 'Use SHA-256 for PKCE',
    });

    const constraint = await service.addNode({
      projectId,
      entityType: 'constraint',
      entityId: 'SECURITY-003',
      label: 'Require Nonce and SHA-256',
    });

    await service.addEdge({
      projectId,
      sourceNodeId: task.id,
      targetNodeId: oauthFile.id,
      relationType: 'modifies',
    });

    await service.addEdge({
      projectId,
      sourceNodeId: task.id,
      targetNodeId: decision.id,
      relationType: 'depends_on',
    });

    await service.addEdge({
      projectId,
      sourceNodeId: oauthFile.id,
      targetNodeId: tokenFile.id,
      relationType: 'imports',
    });

    await service.addEdge({
      projectId,
      sourceNodeId: oauthFile.id,
      targetNodeId: testFile.id,
      relationType: 'tested_by',
    });

    await service.addEdge({
      projectId,
      sourceNodeId: decision.id,
      targetNodeId: constraint.id,
      relationType: 'constrained_by',
    });
  });

  afterEach(() => {
    client.close();
  });

  it('renders help menu when no arguments provided', async () => {
    const output = await cli.run([]);
    expect(output).toContain('Knowledge Graph CLI Commands');
    expect(output).toContain('graph neighbors');
    expect(output).toContain('graph path');
    expect(output).toContain('graph task-context');
    expect(output).toContain('graph file-context');
  });

  it('executes "graph neighbors <nodeIdOrEntity>"', async () => {
    const output = await cli.run(['neighbors', 'TASK-042', `--project-id=${projectId}`]);
    expect(output).toContain('GRAPH NEIGHBORS: TASK-042');
    expect(output).toContain('[modifies] oauth.ts');
    expect(output).toContain('[depends_on] Use SHA-256 for PKCE');
  });

  it('executes "graph path <start> <end>"', async () => {
    const output = await cli.run(['path', 'TASK-042', 'SECURITY-003', `--project-id=${projectId}`]);
    expect(output).toContain('GRAPH PATH: TASK-042 -> SECURITY-003');
    expect(output).toContain('Distance (hops):  2');
    expect(output).toContain('Implement OAuth Flow');
    expect(output).toContain('Use SHA-256 for PKCE');
    expect(output).toContain('Require Nonce and SHA-256');
  });

  it('executes "graph task-context <taskId>"', async () => {
    const output = await cli.run(['task-context', 'TASK-042', `--project-id=${projectId}`]);
    expect(output).toContain('GRAPH CONTEXT FOR TASK: Implement OAuth Flow');
    expect(output).toContain('src/auth/oauth.ts');
    expect(output).toContain('Use SHA-256 for PKCE');
    expect(output).toContain('Require Nonce and SHA-256');
    expect(output).toContain('[Test] tests/auth/oauth.test.ts');
  });

  it('executes "graph file-context <filePath>"', async () => {
    const output = await cli.run(['file-context', 'src/auth/oauth.ts', `--project-id=${projectId}`]);
    expect(output).toContain('GRAPH CONTEXT FOR FILE: src/auth/oauth.ts');
    expect(output).toContain('Implement OAuth Flow');
    expect(output).toContain('[Test] tests/auth/oauth.test.ts');
    expect(output).toContain('-> src/auth/token.ts');
  });

  it('executes "graph verify"', async () => {
    const output = await cli.run(['verify', `--project-id=${projectId}`]);
    expect(output).toContain('GRAPH INTEGRITY VERIFICATION REPORT');
    expect(output).toContain('Status:           VALID (Consistent)');
    expect(output).toContain('Dangling Edges:   0');
  });
});
