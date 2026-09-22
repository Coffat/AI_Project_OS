import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  GitChangedFiles,
  MemoryCompilationResult,
  MemoryLayer,
  SemanticExtractionRequest,
  SymbolEntity,
  GraphEdge,
  DecisionRecord,
  ConstraintRecord,
} from '../core/types.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { CodeIndexer } from '../code-intelligence/code-indexer.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { ConstraintRepository } from '../database/repositories/constraint.repository.js';
import { MemoryDiff } from './memory-diff.js';
import { MemoryEventProcessor } from './memory-event-processor.js';
import { MemoryUpdater } from './memory-updater.js';
import { MemoryValidator } from './memory-validator.js';

export class MemoryCompiler {
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly codeIndexer: CodeIndexer;
  private readonly graphRepo: GraphRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly memoryDiff: MemoryDiff;
  private readonly eventProcessor: MemoryEventProcessor;
  private readonly memoryUpdater: MemoryUpdater;
  private readonly memoryValidator: MemoryValidator;

  constructor(private readonly db: DatabaseSync) {
    this.gitAnalyzer = new GitAnalyzer();
    this.codeIndexer = new CodeIndexer(db);
    this.graphRepo = new GraphRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.constraintRepo = new ConstraintRepository(db);
    this.memoryDiff = new MemoryDiff();
    this.eventProcessor = new MemoryEventProcessor(db);
    this.memoryUpdater = new MemoryUpdater(db);
    this.memoryValidator = new MemoryValidator(db);
  }

  /**
   * Compiles memory incrementally following the deterministic zero-LLM pipeline:
   * git diff → code intelligence → graph update → deterministic memory update → optional semantic extraction → canonical memory.
   */
  public async compileChanges(
    projectRoot: string,
    projectId: string,
    options: { baseRef?: string; targetRef?: string; forcedChanges?: GitChangedFiles } = {}
  ): Promise<MemoryCompilationResult> {
    const startTime = performance.now();

    // 1. Snapshot previous state before indexing changes
    const previousSymbols = this.snapshotCurrentSymbols(projectId);
    const previousEdges = this.snapshotCurrentEdges(projectId);
    const previousDecisions = this.snapshotPreviousDecisions(projectId);
    const previousConstraints = this.snapshotPreviousConstraints(projectId);

    // 2. Discover git / filesystem changes
    let changedFiles: GitChangedFiles;
    if (options.forcedChanges) {
      changedFiles = options.forcedChanges;
    } else if (options.baseRef) {
      changedFiles = await this.gitAnalyzer.getDiffChanges(
        projectRoot,
        options.baseRef,
        options.targetRef ?? 'HEAD'
      );
    } else {
      changedFiles = await this.gitAnalyzer.getWorkingTreeChanges(projectRoot);
    }

    // 3. Update code intelligence and knowledge graph incrementally
    if (
      changedFiles.added.length > 0 ||
      changedFiles.modified.length > 0 ||
      changedFiles.deleted.length > 0 ||
      changedFiles.renamed.length > 0
    ) {
      await this.codeIndexer.indexChanged(projectRoot, projectId, {
        baseRef: options.baseRef,
        targetRef: options.targetRef,
      });
    }

    // 4. Snapshot current state after indexing
    const currentSymbols = this.snapshotCurrentSymbols(projectId);
    const currentEdges = this.snapshotCurrentEdges(projectId);
    const currentDecisions = this.decisionRepo.listByProject(projectId);
    const currentConstraints = this.constraintRepo.listByProject(projectId);

    // 5. Calculate memory diff & fine-grained events
    const diffResult = this.memoryDiff.computeDiff({
      projectId,
      changedFiles,
      previousSymbols,
      currentSymbols,
      previousEdges,
      currentEdges,
      decisions: { previous: previousDecisions, current: currentDecisions },
      constraints: { previous: previousConstraints, current: currentConstraints },
    });

    // 6. Process and record memory events
    await this.eventProcessor.processEvents(projectId, diffResult.events);

    // 7. Deterministically update affected memory layers and canonical markdown files
    const updateResult = await this.memoryUpdater.updateMemory({
      projectRoot,
      projectId,
      diffResult,
    });

    // 8. Handle optional semantic extraction requests (zero-LLM deterministic queue)
    let semanticRequestsCreated = 0;
    if (diffResult.semanticExtractionRequired) {
      for (const reason of diffResult.semanticReasons) {
        await this.createSemanticExtractionRequest({
          projectId,
          reason,
          diffSummary: `Affected files: ${diffResult.affectedFiles.join(', ')}`,
          suggestedTargetLayer: 'architecture',
        });
        semanticRequestsCreated++;
      }
    }

    // 9. Validate memory consistency
    const validation = await this.memoryValidator.validate(projectRoot, projectId);

    const durationMs = Math.round(performance.now() - startTime);

    return {
      projectId,
      durationMs,
      changedFiles,
      eventsGenerated: diffResult.events.length,
      layersUpdated: updateResult.updatedLayers,
      canonicalFilesUpdated: updateResult.updatedCanonicalFiles,
      semanticRequestsCreated,
      validation,
    };
  }

