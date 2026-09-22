import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';
import {
  Project,
  ObsidianSyncOptions,
  ObsidianSyncResult,
  ObsidianConflictRecord,
  ObsidianEntityType,
} from '../core/types.js';
import { ProjectNotFoundError } from '../core/errors.js';
import { ProjectRepository } from '../database/repositories/project.repository.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { ConstraintRepository } from '../database/repositories/constraint.repository.js';
import { ObsidianLedgerRepository } from '../database/repositories/obsidian-ledger.repository.js';
import { ObsidianExporter } from './obsidian-exporter.js';
import { ObsidianIndexGenerator } from './obsidian-index-generator.js';
import { ObsidianParser } from './obsidian-parser.js';

export class ObsidianSyncService {
  private readonly projectRepo: ProjectRepository;
  private readonly taskRepo: TaskRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly ledgerRepo: ObsidianLedgerRepository;
  private readonly exporter: ObsidianExporter;
  private readonly indexGenerator: ObsidianIndexGenerator;

  constructor(
    db: DatabaseSync,
    private readonly projectRoot: string
  ) {
    this.projectRepo = new ProjectRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.constraintRepo = new ConstraintRepository(db);
    this.ledgerRepo = new ObsidianLedgerRepository(db);
    this.exporter = new ObsidianExporter();
    this.indexGenerator = new ObsidianIndexGenerator();
  }

  public static hashContent(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Main bidirectional synchronization entrypoint.
   * Prevents infinite sync loops by consulting the SHA-256 ledger.
   */
  public async sync(options?: ObsidianSyncOptions): Promise<ObsidianSyncResult> {
    const canonicalDir = path.join(this.projectRoot, '.ai', 'canonical');
    await fs.mkdir(canonicalDir, { recursive: true });

    // Determine project
    let project: Project | null = null;
    if (options?.projectId) {
      project = this.projectRepo.findById(options.projectId);
    } else {
      const projects = this.projectRepo.list();
      project = projects[0] ?? null;
    }

    if (!project) {
      throw new ProjectNotFoundError(options?.projectId || 'default');
    }

    const direction = options?.direction || 'bidirectional';
    const exportedFiles: string[] = [];
    const importedFiles: string[] = [];
    const unchangedFiles: string[] = [];
    const conflicts: ObsidianConflictRecord[] = [];
    const warnings: string[] = [];

    // 1. IMPORT PASS (Markdown -> SQLite) unless export_only
    if (direction !== 'export_only') {
      const importResult = await this.importModified(project.id, canonicalDir);
      importedFiles.push(...importResult.importedFiles);
      conflicts.push(...importResult.conflicts);
      warnings.push(...importResult.warnings);
    }

    // 2. EXPORT PASS (SQLite -> Markdown) unless import_only
    if (direction !== 'import_only') {
      const exportResult = await this.exportAll(project.id, canonicalDir, options?.force);
      exportedFiles.push(...exportResult.exportedFiles);
      unchangedFiles.push(...exportResult.unchangedFiles);
      conflicts.push(...exportResult.conflicts);
      warnings.push(...exportResult.warnings);
    }

    return {
      projectId: project.id,
      syncedFilesCount: exportedFiles.length + importedFiles.length,
      exportedFiles: Array.from(new Set(exportedFiles)),
      importedFiles: Array.from(new Set(importedFiles)),
      unchangedFiles: Array.from(new Set(unchangedFiles)),
      conflicts,
      warnings,
      timestamp: Date.now(),
    };
  }

  /**
   * Exports all SQLite state to canonical Markdown in Obsidian vault.
   * Only writes to disk if content has actually changed (anti-loop).
   */
  public async exportAll(
    projectId: string,
    canonicalDir: string,
    force = false
  ): Promise<{ exportedFiles: string[]; unchangedFiles: string[]; conflicts: ObsidianConflictRecord[]; warnings: string[] }> {
    const project = this.projectRepo.findById(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);

    const exportedFiles: string[] = [];
    const unchangedFiles: string[] = [];
    const conflicts: ObsidianConflictRecord[] = [];
    const warnings: string[] = [];

    const tasks = this.taskRepo.listByProject(projectId);
    const decisions = this.decisionRepo.listByProject(projectId);
    const constraints = this.constraintRepo.listByProject(projectId);

    // Helper to safely write file with conflict guard and loop prevention
    const safeWrite = async (
      relPath: string,
      entityType: ObsidianEntityType,
      entityId: string,
      getContent: () => string | Promise<string>
    ) => {
      const fullPath = path.join(canonicalDir, relPath);
      const ledger = this.ledgerRepo.getEntry(projectId, relPath);

      const diskExists = fsSync.existsSync(fullPath);
      let diskModified = false;
      let diskContent = '';
      let diskHash = '';

      if (diskExists) {
        diskContent = await fs.readFile(fullPath, 'utf8');
        diskHash = ObsidianSyncService.hashContent(diskContent);
        if (ledger && diskHash !== ledger.lastSyncedHash) {
          diskModified = true;
        }
      }

      const newContent = await getContent();
      const newHash = ObsidianSyncService.hashContent(newContent);

      // Check loop prevention: if file on disk was already newHash and untouched
      if (!force && diskExists && ledger && ledger.lastSyncedHash === newHash && !diskModified) {
        unchangedFiles.push(relPath);
        return;
      }

      // CONFLICT DETECTION: If disk was modified externally AND does not match new content
      if (diskExists && diskModified && diskHash !== newHash && !force) {
        const conflictFilename = `${path.basename(relPath, '.md')}.conflict-${Date.now()}.md`;
        const conflictRelPath = path.join(path.dirname(relPath), conflictFilename);
        const conflictFullPath = path.join(canonicalDir, conflictRelPath);

        await fs.mkdir(path.dirname(conflictFullPath), { recursive: true });
        await fs.writeFile(conflictFullPath, diskContent, 'utf8');

        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, newContent, 'utf8');

        const conflictRecord: ObsidianConflictRecord = {
          filePath: relPath,
          entityType,
          entityId,
          sqliteHash: newHash,
          markdownHash: diskHash,
          ledgerHash: ledger?.lastSyncedHash ?? '',
          conflictFilePath: conflictRelPath,
          detectedAt: Date.now(),
          message: `Concurrent edit detected in ${relPath}. Human version preserved in ${conflictRelPath}.`,
        };

        conflicts.push(conflictRecord);
        warnings.push(conflictRecord.message);
      } else {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, newContent, 'utf8');
      }

      // Update ledger
      const stat = await fs.stat(fullPath);
      this.ledgerRepo.upsertEntry({
        projectId,
        entityType,
        entityId,
        filePath: relPath,
        lastSyncedHash: newHash,
        lastSyncedMtime: stat.mtimeMs,
        syncSource: 'sqlite_to_markdown',
      });

      exportedFiles.push(relPath);
    };

