import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { HandoffRepository } from '../../src/database/repositories/handoff.repository.js';
import { GraphRepository } from '../../src/database/repositories/graph.repository.js';
import { GraphService } from '../../src/graph/graph-service.js';
import {
  ContextService,
  ContextRanker,
  ContextBudgetManager,
  ContextCompressor,
} from '../../src/context/index.js';

describe('Phase 6: Context Engine (Targeted Zero-LLM Pipeline)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let taskRepo: TaskRepository;
  let decisionRepo: DecisionRepository;
  let handoffRepo: HandoffRepository;
  let graphRepo: GraphRepository;
  let graphService: GraphService;
  let contextService: ContextService;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-context-test-'));
    const canonicalDir = path.join(tempDir, '.ai', 'canonical');
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    fs.mkdirSync(decisionsDir, { recursive: true });

    // Seed canonical files
    fs.writeFileSync(
      path.join(canonicalDir, 'PROJECT.md'),
      `# Project\nname: ContextTestProject\ndescription: A large enterprise project test environment.\n`
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'CONSTRAINTS.md'),
      `# Constraints\n## SECURITY_RULE_1\nMust use bearer tokens for all authenticated endpoints.\n## DB_RULE_2\nNo synchronous disk I/O in event loop.\n`
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'ARCHITECTURE.md'),
      `# Architecture\n## Auth Subsystem\nHandles authentication tokens and sessions.\n## Billing Subsystem\nHandles invoices and payments.\n## Storage Subsystem\nHandles file persistence.\n`
    );

    client = new SQLiteDatabaseClient(':memory:');
    const db = client.db;
    const projectRepo = new ProjectRepository(db);
    const proj = projectRepo.create({
      name: 'Context Test Project',
      rootPath: tempDir,
    });
    projectId = proj.id;

    taskRepo = new TaskRepository(db);
    decisionRepo = new DecisionRepository(db);
    handoffRepo = new HandoffRepository(db);
    graphRepo = new GraphRepository(db);
    graphService = new GraphService(db);
    contextService = new ContextService(db, graphService, tempDir);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('demonstrates: large project with 20+ files produces a small, targeted context for a small task', async () => {
    // 1. Setup a large project: 20 files, 40 symbols across multiple subsystems
    const subsystems = ['auth', 'billing', 'reports', 'notifications', 'storage'];
    for (const sub of subsystems) {
      for (let i = 1; i <= 4; i++) {
        const filePath = `src/${sub}/service_${i}.ts`;
        const fileNode = await graphService.addNode({
          projectId,
          entityType: 'file',
          label: filePath,
          path: filePath,
          metadata: { module: sub },
        });

        // Add 2 symbols per file
        const sym1 = await graphService.addNode({
          projectId,
          entityType: 'symbol',
          label: `${sub}Func_${i}_A`,
          name: `${sub}Func_${i}_A`,
          path: filePath,
          metadata: { kind: 'function', signature: `function ${sub}Func_${i}_A(): void`, module: sub },
        });
        const sym2 = await graphService.addNode({
          projectId,
          entityType: 'symbol',
          label: `${sub}Func_${i}_B`,
          name: `${sub}Func_${i}_B`,
          path: filePath,
          metadata: { kind: 'function', signature: `function ${sub}Func_${i}_B(): void`, module: sub },
        });


        await graphService.addEdge({
          projectId,
          sourceNodeId: fileNode.id,
          targetNodeId: sym1.id,
          relationType: 'contains',
        });
        await graphService.addEdge({
          projectId,
          sourceNodeId: fileNode.id,
          targetNodeId: sym2.id,
          relationType: 'contains',
        });

      }
    }

    // 2. Add multiple decisions
    for (let i = 1; i <= 5; i++) {
      decisionRepo.create({
        projectId,
        title: `ADR-${i}: Storage Strategy ${i}`,
        context: `Context for storage decision ${i}`,
        decisionRationale: `Rationale for storage decision ${i}`,
      });
    }

    // 3. Create a small, targeted task modifying only `src/auth/service_1.ts`
    const targetFilePath = 'src/auth/service_1.ts';
    const task = taskRepo.create({
      projectId,
      title: 'Fix token expiry in auth service',
      description: 'Ensure token expiration timestamp is validated correctly in auth service_1.',
    });

    // Create task node & 'modifies' edge in graph
    const taskNode = await graphService.addNode({
      projectId,
      entityType: 'task',
      label: task.id,
      name: task.title,
    });
    const targetFileNodes = graphRepo.findNodesByPath(projectId, targetFilePath);
    expect(targetFileNodes.length).toBeGreaterThan(0);
    const targetFileNode = targetFileNodes[0]!;

    await graphService.addEdge({
      projectId,
      sourceNodeId: taskNode.id,
      targetNodeId: targetFileNode.id,
      relationType: 'modifies',
    });

    // Add a test file for the auth service
    const testFilePath = 'tests/unit/auth-service-1.test.ts';
    const testFileNode = await graphService.addNode({
      projectId,
      entityType: 'test',
      label: testFilePath,
      path: testFilePath,
    });
    await graphService.addEdge({
      projectId,
      sourceNodeId: testFileNode.id,
      targetNodeId: targetFileNode.id,
      relationType: 'tests',
    });

    // 4. Run Context Engine
    const result = await contextService.getContext(task.id, 8000);

    // 5. Verify targeted context:
    // Only the target auth file should be included in relevant_files, NOT the other 19 files!
    expect(result.pack.relevant_files).toBeDefined();
    expect(result.pack.relevant_files!).toHaveLength(1);
    expect(result.pack.relevant_files![0]?.path).toBe(targetFilePath);

    // Symbols should only be auth symbols from service_1
    const symbolNames = result.pack.relevant_symbols!.map((s) => s.name);
    expect(symbolNames).toContain('authFunc_1_A');
    expect(symbolNames).toContain('authFunc_1_B');
    expect(symbolNames).not.toContain('billingFunc_1_A');
    expect(symbolNames).not.toContain('storageFunc_4_B');

    // Tests should only contain the related test
    const testPaths = result.pack.relevant_tests!.map((t) => t.filePath);
    expect(testPaths).toContain(testFilePath);


    // Token count should be tiny and targeted (< 800 tokens), not bloated by 20 files
    expect(result.token_estimate).toBeLessThan(800);
    expect(result.reasoning_metadata.includedCount).toBeGreaterThan(0);
    expect(result.reasoning_metadata.budgetUtilizationPercent).toBeLessThan(20);
  });

  it('respects configurable token budgets and gracefully excludes lower-priority items when budget is constrained', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Update OAuth token handling',
      description: 'Implement refresh token rotation and revoke active tokens on logout.',
    });

    const taskNode = await graphService.addNode({
      projectId,
      entityType: 'task',
      label: task.id,
      name: task.title,
    });

    // Create 3 modified files
    for (let i = 1; i <= 3; i++) {
      const fPath = `src/auth/oauth_${i}.ts`;
      const fNode = await graphService.addNode({
        projectId,
        entityType: 'file',
        label: fPath,
        path: fPath,
      });
      await graphService.addEdge({
        projectId,
        sourceNodeId: taskNode.id,
        targetNodeId: fNode.id,
        relationType: 'modifies',
      });
    }

    // Add 4 decisions
    for (let i = 1; i <= 4; i++) {
      const dec = decisionRepo.create({
        projectId,
        title: `OAuth Security Decision ${i}`,
        context: `Comprehensive security details for OAuth token policy ${i} with long description.`,
        decisionRationale: `Strict JWT with RS256 algorithm and short TTL of 15 minutes. `.repeat(10),
      });
      const decNode = await graphService.addNode({
        projectId,
        entityType: 'decision',
        entityId: dec.id,
        label: dec.id,
      });

      await graphService.addEdge({
        projectId,
        sourceNodeId: taskNode.id,
        targetNodeId: decNode.id,
        relationType: 'depends_on',
      });
    }

    // Add handoff note
    handoffRepo.create({
      taskId: task.id,
      projectId,
      objective: task.description!,
      completedWork: 'Created token rotation interface',
      blockers: 'Redis key TTL policy needs verification',
      nextAction: 'Implement refresh token endpoint',
      agentIdentity: 'Antigravity',
    });

    // Test with ample budget: 12000 tokens
    const generousResult = await contextService.getContext(task.id, 12000);
    expect(generousResult.reasoning_metadata.tokenBudget).toBe(12000);
    expect(generousResult.excluded_entities.length).toBe(0);
    expect(generousResult.pack.relevant_decisions?.length).toBe(4);

    // Test with tight budget: 600 tokens
    const tightResult = await contextService.getContext(task.id, 600);
    expect(tightResult.reasoning_metadata.tokenBudget).toBe(600);
    expect(tightResult.token_estimate).toBeLessThanOrEqual(600);
    expect(tightResult.excluded_entities.length).toBeGreaterThan(0);

    // Mandatory elements (Task Objective, Current State, Blockers) are strictly preserved!
    expect(tightResult.pack.objective).toContain('refresh token rotation');
    expect(tightResult.pack.current_state?.blockers).toContain('Redis key TTL policy needs verification');
    expect(tightResult.pack.next_action).toBe('Implement refresh token endpoint');

    // Excluded entities have descriptive drop reasons
    for (const exc of tightResult.excluded_entities) {
      expect(exc.dropReason).toContain('Exceeded token budget limit');
    }
  });

  it('adheres to strict ranking hierarchy: direct task relation > modified files > dependencies > decisions > constraints > tests > architecture > general', () => {
    const ranker = new ContextRanker();

    // 1. Files ranking
    const files = ranker.rankFiles([
      { path: 'src/dep/logger.ts', isDependency: true, depth: 2 },
      { path: 'src/core/target.ts', isModified: true },
      { path: 'src/dep/config.ts', isDependency: true, depth: 1 },
    ]);

    expect(files[0]?.path).toBe('src/core/target.ts'); // modified (+800)
    expect(files[0]?.isModified).toBe(true);
    expect(files[1]?.path).toBe('src/dep/config.ts'); // 1-hop dep (+600)
    expect(files[2]?.path).toBe('src/dep/logger.ts'); // 2-hop dep (+300)

    // 2. Budget Packing priority tier check
    const budgetManager = new ContextBudgetManager();
    const candidates = [
      { id: 'gen-1', type: 'general' as const, content: 'General info text', score: 100, priorityTier: 9 },
      { id: 'arch-1', type: 'architecture' as const, content: 'Architecture subsystem', score: 200, priorityTier: 8 },
      { id: 'test-1', type: 'test' as const, content: 'Unit test file', score: 400, priorityTier: 6 },
      { id: 'con-1', type: 'constraint' as const, content: 'Security constraint', score: 450, priorityTier: 2 },
      { id: 'task-1', type: 'task' as const, content: 'Core task', score: 1000, priorityTier: 1, mandatory: true },
      { id: 'file-1', type: 'file' as const, content: 'Target source code', score: 800, priorityTier: 4 },
      { id: 'dec-1', type: 'decision' as const, content: 'ADR decision', score: 500, priorityTier: 3 },
    ];

    // Pack into a budget that fits only top tiers
    const packed = budgetManager.packCandidates(candidates, 500);
    const includedTypes = packed.included.map((i) => i.type);

    expect(includedTypes).toContain('task');
    expect(includedTypes).toContain('constraint');
    expect(includedTypes).toContain('decision');
  });

  it('compresses large code files into outlines when budget pressure is present', () => {
    const compressor = new ContextCompressor();
    const largeFileCode = Array.from({ length: 120 }, (_, i) => {
      if (i === 10) return 'export interface AuthSession { userId: string; token: string; }';
      if (i === 25) return 'export function validateToken(token: string): boolean {';
      if (i === 50) return 'export class TokenManager {';
      return `    doInternalCalculation(${i});`;
    }).join('\n');

    const outline = compressor.compressCodeToOutline('src/auth/session.ts', largeFileCode);
    expect(outline).toContain('// [Outline Compressed]');
    expect(outline).toContain('export interface AuthSession');
    expect(outline).toContain('export class TokenManager');
    expect(outline.length).toBeLessThan(largeFileCode.length);
  });

  it('renders a formatted, prompt-ready markdown context envelope', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Fix SQLite Connection Pool Leak',
      description: 'Close orphaned WAL reader connections when transactions abort.',
    });

    handoffRepo.create({
      taskId: task.id,
      projectId,
      objective: task.description!,
      completedWork: 'Identified unclosed statement handles',
      blockers: 'Locking issue on Windows sandbox',
      nextAction: 'Wrap statement execution in try-finally block',
      agentIdentity: 'Antigravity',
    });

    const result = await contextService.getContext(task.id, 8000);

    expect(result.context).toContain('# TASK CONTEXT: [' + task.id + ']');
    expect(result.context).toContain('## 1. Task Objective & Current State');
    expect(result.context).toContain('Fix SQLite Connection Pool Leak');
    expect(result.context).toContain('Locking issue on Windows sandbox');
    expect(result.context).toContain('Wrap statement execution in try-finally block');
    expect(result.context).toContain('## 2. Technical Constraints');
    expect(result.context).toContain('SECURITY_RULE_1');
    expect(result.context).toContain('## 7. Continuity & Recent Handoff');
  });

  it('benchmarks context generation latency (< 50ms)', async () => {
    // Setup realistic task with files, symbols, constraints, decisions
    const task = taskRepo.create({
      projectId,
      title: 'Performance Benchmark Task',
      description: 'Ensure context engine generates pack rapidly without lag.',
    });

    const taskNode = await graphService.addNode({
      projectId,
      entityType: 'task',
      label: task.id,
      name: task.title,
    });

    for (let i = 1; i <= 5; i++) {
      const fNode = await graphService.addNode({
        projectId,
        entityType: 'file',
        label: `src/mod_${i}.ts`,
        path: `src/mod_${i}.ts`,
      });
      await graphService.addEdge({
        projectId,
        sourceNodeId: taskNode.id,
        targetNodeId: fNode.id,
        relationType: 'modifies',
      });
    }

    const start = performance.now();
    const result = await contextService.getContext(task.id, 8000);
    const duration = performance.now() - start;

    console.log(`\n================ CONTEXT ENGINE BENCHMARK ================`);
    console.log(`Duration:           ${duration.toFixed(2)}ms`);
    console.log(`Token Estimate:     ${result.token_estimate} tokens`);
    console.log(`Included Entities:  ${result.included_entities.length}`);
    console.log(`Budget Utilization: ${result.reasoning_metadata.budgetUtilizationPercent}%`);
    console.log(`==========================================================\n`);

    expect(duration).toBeLessThan(50);
    expect(result.token_estimate).toBeGreaterThan(0);
  });
});