  /**
   * Compiles memory following completion of a specific task.
   */
  public async compileTaskCompletion(
    taskId: string,
    projectRoot: string,
    projectId: string
  ): Promise<MemoryCompilationResult> {
    const taskStmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const taskRow = taskStmt.get(taskId) as Record<string, unknown> | undefined;

    const taskObj = taskRow
      ? {
          id: String(taskRow['id']),
          projectId: String(taskRow['project_id']),
          title: String(taskRow['title']),
          goal: taskRow['goal'] ? String(taskRow['goal']) : undefined,
          status: 'completed' as const,
          priority: 'medium' as const,
          version: 1,
          createdAt: Number(taskRow['created_at']),
          updatedAt: Number(taskRow['updated_at']),
        }
      : undefined;

    // Run compileChanges with task completion event injection
    const result = await this.compileChanges(projectRoot, projectId);

    if (taskObj) {
      const taskEvent = {
        eventId: randomUUID(),
        type: 'TASK_COMPLETED' as const,
        timestamp: Date.now(),
        source: 'task_engine',
        entity: `task:${taskObj.id}`,
        before: { status: 'in_progress' },
        after: { status: 'completed', title: taskObj.title, goal: taskObj.goal },
      };

      await this.eventProcessor.processEvents(projectId, [taskEvent]);
      result.eventsGenerated += 1;
      if (!result.layersUpdated.includes('task')) {
        result.layersUpdated.push('task');
      }
    }

    return result;
  }

  /**
   * Full project memory compilation and canonical synchronization.
   */
  public async compileFull(projectRoot: string, projectId: string): Promise<MemoryCompilationResult> {
    const startTime = performance.now();

    // 1. Re-index entire project
    await this.codeIndexer.indexProject(projectRoot, projectId);

    // 2. Diff against all existing files
    const allFiles = this.graphRepo.listFiles(projectId).map((f) => f.path);
    const forcedChanges: GitChangedFiles = {
      added: allFiles,
      modified: [],
      deleted: [],
      renamed: [],
    };

    const currentSymbols = this.snapshotCurrentSymbols(projectId);
    const currentEdges = this.snapshotCurrentEdges(projectId);
    const currentDecisions = this.decisionRepo.listByProject(projectId);
    const currentConstraints = this.constraintRepo.listByProject(projectId);

    const diffResult = this.memoryDiff.computeDiff({
      projectId,
      changedFiles: forcedChanges,
      currentSymbols,
      currentEdges,
      decisions: { current: currentDecisions },
      constraints: { current: currentConstraints },
    });

    // For full compilation, ensure all primary layers are refreshed
    for (const layer of ['project', 'architecture', 'constraint', 'decision'] as MemoryLayer[]) {
      if (!diffResult.affectedLayers.includes(layer)) {
        diffResult.affectedLayers.push(layer);
      }
    }

    await this.eventProcessor.processEvents(projectId, diffResult.events);

    const updateResult = await this.memoryUpdater.updateMemory({
      projectRoot,
      projectId,
      diffResult,
    });

    const validation = await this.memoryValidator.validate(projectRoot, projectId);
    const durationMs = Math.round(performance.now() - startTime);

    return {
      projectId,
      durationMs,
      changedFiles: forcedChanges,
      eventsGenerated: diffResult.events.length,
      layersUpdated: updateResult.updatedLayers,
      canonicalFilesUpdated: updateResult.updatedCanonicalFiles,
      semanticRequestsCreated: 0,
      validation,
    };
  }