    // 1. Export PROJECT.md
    await safeWrite('PROJECT.md', 'project', project.id, () =>
      this.exporter.renderProject(project)
    );

    // 2. Export ARCHITECTURE.md
    await safeWrite('ARCHITECTURE.md', 'architecture', 'ARCHITECTURE', () =>
      this.exporter.renderArchitecture(project, decisions)
    );

    // 3. Export CONSTRAINTS.md
    await safeWrite('CONSTRAINTS.md', 'constraint', 'CONSTRAINTS', () =>
      this.exporter.renderConstraints(project, constraints)
    );

    // 4. Export DECISIONS.md hub & individual DECISIONS/DECISION-XXX.md
    await safeWrite('DECISIONS.md', 'decision', 'DECISIONS_HUB', () =>
      this.indexGenerator.renderDecisionsHub(decisions, project.updatedAt)
    );

    for (const decision of decisions) {
      const relPath = path.join('DECISIONS', `${decision.id}.md`);
      await safeWrite(relPath, 'decision', decision.id, () =>
        this.exporter.renderDecision(decision)
      );
    }

    // 5. Export TASKS.md hub & individual TASKS/TASK-XXX.md
    await safeWrite('TASKS.md', 'task', 'TASKS_HUB', () =>
      this.indexGenerator.renderTasksHub(tasks, project.updatedAt)
    );

    for (const task of tasks) {
      const relPath = path.join('TASKS', `${task.id}.md`);
      const steps = this.taskRepo.listSteps(task.id);
      const blockers = this.taskRepo.listBlockers(task.id);
      await safeWrite(relPath, 'task', task.id, () =>
        this.exporter.renderTask(task, steps, blockers)
      );
    }

    // 6. Export RESEARCH.md hub
    await safeWrite('RESEARCH.md', 'research', 'RESEARCH_HUB', () =>
      this.indexGenerator.renderResearchHub([], project.updatedAt)
    );

    // 7. Export central INDEX.md hub
    await safeWrite('INDEX.md', 'index', 'ROOT_INDEX', () =>
      this.indexGenerator.renderIndex(project, tasks, decisions, constraints)
    );

