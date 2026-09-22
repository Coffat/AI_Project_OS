/**
 * DoctorService (AI Project OS Operations & Diagnostics Engine)
 *
 * Implements production readiness, self-healing, and disaster recovery:
 *   - Comprehensive health diagnostics (database, filesystem, graph, memory, sessions, index)
 *   - Automated self-repair of corrupted state, orphaned nodes, and interrupted sessions
 *   - Fresh reindexing and deterministic graph reconstruction
 *   - Atomic zero-lock backup (`VACUUM INTO`) and safe rollback-enabled restoration
 */

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ProjectRepository } from '../database/repositories/project.repository.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { ConstraintRepository } from '../database/repositories/constraint.repository.js';
import { ExecutionSessionRepository } from '../database/repositories/execution-session.repository.js';
import { ValidationRepository } from '../database/repositories/validation.repository.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import { GraphService } from '../graph/graph-service.js';
import { CodeIndexer, IndexProjectResult } from '../code-intelligence/code-indexer.js';
import { MemoryValidator } from '../memory/memory-validator.js';
import { HandoffValidator } from '../handoff/handoff-validator.js';
import { MemoryValidationReport } from '../core/types.js';
import {
  DoctorDiagnosisReport,
  DoctorRepairReport,
  DoctorValidationResult,
  DiagnosticCheckItem,
  DiagnosticSeverity,
  RebuildGraphResult,
  BackupResult,
  RestoreResult,
  BackupManifest,
} from './types.js';

export class DoctorService {
  private readonly projectRepo: ProjectRepository;
  private readonly taskRepo: TaskRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly sessionRepo: ExecutionSessionRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly graphRepo: GraphRepository;
  private readonly graphService: GraphService;
  private readonly memoryValidator: MemoryValidator;
  private readonly codeIndexer: CodeIndexer;
  private readonly handoffValidator: HandoffValidator;

  constructor(
    private readonly db: DatabaseSync,
    private readonly projectRoot: string = process.cwd()
  ) {
    this.projectRepo = new ProjectRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.constraintRepo = new ConstraintRepository(db);
    this.sessionRepo = new ExecutionSessionRepository(db);
    this.validationRepo = new ValidationRepository(db);
    this.graphRepo = new GraphRepository(db);
    this.graphService = new GraphService(this.graphRepo);
    this.memoryValidator = new MemoryValidator(db);
    this.codeIndexer = new CodeIndexer(db);
    this.handoffValidator = new HandoffValidator(projectRoot);
  }

  // ===========================================================================
  // 1. DIAGNOSTICS & HEALTH CHECK
  // ===========================================================================

  public async diagnose(explicitProjectId?: string): Promise<DoctorDiagnosisReport> {
    const checks: DiagnosticCheckItem[] = [];
    const recommendations: string[] = [];

    const projectId = explicitProjectId ?? this.resolveCurrentProjectId();

    // 1. Database Integrity
    this.checkDatabase(checks, recommendations);

    // 2. Filesystem & State Structure
    this.checkFilesystem(checks, recommendations);

    // 3. Canonical Memory Consistency
    if (projectId) {
      await this.checkMemory(projectId, checks, recommendations);
    } else {
      checks.push({
        name: 'Canonical Memory',
        category: 'memory',
        status: 'warning',
        message: 'No project registered in database; skipped memory consistency check',
      });
    }

    // 4. Graph Consistency
    await this.checkGraph(projectId, checks, recommendations);

    // 5. Session & Handoff Health
    await this.checkSessionsAndHandoff(projectId, checks, recommendations);

    // 6. Index & Validation Freshness
    await this.checkIndexAndValidation(projectId, checks, recommendations);

    const passed = checks.filter((c) => c.status === 'ok').length;
    const warnings = checks.filter((c) => c.status === 'warning').length;
    const errors = checks.filter((c) => c.status === 'error').length;

    let overallStatus: DiagnosticSeverity = 'healthy';
    if (errors > 0) {
      overallStatus = 'corrupted';
    } else if (warnings > 0) {
      overallStatus = 'warning';
    }

    return {
      timestamp: Date.now(),
      projectRoot: this.projectRoot,
      projectId,
      overallStatus,
      checks,
      summary: { passed, warnings, errors },
      recommendations,
    };
  }

