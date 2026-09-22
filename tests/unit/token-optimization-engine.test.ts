import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { GraphService } from '../../src/graph/graph-service.js';
import {
  ContextService,
  ContextEstimator,
  ContextDeduplicator,
  ContextPrioritizer,
  TokenBudgetManager,
} from '../../src/context/index.js';
import { Task } from '../../src/core/types.js';

describe('Phase 17: Token Optimization Engine (Deterministic & Hierarchical)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let taskRepo: TaskRepository;
  let decisionRepo: DecisionRepository;
  let graphService: GraphService;
  let contextService: ContextService;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-p17-test-'));
    const canonicalDir = path.join(tempDir, '.ai', 'canonical');
    fs.mkdirSync(path.join(canonicalDir, 'DECISIONS'), { recursive: true });

    fs.writeFileSync(
      path.join(canonicalDir, 'PROJECT.md'),
      `# Project\nname: OptimizationTestProject\ndescription: Scalable enterprise platform.\n`
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'CONSTRAINTS.md'),
      `# Constraints\n## SEC-01\nEnforce RS256 token verification on all incoming gateway requests.\n`
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'ARCHITECTURE.md'),
      `# Architecture\n## Auth Subsystem\nEnforce RS256 token verification with 15-minute TTL and Redis blacklist cache.\n## Storage Subsystem\nUses S3-compatible object storage with multi-part upload.\n`
    );

    client = new SQLiteDatabaseClient(':memory:');
    const db = client.db;
    const projectRepo = new ProjectRepository(db);
    const proj = projectRepo.create({
      name: 'P17 Project',
      rootPath: tempDir,
    });
    projectId = proj.id;

    taskRepo = new TaskRepository(db);
    decisionRepo = new DecisionRepository(db);
    graphService = new GraphService(db);
    contextService = new ContextService(db, graphService, tempDir);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('ContextEstimator', () => {
    const estimator = new ContextEstimator();

    it('estimates tokens accurately and deterministically using character & structure heuristics', () => {
      expect(estimator.estimateTokens('')).toBe(0);
      expect(estimator.estimateTokens(null)).toBe(0);

      const codeSample = 'export function calculateTotal(items: number[]): number { return items.reduce((a, b) => a + b, 0); }';
      const tokens = estimator.estimateTokens(codeSample);
      expect(tokens).toBeGreaterThan(15);
      expect(tokens).toBeLessThan(40);
    });

    it('calculates compression metrics and percentage correctly', () => {
      const metrics = estimator.calculateCompressionMetrics(500000, 9000);
      expect(metrics.totalProjectTokens).toBe(500000);
      expect(metrics.selectedContextTokens).toBe(9000);
      expect(metrics.compressionRatio).toBe(0.982);
      expect(metrics.compressionPercentage).toBe('98.2%');
      expect(metrics.compressionFactor).toBe('55.6x');
    });

    it('estimates total project tokens by scanning source and markdown files', async () => {
      // Create some files in tempDir
      fs.writeFileSync(path.join(tempDir, 'index.ts'), 'export const version = "1.0.0";\n'.repeat(50));
      fs.writeFileSync(path.join(tempDir, 'utils.ts'), 'export function helper() { return true; }\n'.repeat(50));

      const totalTokens = await estimator.estimateProjectTokens(tempDir);
      expect(totalTokens).toBeGreaterThan(100);
    });
  });

  describe('ContextDeduplicator', () => {
    const deduplicator = new ContextDeduplicator();

    it('deduplicates when architecture document and decision document share the same information', () => {
      const candidates = [
        {
          id: 'decision:ADR-01',
          type: 'decision',
          level: 'L2' as const,
          content: '### Decision [ADR-01] RS256 Token Verification\nEnforce RS256 token verification with 15-minute TTL and Redis blacklist cache.',
          score: 650,
          priorityTier: 3,
        },
        {
          id: 'arch:auth',
          type: 'architecture',
          level: 'L3' as const,
          content: '### Architecture Subsystem: auth\nEnforce RS256 token verification with 15-minute TTL and Redis blacklist cache.',
          score: 250,
          priorityTier: 8,
        },
        {
          id: 'arch:storage',
          type: 'architecture',
          level: 'L3' as const,
          content: '### Architecture Subsystem: storage\nUses S3-compatible object storage with multi-part upload.',
          score: 200,
          priorityTier: 8,
        },
      ];

      const result = deduplicator.deduplicate(candidates);

      // Decision ADR-01 must be kept
      expect(result.kept.some((k) => k.id === 'decision:ADR-01')).toBe(true);
      // Storage architecture must be kept (not redundant)
      expect(result.kept.some((k) => k.id === 'arch:storage')).toBe(true);
      // Auth architecture must be deduplicated
      expect(result.kept.some((k) => k.id === 'arch:auth')).toBe(false);

      // Verify deduction records
      expect(result.deduplicated.length).toBe(1);
      expect(result.deduplicated[0]?.id).toBe('arch:auth');
      expect(result.deduplicated[0]?.coveredBy).toBe('decision:ADR-01');
      expect(result.deduplicated[0]?.reason).toContain('information already covered by decision [decision:ADR-01]');
      expect(result.tokensSaved).toBeGreaterThan(0);
    });

    it('removes exact duplicate contents across any candidate items', () => {
      const candidates = [
        {
          id: 'rule-1',
          type: 'constraint',
          level: 'L3' as const,
          content: 'Strict timeout of 30 seconds on external RPC calls.',
          score: 400,
          priorityTier: 6,
        },
        {
          id: 'rule-2',
          type: 'constraint',
          level: 'L3' as const,
          content: 'Strict timeout of 30 seconds on external RPC calls.',
          score: 350,
          priorityTier: 6,
        },
      ];

      const result = deduplicator.deduplicate(candidates);
      expect(result.kept.length).toBe(1);
      expect(result.deduplicated.length).toBe(1);
      expect(result.deduplicated[0]?.reason).toContain('exact duplicate content already provided by rule-1');
    });
  });

  describe('ContextPrioritizer & Deterministic Retrieval', () => {
    const prioritizer = new ContextPrioritizer();

    it('classifies candidates into canonical context levels L0 through L4', () => {
      expect(prioritizer.resolveLevel('task')).toBe('L0');
      expect(prioritizer.resolveLevel('objective')).toBe('L0');
      expect(prioritizer.resolveLevel('current_state')).toBe('L1');
      expect(prioritizer.resolveLevel('handoff')).toBe('L1');
      expect(prioritizer.resolveLevel('file')).toBe('L2');
      expect(prioritizer.resolveLevel('symbol')).toBe('L2');
      expect(prioritizer.resolveLevel('decision')).toBe('L2');
      expect(prioritizer.resolveLevel('architecture')).toBe('L3');
      expect(prioritizer.resolveLevel('constraint')).toBe('L3');
      expect(prioritizer.resolveLevel('test')).toBe('L3');
      expect(prioritizer.resolveLevel('general')).toBe('L4');
    });

    it('scores candidates deterministically using graph locality (0-hop > 1-hop > 2-hop)', async () => {
      const candidates = [
        {
          id: 'file:2hop.ts',
          type: 'file',
          content: '// 2-hop dependency',
          graphHopDistance: 2,
        },
        {
          id: 'file:target.ts',
          type: 'file',
          content: '// 0-hop modified file',
          isModified: true,
          graphHopDistance: 0,
        },
        {
          id: 'file:1hop.ts',
          type: 'file',
          content: '// 1-hop dependency',
          isDependency: true,
          graphHopDistance: 1,
        },
      ];

      const prioritized = await prioritizer.prioritize(candidates);

      // In L2, 0-hop modified file must be scored highest, followed by 1-hop, then 2-hop
      expect(prioritized[0]?.id).toBe('file:target.ts');
      expect(prioritized[1]?.id).toBe('file:1hop.ts');
      expect(prioritized[2]?.id).toBe('file:2hop.ts');

      expect(prioritized[0]?.scoreBreakdown.graphLocalityScore).toBe(800);
      expect(prioritized[1]?.scoreBreakdown.graphLocalityScore).toBe(500);
      expect(prioritized[2]?.scoreBreakdown.graphLocalityScore).toBe(250);
    });

    it('supports optional semantic ranking fallback when explicitly enabled', async () => {
      const candidates = [
        { id: 'item-a', type: 'file', content: 'A' },
        { id: 'item-b', type: 'file', content: 'B' },
      ];

      const mockFallback = async (items: any[]) => {
        // Reverse order
        return [...items].reverse();
      };

      const task: Task = {
        id: 't-1',
        projectId: 'p-1',
        title: 'Task Title',
        status: 'planned',
        priority: 'medium',
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const prioritized = await prioritizer.prioritize(candidates, task, {
        enableSemanticFallback: true,
        semanticRankingFallback: mockFallback,
      });

      expect(prioritized[0]?.id).toBe('item-b');
      expect(prioritized[1]?.id).toBe('item-a');
    });
  });

  describe('TokenBudgetManager (Hierarchical Level Packing)', () => {
    const budgetManager = new TokenBudgetManager();

    it('guarantees L0 and L1 are never excluded and omits L3/L4 when budget runs out at L2', () => {
      const candidates = [
        {
          id: 'task:1',
          type: 'task',
          level: 'L0' as const,
          content: 'Task Objective: Implement Stripe webhook verification.',
          score: 1000,
          priorityTier: 1,
          mandatory: true,
        },
        {
          id: 'state:1',
          type: 'current_state',
          level: 'L1' as const,
          content: 'Current Step: Parse signatures. Blockers: None. Next Action: Verify HMAC.',
          score: 950,
          priorityTier: 2,
          mandatory: true,
        },
        {
          id: 'file:stripe.ts',
          type: 'file',
          level: 'L2' as const,
          content: 'export function verifyStripeWebhook() { /* core stripe handler */ } '.repeat(10),
          score: 800,
          priorityTier: 3,
        },
        {
          id: 'file:heavy_dep.ts',
          type: 'file',
          level: 'L2' as const,
          content: 'export function heavyDependency() { /* 400 token payload */ } '.repeat(35),
          score: 750,
          priorityTier: 4,
        },
        {
          id: 'arch:billing',
          type: 'architecture',
          level: 'L3' as const,
          content: 'Billing subsystem architecture rules and guidelines for Stripe.',
          score: 300,
          priorityTier: 8,
        },
        {
          id: 'general:overview',
          type: 'general',
          level: 'L4' as const,
          content: 'Broader project history, company vision, and customer personas.',
          score: 100,
          priorityTier: 9,
        },
      ];

      // Tight budget of 500 tokens: fits L0, L1, and stripe.ts in L2, but heavy_dep.ts exceeds budget
      const result = budgetManager.packCandidates(candidates, 500);

      // Mandatory L0 and L1 must be included
      expect(result.included.some((i) => i.level === 'L0')).toBe(true);
      expect(result.included.some((i) => i.level === 'L1')).toBe(true);

      // L2 file is included
      expect(result.included.some((i) => i.id === 'file:stripe.ts')).toBe(true);
      expect(result.included.some((i) => i.id === 'file:heavy_dep.ts')).toBe(false);

      // Loaded levels should report L0, L1, L2
      expect(result.loadedLevels).toContain('L0');
      expect(result.loadedLevels).toContain('L1');
      expect(result.loadedLevels).toContain('L2');
      expect(result.loadedLevels).not.toContain('L3');
      expect(result.loadedLevels).not.toContain('L4');

      // Excluded items have explicit level omission reasons
      const archExcluded = result.excludedContext.find((e) => e.id === 'arch:billing');
      expect(archExcluded).toBeDefined();
      expect(archExcluded?.reason).toContain('Exceeded token budget limit');
    });
  });

  describe('End-to-End Context Engine Reporting', () => {
    it('reports total project tokens, selected tokens, compression ratio, loaded levels, and excluded context with reasons', async () => {
      // Create duplicate ADR decision matching ARCHITECTURE.md auth rule
      decisionRepo.create({
        projectId,
        title: 'ADR-Auth: RS256 Token Verification',
        context: 'Enforce RS256 token verification with 15-minute TTL and Redis blacklist cache.',
        decisionRationale: 'Enforce RS256 token verification with 15-minute TTL and Redis blacklist cache.',
      });

      const targetPath = 'src/auth/service.ts';
      const fileNode = await graphService.addNode({
        projectId,
        entityType: 'file',
        label: targetPath,
        path: targetPath,
      });

      const task = taskRepo.create({
        projectId,
        title: 'RS256 JWT Expiry Validation',
        description: 'Verify RS256 signature and TTL expiration in auth service.',
      });

      const taskNode = await graphService.addNode({
        projectId,
        entityType: 'task',
        label: task.id,
        name: task.title,
      });

      await graphService.addEdge({
        projectId,
        sourceNodeId: taskNode.id,
        targetNodeId: fileNode.id,
        relationType: 'modifies',
      });

      const result = await contextService.getContext(task.id, 8000);

      // Verify all required Phase 17 report fields
      expect(result.total_project_tokens).toBeDefined();
      expect(result.total_project_tokens).toBeGreaterThan(0);

      expect(result.selected_context_tokens).toBeDefined();
      expect(result.selected_context_tokens).toBe(result.token_estimate);
      expect(result.selected_context_tokens!).toBeLessThan(8000);

      expect(result.compression_ratio).toBeDefined();
      expect(result.compression_ratio!).toBeGreaterThan(0);
      expect(result.compression_ratio!).toBeLessThanOrEqual(1.0);

      expect(result.loaded_levels).toBeDefined();
      expect(result.loaded_levels).toContain('L0');

      expect(result.excluded_context).toBeDefined();

      // Check deduplication between decision and architecture
      const deduplicatedArch = result.excluded_context?.find((e) =>
        e.reason.includes('Deduplicated: information already covered by decision')
      );
      expect(deduplicatedArch).toBeDefined();

      // Verify Markdown prompt includes Phase 17 Token Optimization banner
      expect(result.context).toContain('Token Optimization Engine (Phase 17)');
      expect(result.context).toContain('**Project Total**:');
      expect(result.context).toContain('**Selected Context**:');
      expect(result.context).toContain('**Compression**:');
    });
  });
});