    return { exportedFiles, unchangedFiles, conflicts, warnings };
  }

  /**
   * Scans canonical directory for manual external edits and updates SQLite machine state.
   */
  public async importModified(
    projectId: string,
    canonicalDir: string
  ): Promise<{ importedFiles: string[]; conflicts: ObsidianConflictRecord[]; warnings: string[] }> {
    const importedFiles: string[] = [];
    const conflicts: ObsidianConflictRecord[] = [];
    const warnings: string[] = [];

    // Scan TASKS directory
    const tasksDir = path.join(canonicalDir, 'TASKS');
    if (fsSync.existsSync(tasksDir)) {
      const taskFiles = await fs.readdir(tasksDir);
      for (const file of taskFiles) {
        if (!file.endsWith('.md') || file.includes('.conflict-')) continue;

        const relPath = path.join('TASKS', file);
        const fullPath = path.join(canonicalDir, relPath);
        const content = await fs.readFile(fullPath, 'utf8');
        const hash = ObsidianSyncService.hashContent(content);

        const ledger = this.ledgerRepo.getEntry(projectId, relPath);

        // If ledger exists and hash matches: NO EXTERNAL CHANGE
        if (ledger && ledger.lastSyncedHash === hash) {
          continue;
        }

        // External change detected in task file!
        const fallbackId = path.basename(file, '.md');
        const parsed = ObsidianParser.parseTask(content, fallbackId);

        const existingTask = this.taskRepo.findById(parsed.id);
        if (existingTask) {
          const isConcurrentConflict = ledger && existingTask.updatedAt > ledger.lastSyncedMtime;

          if (isConcurrentConflict) {
            // Concurrent Conflict detected!
            const conflictFilename = `${path.basename(relPath, '.md')}.conflict-${Date.now()}.md`;
            const conflictRelPath = path.join(path.dirname(relPath), conflictFilename);
            const conflictFullPath = path.join(canonicalDir, conflictRelPath);

            // 1. Preserve human-modified disk version in conflict file
            await fs.writeFile(conflictFullPath, content, 'utf8');

            // 2. Export agent's SQLite version to primary file
            const steps = this.taskRepo.listSteps(existingTask.id);
            const blockers = this.taskRepo.listBlockers(existingTask.id);
            const agentContent = this.exporter.renderTask(existingTask, steps, blockers);
            await fs.writeFile(fullPath, agentContent, 'utf8');

            // 3. Update ledger to agent's content hash
            const agentHash = ObsidianSyncService.hashContent(agentContent);
            const stat = await fs.stat(fullPath);
            this.ledgerRepo.upsertEntry({
              projectId,
              entityType: 'task',
              entityId: existingTask.id,
              filePath: relPath,
              lastSyncedHash: agentHash,
              lastSyncedMtime: stat.mtimeMs,
              syncSource: 'sqlite_to_markdown',
            });

            const conflictRecord: ObsidianConflictRecord = {
              filePath: relPath,
              entityType: 'task',
              entityId: existingTask.id,
              sqliteHash: agentHash,
              markdownHash: hash,
              ledgerHash: ledger.lastSyncedHash,
              conflictFilePath: conflictRelPath,
              detectedAt: Date.now(),
              message: `Concurrent edit detected in ${relPath}. Human version preserved in ${conflictRelPath}.`,
            };

            conflicts.push(conflictRecord);
            warnings.push(conflictRecord.message);
            continue;
          }

          // Clean human edit: Update task fields in SQLite
          this.taskRepo.update(parsed.id, {
            title: parsed.title ?? existingTask.title,
            status: parsed.status ?? existingTask.status,
            priority: parsed.priority ?? existingTask.priority,
            assignedAgent: parsed.assignedAgent ?? existingTask.assignedAgent,
            goal: parsed.goal ?? existingTask.goal,
            description: parsed.description ?? existingTask.description,
          });

          // Sync steps checklist
          const existingSteps = this.taskRepo.listSteps(parsed.id);
          for (const parsedStep of parsed.steps) {
            const match = existingSteps.find((s) => s.stepOrder === parsedStep.stepOrder);
            if (match) {
              const targetStatus = parsedStep.completed ? 'completed' : 'pending';
              if (match.status !== targetStatus) {
                this.taskRepo.updateStepStatus(match.id, targetStatus);
              }
            } else {
              const newStep = this.taskRepo.addStep(parsed.id, parsedStep.title, parsedStep.stepOrder);
              if (parsedStep.completed) {
                this.taskRepo.updateStepStatus(newStep.id, 'completed');
              }
            }
          }

          const stat = await fs.stat(fullPath);
          this.ledgerRepo.upsertEntry({
            projectId,
            entityType: 'task',
            entityId: parsed.id,
            filePath: relPath,
            lastSyncedHash: hash,
            lastSyncedMtime: stat.mtimeMs,
            syncSource: 'markdown_to_sqlite',
          });

          importedFiles.push(relPath);
        }
      }
    }

    // Scan DECISIONS directory
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    if (fsSync.existsSync(decisionsDir)) {
      const decisionFiles = await fs.readdir(decisionsDir);
      for (const file of decisionFiles) {
        if (!file.endsWith('.md') || file.includes('.conflict-')) continue;

        const relPath = path.join('DECISIONS', file);
        const fullPath = path.join(canonicalDir, relPath);
        const content = await fs.readFile(fullPath, 'utf8');
        const hash = ObsidianSyncService.hashContent(content);

        const ledger = this.ledgerRepo.getEntry(projectId, relPath);

        if (ledger && ledger.lastSyncedHash === hash) {
          continue;
        }

        const fallbackId = path.basename(file, '.md');
        const parsed = ObsidianParser.parseDecision(content, fallbackId);

        const existingDecision = this.decisionRepo.findById(parsed.id);
        if (existingDecision) {
          const isConcurrentConflict = ledger && existingDecision.updatedAt > ledger.lastSyncedMtime;

          if (isConcurrentConflict) {
            const conflictFilename = `${path.basename(relPath, '.md')}.conflict-${Date.now()}.md`;
            const conflictRelPath = path.join(path.dirname(relPath), conflictFilename);
            const conflictFullPath = path.join(canonicalDir, conflictRelPath);

            await fs.writeFile(conflictFullPath, content, 'utf8');

            const agentContent = this.exporter.renderDecision(existingDecision);
            await fs.writeFile(fullPath, agentContent, 'utf8');

            const agentHash = ObsidianSyncService.hashContent(agentContent);
            const stat = await fs.stat(fullPath);
            this.ledgerRepo.upsertEntry({
              projectId,
              entityType: 'decision',
              entityId: existingDecision.id,
              filePath: relPath,
              lastSyncedHash: agentHash,
              lastSyncedMtime: stat.mtimeMs,
              syncSource: 'sqlite_to_markdown',
            });

            const conflictRecord: ObsidianConflictRecord = {
              filePath: relPath,
              entityType: 'decision',
              entityId: existingDecision.id,
              sqliteHash: agentHash,
              markdownHash: hash,
              ledgerHash: ledger.lastSyncedHash,
              conflictFilePath: conflictRelPath,
              detectedAt: Date.now(),
              message: `Concurrent edit detected in ${relPath}. Human version preserved in ${conflictRelPath}.`,
            };

            conflicts.push(conflictRecord);
            warnings.push(conflictRecord.message);
            continue;
          }

          this.decisionRepo.update(parsed.id, {
            title: parsed.title ?? existingDecision.title,
            status: parsed.status ?? existingDecision.status,
            context: parsed.context ?? existingDecision.context,
            decisionRationale: parsed.decision ?? existingDecision.decisionRationale,
            consequences: parsed.consequences ?? existingDecision.consequences,
          });

          const stat = await fs.stat(fullPath);
          this.ledgerRepo.upsertEntry({
            projectId,
            entityType: 'decision',
            entityId: parsed.id,
            filePath: relPath,
            lastSyncedHash: hash,
            lastSyncedMtime: stat.mtimeMs,
            syncSource: 'markdown_to_sqlite',
          });

          importedFiles.push(relPath);
        }
      }
    }

    return { importedFiles, conflicts, warnings };
  }

  /**
   * Generates sync status summary for diagnostic and CLI inspection.
   */
  public async getStatus(projectId: string): Promise<{
    projectId: string;
    totalSyncedFiles: number;
    files: { filePath: string; entityType: string; status: 'synced' | 'modified_on_disk' | 'missing' }[];
  }> {
    const canonicalDir = path.join(this.projectRoot, '.ai', 'canonical');
    const ledgerEntries = this.ledgerRepo.listAll(projectId);

    const files: { filePath: string; entityType: string; status: 'synced' | 'modified_on_disk' | 'missing' }[] = [];

    for (const entry of ledgerEntries) {
      const fullPath = path.join(canonicalDir, entry.filePath);
      if (!fsSync.existsSync(fullPath)) {
        files.push({ filePath: entry.filePath, entityType: entry.entityType, status: 'missing' });
      } else {
        const content = await fs.readFile(fullPath, 'utf8');
        const hash = ObsidianSyncService.hashContent(content);
        const status = hash === entry.lastSyncedHash ? 'synced' : 'modified_on_disk';
        files.push({ filePath: entry.filePath, entityType: entry.entityType, status });
      }
    }

    return {
      projectId,
      totalSyncedFiles: ledgerEntries.length,
      files,
    };
  }
}