  public getSemanticRequests(projectId: string): SemanticExtractionRequest[] {
    const stmt = this.db.prepare(`
      SELECT * FROM semantic_extraction_requests
      WHERE project_id = ?
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      reason: String(r['reason']),
      diffSummary: String(r['diff_summary']),
      suggestedTargetLayer: r['suggested_target_layer'] as SemanticExtractionRequest['suggestedTargetLayer'],
      entityIdentifier: r['entity_identifier'] ? String(r['entity_identifier']) : undefined,
      status: r['status'] as SemanticExtractionRequest['status'],
      createdAt: Number(r['created_at']),
    }));
  }

  private async createSemanticExtractionRequest(params: {
    projectId: string;
    reason: string;
    diffSummary: string;
    suggestedTargetLayer: SemanticExtractionRequest['suggestedTargetLayer'];
    entityIdentifier?: string;
  }): Promise<void> {
    const id = randomUUID();
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO semantic_extraction_requests (
        id, project_id, reason, diff_summary, suggested_target_layer, entity_identifier, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `);

    stmt.run(
      id,
      params.projectId,
      params.reason,
      params.diffSummary,
      params.suggestedTargetLayer,
      params.entityIdentifier ?? null,
      now
    );
  }

  private snapshotCurrentSymbols(projectId: string): Map<string, SymbolEntity[]> {
    const map = new Map<string, SymbolEntity[]>();
    const files = this.graphRepo.listFiles(projectId);

    for (const f of files) {
      const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_id = ?');
      const rows = stmt.all(f.id) as Record<string, unknown>[];
      const syms: SymbolEntity[] = rows.map((r) => ({
        id: String(r['id']),
        fileId: String(r['file_id']),
        projectId: String(r['project_id']),
        name: String(r['name']),
        kind: r['kind'] as SymbolEntity['kind'],
        lineStart: Number(r['line_start']),
        lineEnd: Number(r['line_end']),
        signature: r['signature'] ? String(r['signature']) : undefined,
        docstring: r['docstring'] ? String(r['docstring']) : undefined,
        createdAt: Number(r['created_at']),
      }));
      map.set(f.path, syms);
    }
    return map;
  }

  private snapshotCurrentEdges(projectId: string): Map<string, GraphEdge[]> {
    const map = new Map<string, GraphEdge[]>();
    const edges = this.graphRepo.getAllEdges(projectId);
    for (const e of edges) {
      const existing = map.get(e.sourceNodeId) ?? [];
      existing.push(e);
      map.set(e.sourceNodeId, existing);
    }
    return map;
  }

  private snapshotPreviousDecisions(projectId: string): DecisionRecord[] {
    const memRows = this.db.prepare(
      "SELECT key FROM project_memory WHERE project_id = ? AND category = 'DECISION'"
    ).all(projectId) as Array<{ key: string }>;
    const recordedKeys = new Set(memRows.map((r) => r.key));

    const allDecisions = this.decisionRepo.listByProject(projectId);
    return allDecisions.filter((d) => recordedKeys.has(`decision:${d.id}`));
  }

  private snapshotPreviousConstraints(projectId: string): ConstraintRecord[] {
    const memRows = this.db.prepare(
      "SELECT key, content FROM project_memory WHERE project_id = ? AND category = 'CONSTRAINT'"
    ).all(projectId) as Array<{ key: string; content: string }>;

    const allConstraints = this.constraintRepo.listByProject(projectId);
    if (memRows.length === 0) {
      return [];
    }
    const combinedContent = memRows.map((r) => r.content).join('\n');
    return allConstraints.filter((c) => combinedContent.includes(c.title));
  }
}