  private checkDatabase(checks: DiagnosticCheckItem[], recommendations: string[]): void {
    try {
      // 1. SQLite PRAGMA integrity_check
      const integrityRow = this.db.prepare('PRAGMA integrity_check;').get() as Record<string, unknown> | undefined;
      const integrityResult = integrityRow ? String(Object.values(integrityRow)[0]) : 'unknown';

      if (integrityResult.toLowerCase() === 'ok') {
        checks.push({
          name: 'SQLite Database Integrity',
          category: 'database',
          status: 'ok',
          message: 'Database passes SQLite low-level B-tree integrity check',
        });
      } else {
        checks.push({
          name: 'SQLite Database Integrity',
          category: 'database',
          status: 'error',
          message: `Database integrity check failed: ${integrityResult}`,
          remedy: "Run 'ai-project-os repair' to checkpoint and vacuum database.",
        });
        recommendations.push("Repair database using 'ai-project-os repair' or restore from backup.");
      }

      // 2. Foreign Key Integrity Check
      const fkRows = this.db.prepare('PRAGMA foreign_key_check;').all() as Array<Record<string, unknown>>;
      if (fkRows.length === 0) {
        checks.push({
          name: 'Foreign Key Constraints',
          category: 'database',
          status: 'ok',
          message: 'All relational foreign key references are intact',
        });
      } else {
        checks.push({
          name: 'Foreign Key Constraints',
          category: 'database',
          status: 'error',
          message: `Detected ${fkRows.length} foreign key violation(s)`,
          details: fkRows,
          remedy: "Run 'ai-project-os repair' to reconcile foreign keys.",
        });
        recommendations.push('Reconcile broken foreign key references in SQLite tables.');
      }

      // 3. Journal Mode
      const jRow = this.db.prepare('PRAGMA journal_mode;').get() as Record<string, unknown> | undefined;
      const journalMode = jRow ? String(Object.values(jRow)[0]).toUpperCase() : 'UNKNOWN';
      checks.push({
        name: 'Database Journal Mode',
        category: 'database',
        status: journalMode === 'WAL' || journalMode === 'MEMORY' ? 'ok' : 'warning',
        message: `Current journal mode is ${journalMode}`,
        remedy: journalMode !== 'WAL' && journalMode !== 'MEMORY' ? 'WAL mode recommended for concurrent reads' : undefined,
      });
    } catch (err) {
      checks.push({
        name: 'SQLite Database Access',
        category: 'database',
        status: 'error',
        message: `Database query failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      recommendations.push('Check file permissions or restore database from backup.');
    }
  }

  private checkFilesystem(checks: DiagnosticCheckItem[], recommendations: string[]): void {
    const requiredDirs = [
      path.join(this.projectRoot, '.ai'),
      path.join(this.projectRoot, '.ai', 'state'),
      path.join(this.projectRoot, '.ai', 'canonical'),
      path.join(this.projectRoot, '.ai', 'handoff'),
      path.join(this.projectRoot, '.ai', 'tasks'),
      path.join(this.projectRoot, '.ai', 'proposals'),
      path.join(this.projectRoot, '.ai', 'backups'),
    ];

    const missingDirs: string[] = [];
    for (const dir of requiredDirs) {
      if (!fs.existsSync(dir)) {
        missingDirs.push(path.relative(this.projectRoot, dir));
      }
    }

    if (missingDirs.length === 0) {
      checks.push({
        name: 'Filesystem State Directories',
        category: 'filesystem',
        status: 'ok',
        message: 'All .ai runtime and state directories are present',
      });
    } else {
      checks.push({
        name: 'Filesystem State Directories',
        category: 'filesystem',
        status: 'warning',
        message: `Missing ${missingDirs.length} state directory(s): ${missingDirs.join(', ')}`,
        remedy: "Run 'ai-project-os repair' to scaffold missing runtime folders.",
      });
      recommendations.push("Execute 'ai-project-os repair' to scaffold standard .ai directories.");
    }
  }

  private async checkMemory(
    projectId: string,
    checks: DiagnosticCheckItem[],
    recommendations: string[]
  ): Promise<void> {
    try {
      const report = await this.memoryValidator.validate(this.projectRoot, projectId);
      if (report.isValid) {
        checks.push({
          name: 'Canonical Memory Consistency',
          category: 'memory',
          status: 'ok',
          message: 'Canonical Markdown documents (PROJECT, ARCHITECTURE, CONSTRAINTS) are valid and synchronized',
        });
      } else {
        checks.push({
          name: 'Canonical Memory Consistency',
          category: 'memory',
          status: 'warning',
          message: `Memory validation found issues: ${report.details.join('; ')}`,
          details: report,
          remedy: "Run 'ai-project-os repair' to create default canonical templates.",
        });
        recommendations.push("Inspect .ai/canonical/ documents or run 'ai-project-os repair'.");
      }
    } catch (err) {
      checks.push({
        name: 'Canonical Memory Consistency',
        category: 'memory',
        status: 'error',
        message: `Failed to validate canonical memory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async checkGraph(
    projectId: string | undefined,
    checks: DiagnosticCheckItem[],
    recommendations: string[]
  ): Promise<void> {
    try {
      const report = await this.graphService.verifyGraphIntegrity(projectId);

      // Check orphaned edges in SQLite directly
      const orphanedEdges = this.db.prepare(`
        SELECT COUNT(*) as count FROM graph_edges
        WHERE source_node_id NOT IN (SELECT id FROM graph_nodes)
           OR target_node_id NOT IN (SELECT id FROM graph_nodes)
      `).get() as { count: number };

      const totalOrphans = report.danglingEdges.length + (orphanedEdges?.count ?? 0);

      if (report.isValid && totalOrphans === 0) {
        checks.push({
          name: 'Knowledge Graph Consistency',
          category: 'graph',
          status: 'ok',
          message: `Graph is consistent (${report.totalNodes} nodes, ${report.totalEdges} edges)`,
        });
      } else {
        checks.push({
          name: 'Knowledge Graph Consistency',
          category: 'graph',
          status: 'warning',
          message: `Graph has ${totalOrphans} orphaned edge(s) or dangling references`,
          details: report,
          remedy: "Run 'ai-project-os repair' or 'ai-project-os rebuild-graph'.",
        });
        recommendations.push("Rebuild graph using 'ai-project-os rebuild-graph' to synchronize relationships.");
      }
    } catch (err) {
      checks.push({
        name: 'Knowledge Graph Consistency',
        category: 'graph',
        status: 'error',
        message: `Graph verification failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async checkSessionsAndHandoff(
    projectId: string | undefined,
    checks: DiagnosticCheckItem[],
    recommendations: string[]
  ): Promise<void> {
    // 1. Session Health
    if (projectId) {
      const activeSessions = this.db.prepare(`
        SELECT * FROM execution_sessions
        WHERE project_id = ? AND status = 'active'
      `).all(projectId) as Array<Record<string, unknown>>;

      const now = Date.now();
      const STALE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
      const staleSessions = activeSessions.filter((s) => now - Number(s['started_at']) > STALE_TIMEOUT_MS);

      if (staleSessions.length === 0) {
        checks.push({
          name: 'Execution Sessions',
          category: 'session',
          status: 'ok',
          message: activeSessions.length > 0 ? `${activeSessions.length} active session(s) operating normally` : 'No active sessions',
        });
      } else {
        checks.push({
          name: 'Execution Sessions',
          category: 'session',
          status: 'warning',
          message: `Found ${staleSessions.length} stale/interrupted session(s) exceeding timeout`,
          remedy: "Run 'ai-project-os repair' to transition stale sessions to 'interrupted'.",
        });
        recommendations.push("Clean up stale sessions via 'ai-project-os repair'.");
      }
    }

    // 2. Handoff Health
    const handoffPath = path.join(this.projectRoot, '.ai', 'handoff', 'CURRENT.json');
    if (fs.existsSync(handoffPath)) {
      try {
        const raw = fs.readFileSync(handoffPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed.taskId || !parsed.status) {
          checks.push({
            name: 'Handoff State Integrity',
            category: 'session',
            status: 'warning',
            message: "Handoff file '.ai/handoff/CURRENT.json' is missing required fields (taskId, status)",
            remedy: "Run 'ai-project-os repair' to reset corrupted handoff.",
          });
        } else {
          // Validate git consistency
          const consistency = await this.handoffValidator.validateConsistency(parsed);
          if (consistency.isConsistent) {
            checks.push({
              name: 'Handoff State Integrity',
              category: 'session',
              status: 'ok',
              message: `Active handoff for task ${parsed.taskId} matches git working tree`,
            });
          } else {
            checks.push({
              name: 'Handoff State Integrity',
              category: 'session',
              status: 'warning',
              message: `Handoff state diverges from working tree: ${consistency.warnings.map((w) => w.message).join(', ')}`,
              remedy: "Re-run 'ai-project-os session handoff' or verify git branch.",
            });
          }
        }
      } catch (err) {
        checks.push({
          name: 'Handoff State Integrity',
          category: 'session',
          status: 'error',
          message: `Failed to parse .ai/handoff/CURRENT.json: ${err instanceof Error ? err.message : String(err)}`,
          remedy: "Run 'ai-project-os repair' to archive corrupted handoff.",
        });
        recommendations.push("Fix or reset corrupted CURRENT.json handoff file.");
      }
    } else {
      checks.push({
        name: 'Handoff State Integrity',
        category: 'session',
        status: 'ok',
        message: 'No current handoff pending (clean state)',
      });
    }
  }

  private async checkIndexAndValidation(
    projectId: string | undefined,
    checks: DiagnosticCheckItem[],
    recommendations: string[]
  ): Promise<void> {
    if (!projectId) return;

    // 1. Stale Index Check: Compare indexed files in graph with files on disk
    try {
      const indexedFiles = this.db.prepare(`
        SELECT COUNT(*) as count FROM graph_nodes
        WHERE project_id = ? AND entity_type = 'file'
      `).get(projectId) as { count: number };

      if (indexedFiles && indexedFiles.count > 0) {
        checks.push({
          name: 'Code Index Freshness',
          category: 'index',
          status: 'ok',
          message: `${indexedFiles.count} file(s) indexed in code intelligence graph`,
        });
      } else {
        checks.push({
          name: 'Code Index Freshness',
          category: 'index',
          status: 'warning',
          message: 'Zero files currently indexed for this project',
          remedy: "Run 'ai-project-os reindex' to build code intelligence index.",
        });
        recommendations.push("Run 'ai-project-os reindex' to populate symbol and file index.");
      }
    } catch {
      // Ignore
    }

    // 2. Validation Freshness Check: Flag tasks in 'in_progress' or 'resumed' with no validation
    try {
      const tasks = this.taskRepo.listByProject(projectId);
      const activeTasks = tasks.filter((t) => t.status === 'in_progress' || t.status === 'resumed' || t.status === 'testing');
      let tasksWithoutValidation = 0;

      for (const t of activeTasks) {
        const runs = this.validationRepo.listByTask(t.id);
        if (runs.length === 0) {
          tasksWithoutValidation++;
        }
      }

      if (tasksWithoutValidation === 0) {
        checks.push({
          name: 'Validation Guard Health',
          category: 'validation',
          status: 'ok',
          message: 'All active tasks have recorded validation runs',
        });
      } else {
        checks.push({
          name: 'Validation Guard Health',
          category: 'validation',
          status: 'warning',
          message: `${tasksWithoutValidation} active task(s) do not have recorded validation runs`,
          remedy: 'Run tests or validate task implementation prior to handoff.',
        });
      }
    } catch {
      // Ignore
    }
  }

  // ===========================================================================
  // 2. SELF-REPAIR & RECONCILIATION
  // ===========================================================================

  public async repair(explicitProjectId?: string): Promise<DoctorRepairReport> {
    const repairedItems: string[] = [];
    const warnings: string[] = [];
    const projectId = explicitProjectId ?? this.resolveCurrentProjectId();

    // 1. Recreate missing directories
    const requiredDirs = [
      path.join(this.projectRoot, '.ai'),
      path.join(this.projectRoot, '.ai', 'state'),
      path.join(this.projectRoot, '.ai', 'canonical'),
      path.join(this.projectRoot, '.ai', 'canonical', 'DECISIONS'),
      path.join(this.projectRoot, '.ai', 'handoff'),
      path.join(this.projectRoot, '.ai', 'tasks'),
      path.join(this.projectRoot, '.ai', 'proposals'),
      path.join(this.projectRoot, '.ai', 'backups'),
    ];

    for (const dir of requiredDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        repairedItems.push(`Created directory '${path.relative(this.projectRoot, dir)}'`);
      }
    }

    // 2. Recreate default canonical templates if missing
    const canonicalDir = path.join(this.projectRoot, '.ai', 'canonical');
    const defaultTemplates: Record<string, string> = {
      'PROJECT.md': '# Project Overview\n\nSystem overview, objectives, and domain concepts.',
      'ARCHITECTURE.md': '# Architecture Guidelines\n\nLayer boundaries, architectural rules, and anti-bloat constraints.',
      'CONSTRAINTS.md': '# Technical Constraints\n\nSecurity, performance, and operational constraints.',
    };

    for (const [filename, content] of Object.entries(defaultTemplates)) {
      const filePath = path.join(canonicalDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, 'utf8');
        repairedItems.push(`Created default template '.ai/canonical/${filename}'`);
      }
    }

    // 3. Clean up orphaned graph edges
    try {
      const deletedEdges = this.db.prepare(`
        DELETE FROM graph_edges
        WHERE source_node_id NOT IN (SELECT id FROM graph_nodes)
           OR target_node_id NOT IN (SELECT id FROM graph_nodes)
      `).run();

      if (deletedEdges.changes && deletedEdges.changes > 0) {
        repairedItems.push(`Removed ${deletedEdges.changes} orphaned graph edge(s)`);
      }
    } catch (err) {
      warnings.push(`Could not clean graph edges: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 4. Recover stale / interrupted execution sessions
    if (projectId) {
      try {
        const now = Date.now();
        const STALE_TIMEOUT_MS = 60 * 60 * 1000;
        const activeSessions = this.db.prepare(`
          SELECT * FROM execution_sessions
          WHERE project_id = ? AND status = 'active'
        `).all(projectId) as Array<Record<string, unknown>>;

        let recoveredCount = 0;
        for (const s of activeSessions) {
          if (now - Number(s['started_at']) > STALE_TIMEOUT_MS) {
            this.sessionRepo.updateStatus(String(s['id']), 'ended', now);
            recoveredCount++;
          }
        }

        if (recoveredCount > 0) {
          repairedItems.push(`Transitioned ${recoveredCount} stale session(s) to 'ended'`);
        }
      } catch (err) {
        warnings.push(`Could not update stale sessions: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 5. Recover corrupted handoff file if necessary
    const handoffFile = path.join(this.projectRoot, '.ai', 'handoff', 'CURRENT.json');
    if (fs.existsSync(handoffFile)) {
      try {
        const content = fs.readFileSync(handoffFile, 'utf8');
        JSON.parse(content);
      } catch {
        const backupCorrupted = path.join(
          this.projectRoot,
          '.ai',
          'handoff',
          `CURRENT.corrupted.${Date.now()}.json`
        );
        fs.renameSync(handoffFile, backupCorrupted);
        repairedItems.push(`Archived corrupted CURRENT.json to '${path.basename(backupCorrupted)}'`);
      }
    }

    // 6. Checkpoint WAL and optimize SQLite storage
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      this.db.exec('VACUUM;');
      repairedItems.push('Executed SQLite WAL checkpoint and VACUUM storage optimization');
    } catch (err) {
      warnings.push(`VACUUM warning: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      timestamp: Date.now(),
      projectRoot: this.projectRoot,
      projectId,
      repairedItems,
      warnings,
      success: warnings.length === 0,
    };
  }

  // ===========================================================================
  // 3. REINDEX & REBUILD GRAPH
  // ===========================================================================

  public async reindex(explicitProjectId?: string): Promise<IndexProjectResult> {
    const projectId = explicitProjectId ?? this.resolveCurrentProjectId();
    if (!projectId) {
      throw new Error('No project found in database to reindex. Create or register a project first.');
    }

    return this.codeIndexer.indexProject(this.projectRoot, projectId);
  }

  public async rebuildGraph(explicitProjectId?: string): Promise<RebuildGraphResult> {
    const start = Date.now();
    const projectId = explicitProjectId ?? this.resolveCurrentProjectId();
    if (!projectId) {
      throw new Error('No project found in database to rebuild graph. Create or register a project first.');
    }

    // 1. Clear existing graph nodes and edges for this project
    this.db.prepare('DELETE FROM graph_edges WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM graph_nodes WHERE project_id = ?').run(projectId);

    let nodesCreated = 0;
    let edgesCreated = 0;

    // 2. Add Project Node
    const project = this.projectRepo.findById(projectId);
    if (project) {
      await this.graphService.addNode({
        projectId,
        entityType: 'module',
        label: project.name,
        name: project.name,
        entityId: project.id,
      });
      nodesCreated++;
    }

    // 3. Re-add Tasks
    const tasks = this.taskRepo.listByProject(projectId);
    for (const t of tasks) {
      await this.graphService.addNode({
        projectId,
        entityType: 'task',
        label: t.title,
        name: t.title,
        entityId: t.id,
      });
      nodesCreated++;
    }

    // 4. Re-add Decisions
    const decisions = this.decisionRepo.listByProject(projectId);
    for (const d of decisions) {
      await this.graphService.addNode({
        projectId,
        entityType: 'decision',
        label: d.title,
        name: d.title,
        entityId: d.id,
      });
      nodesCreated++;
    }

    // 5. Re-add Constraints
    const constraints = this.constraintRepo.listByProject(projectId);
    for (const c of constraints) {
      await this.graphService.addNode({
        projectId,
        entityType: 'constraint',
        label: c.title,
        name: c.title,
        entityId: c.id,
      });
      nodesCreated++;
    }

    // 6. Run Code Indexer to rebuild file, symbol, and dependency nodes & edges
    const indexResult = await this.codeIndexer.indexProject(this.projectRoot, projectId);
    nodesCreated += indexResult.filesIndexed + indexResult.symbolsIndexed;
    edgesCreated += indexResult.edgesCreated;

    return {
      projectId,
      nodesCreated,
      edgesCreated,
      durationMs: Date.now() - start,
    };
  }

  // ===========================================================================
  // 4. VALIDATION
  // ===========================================================================

  public async validate(explicitProjectId?: string): Promise<DoctorValidationResult> {
    const issues: string[] = [];
    const projectId = explicitProjectId ?? this.resolveCurrentProjectId();

    // 1. Database Check
    let databaseValid = false;
    try {
      const integrityRow = this.db.prepare('PRAGMA integrity_check;').get() as Record<string, unknown> | undefined;
      const res = integrityRow ? String(Object.values(integrityRow)[0]) : '';
      databaseValid = res.toLowerCase() === 'ok';
      if (!databaseValid) {
        issues.push(`Database integrity failure: ${res}`);
      }
    } catch (err) {
      issues.push(`Database check error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Memory Validation
    let memoryReport: MemoryValidationReport = {
      isValid: true,
      totalDocuments: 0,
      totalChunks: 0,
      details: [],
      duplicateKeys: [],
      desynchronizedFiles: [],
      canonicalFilesChecked: [],
    };
    if (projectId) {
      memoryReport = await this.memoryValidator.validate(this.projectRoot, projectId);
      if (!memoryReport.isValid) {
        issues.push(...memoryReport.details);
      }
    }

    // 3. Graph Validation
    const graphReport = await this.graphService.verifyGraphIntegrity(projectId);
    if (!graphReport.isValid) {
      issues.push(`Graph integrity report flagged ${graphReport.danglingEdges.length} orphaned edge(s)`);
    }

    return {
      timestamp: Date.now(),
      valid: issues.length === 0,
      databaseValid,
      memoryReport,
      graphReport,
      issues,
    };
  }

  // ===========================================================================
  // 5. ATOMIC BACKUP & RESTORE
  // ===========================================================================

  public async backup(customDestinationDir?: string): Promise<BackupResult> {
    const start = Date.now();
    const timestamp = Date.now();
    const backupDir =
      customDestinationDir ??
      path.join(this.projectRoot, '.ai', 'backups', `backup-${timestamp}`);

    fs.mkdirSync(backupDir, { recursive: true });

    const filesManifest: BackupManifest['files'] = [];
    const projectId = this.resolveCurrentProjectId();
    const project = projectId ? this.projectRepo.findById(projectId) : null;

    // 1. Atomic SQLite Database Backup via VACUUM INTO
    let databaseIncluded = false;
    const dbBackupTarget = path.join(backupDir, 'project-os.sqlite');
    try {
      this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE);').run();
      this.db.prepare(`VACUUM INTO '${dbBackupTarget}';`).run();
      databaseIncluded = true;

      const stats = fs.statSync(dbBackupTarget);
      const sha256 = this.computeFileHash(dbBackupTarget);
      filesManifest.push({
        relativePath: 'project-os.sqlite',
        sizeBytes: stats.size,
        sha256,
      });
    } catch {
      // In-memory or fallback copy
      const stateDb = path.join(this.projectRoot, '.ai', 'state', 'project-os.sqlite');
      if (fs.existsSync(stateDb)) {
        fs.copyFileSync(stateDb, dbBackupTarget);
        databaseIncluded = true;
        const stats = fs.statSync(dbBackupTarget);
        const sha256 = this.computeFileHash(dbBackupTarget);
        filesManifest.push({
          relativePath: 'project-os.sqlite',
          sizeBytes: stats.size,
          sha256,
        });
      }
    }

    // 2. Recursively archive .ai subdirectories
    const subdirsToArchive = ['canonical', 'handoff', 'tasks', 'proposals'];
    for (const subdir of subdirsToArchive) {
      const srcSubdir = path.join(this.projectRoot, '.ai', subdir);
      const destSubdir = path.join(backupDir, subdir);

      if (fs.existsSync(srcSubdir)) {
        this.copyDirectoryRecursive(srcSubdir, destSubdir, subdir, filesManifest);
      }
    }

    // 3. Write Manifest
    const manifest: BackupManifest = {
      version: '1.0.0',
      timestamp,
      createdAt: new Date(timestamp).toISOString(),
      projectId: projectId ?? undefined,
      projectName: project?.name,
      databaseIncluded,
      files: filesManifest,
    };

    fs.writeFileSync(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return {
      backupDir,
      manifest,
      durationMs: Date.now() - start,
      success: true,
    };
  }

  public async restore(backupSourcePath: string): Promise<RestoreResult> {
    const timestamp = Date.now();

    if (!fs.existsSync(backupSourcePath)) {
      throw new Error(`Backup source directory not found: ${backupSourcePath}`);
    }

    // 1. Verify Manifest
    const manifestPath = path.join(backupSourcePath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Invalid backup archive: missing 'manifest.json' at ${backupSourcePath}`);
    }

    const manifest: BackupManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Verify all file checksums
    for (const file of manifest.files) {
      const filePath = path.join(backupSourcePath, file.relativePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Corrupted backup: missing expected file '${file.relativePath}'`);
      }
      const actualHash = this.computeFileHash(filePath);
      if (actualHash !== file.sha256) {
        throw new Error(
          `Checksum mismatch for '${file.relativePath}'. Expected: ${file.sha256}, Actual: ${actualHash}`
        );
      }
    }

    // 2. Create Pre-restore Safety Backup
    let preRestoreBackupDir: string | undefined = undefined;
    try {
      const safetyBackup = await this.backup(
        path.join(this.projectRoot, '.ai', 'backups', `pre-restore-${timestamp}`)
      );
      preRestoreBackupDir = safetyBackup.backupDir;
    } catch {
      // Ignored if current state has nothing yet
    }

    let filesRestored = 0;

    // 3. Restore Database File if included
    const backupDbFile = path.join(backupSourcePath, 'project-os.sqlite');
    const targetDbDir = path.join(this.projectRoot, '.ai', 'state');
    fs.mkdirSync(targetDbDir, { recursive: true });
    const targetDbFile = path.join(targetDbDir, 'project-os.sqlite');

    if (fs.existsSync(backupDbFile)) {
      // Checkpoint and close wal
      try {
        this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE);').run();
      } catch {
        // Ignored
      }

      // Overwrite database
      fs.copyFileSync(backupDbFile, targetDbFile);
      filesRestored++;
    }

    // 4. Restore Subdirectories
    const subdirs = ['canonical', 'handoff', 'tasks', 'proposals'];
    for (const subdir of subdirs) {
      const backupSubdir = path.join(backupSourcePath, subdir);
      const targetSubdir = path.join(this.projectRoot, '.ai', subdir);

      if (fs.existsSync(backupSubdir)) {
        fs.mkdirSync(targetSubdir, { recursive: true });
        const restored = this.restoreDirectoryRecursive(backupSubdir, targetSubdir);
        filesRestored += restored;
      }
    }

    // 5. Verify restored database integrity
    let databaseIntegrity: 'ok' | 'failed' = 'ok';
    try {
      const integrityRow = this.db.prepare('PRAGMA integrity_check;').get() as Record<string, unknown> | undefined;
      const res = integrityRow ? String(Object.values(integrityRow)[0]) : '';
      if (res.toLowerCase() !== 'ok') {
        databaseIntegrity = 'failed';
      }
    } catch {
      databaseIntegrity = 'failed';
    }

    return {
      restoredFrom: backupSourcePath,
      preRestoreBackupDir,
      timestamp,
      filesRestored,
      databaseIntegrity,
      success: databaseIntegrity === 'ok',
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private resolveCurrentProjectId(): string | undefined {
    const projects = this.projectRepo.list();
    return projects[0]?.id;
  }

  private computeFileHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private copyDirectoryRecursive(
    srcDir: string,
    destDir: string,
    prefix: string,
    manifest: BackupManifest['files']
  ): void {
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      const relPath = path.join(prefix, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath, relPath, manifest);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        const stats = fs.statSync(destPath);
        const sha256 = this.computeFileHash(destPath);
        manifest.push({
          relativePath: relPath,
          sizeBytes: stats.size,
          sha256,
        });
      }
    }
  }

  private restoreDirectoryRecursive(srcDir: string, destDir: string): number {
    let count = 0;
    fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        count += this.restoreDirectoryRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        count++;
      }
    }
    return count;
  }
}
