import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  HandoffSnapshotData,
  CreateHandoffOptions,
  HandoffValidationState,
} from '../core/types.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { HandoffRepository } from '../database/repositories/handoff.repository.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';

export class HandoffSnapshot {
  private readonly taskRepo: TaskRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly gitAnalyzer: GitAnalyzer;

  constructor(
    db: DatabaseSync,
    private readonly projectRoot: string = process.cwd()
  ) {

    this.taskRepo = new TaskRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.handoffRepo = new HandoffRepository(db);
    this.gitAnalyzer = new GitAnalyzer();
  }

  /**
   * Captures runtime continuity state into a standardized HandoffSnapshotData object.
   */
  public async captureSnapshot(options: CreateHandoffOptions): Promise<HandoffSnapshotData> {
    const task = this.taskRepo.findById(options.taskId);
    if (!task) {
      throw new Error(`Task with id '${options.taskId}' not found`);
    }

    const projectId = options.projectId ?? task.projectId;

    // 1. Task Steps
    const steps = this.taskRepo.listSteps(task.id);
    const completedSteps: string[] = [];
    const remainingSteps: string[] = [];

    for (const step of steps) {
      if (step.status === 'completed') {
        completedSteps.push(`[Step ${step.stepOrder}] ${step.title}`);
      } else {
        remainingSteps.push(`[Step ${step.stepOrder}] ${step.title}`);
      }
    }

    const currentStep =
      options.currentStep ||
      task.currentStep ||
      (remainingSteps.length > 0 ? remainingSteps[0]! : 'Task Finalization');

    // 2. Modified Files & Git State
    let branch = 'main';
    let commitHash = 'head';
    let isDirty = false;
    let diffSummary = '';
    const gitModifiedFiles: string[] = [];
    const gitUntrackedFiles: string[] = [];

    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
    if (isGit) {
      branch = (await this.gitAnalyzer.getCurrentBranch(this.projectRoot)) ?? 'HEAD';
      commitHash = (await this.gitAnalyzer.getCurrentCommit(this.projectRoot)) ?? 'HEAD';
      diffSummary = await this.gitAnalyzer.getDiffSummary(this.projectRoot);
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
      isDirty = changes.modified.length > 0 || changes.added.length > 0 || changes.deleted.length > 0;
      gitModifiedFiles.push(...changes.modified);
      gitUntrackedFiles.push(...changes.added);
    }

    // Combine task-tracked files and git-detected files
    const fileRelations = this.taskRepo.listFiles(task.id);
    const trackedFilePaths = fileRelations.map((fr) => fr.filePath);
    const allModifiedFiles = Array.from(
      new Set([...trackedFilePaths, ...gitModifiedFiles])
    );

    // 3. Modified Symbols
    const symbolRelations = this.taskRepo.listSymbols(task.id);
    const modifiedSymbols = symbolRelations.map((sr) => sr.symbolName);


    // 4. Decisions
    const projectDecisions = this.decisionRepo.listByProject(projectId);
    const relevantDecisions = projectDecisions
      .filter((d) => !d.taskId || d.taskId === task.id)
      .map((d) => `[${d.id}] ${d.title}: ${d.decisionRationale}`);

    // 5. Blockers & Errors
    const taskBlockers = this.taskRepo.listBlockers(task.id).map((b) => b.reason);
    const allBlockers = Array.from(
      new Set([...(options.blockers ?? []), ...taskBlockers])
    );

    const errors = options.errors ?? [];
    const tests = options.tests ?? [];

    // 6. Next Action
    const nextAction =
      options.nextAction ||
      (remainingSteps.length > 0
        ? `Execute ${remainingSteps[0]}`
        : 'Verify test results and complete task');

    // 7. Validation
    const validation: HandoffValidationState = options.validation ?? {
      status: 'pending',
      timestamp: Date.now(),
      lastTestedCommit: commitHash,
    };

    const snapshotData: HandoffSnapshotData = {
      task_id: task.id,
      status: 'handoff',
      goal: task.description || task.title,
      current_step: currentStep,
      completed: completedSteps,
      remaining: remainingSteps,
      modified_files: allModifiedFiles,
      modified_symbols: modifiedSymbols,
      decisions: relevantDecisions,
      blockers: allBlockers,
      errors,
      tests,
      validation,
      git: {
        branch,
        commitHash,
        isDirty,
        diffSummary,
        modifiedFiles: gitModifiedFiles,
        untrackedFiles: gitUntrackedFiles,
      },
      next_action: nextAction,
      created_at: Date.now(),
      agent_identity: options.agentIdentity,
    };

    return snapshotData;
  }

  /**
   * Persists snapshot to canonical `.ai/handoff/CURRENT.json`, task file, and SQLite.
   */
  public async persistSnapshot(
    snapshot: HandoffSnapshotData,
    completedWork = 'In-progress handoff checkpoint'
  ): Promise<string> {
    const handoffDir = path.join(this.projectRoot, '.ai', 'handoff');
    fs.mkdirSync(handoffDir, { recursive: true });

    const jsonContent = JSON.stringify(snapshot, null, 2);

    // 1. Write canonical CURRENT.json
    const currentJsonPath = path.join(handoffDir, 'CURRENT.json');
    fs.writeFileSync(currentJsonPath, jsonContent, 'utf8');

    // 2. Write task-specific json
    const taskJsonPath = path.join(handoffDir, `${snapshot.task_id}.json`);
    fs.writeFileSync(taskJsonPath, jsonContent, 'utf8');

    // 3. Write historical timestamped json
    const timeStr = new Date(snapshot.created_at).toISOString().replace(/[:.]/g, '-');
    const historyPath = path.join(handoffDir, `${timeStr}_${snapshot.task_id}.json`);
    fs.writeFileSync(historyPath, jsonContent, 'utf8');

    // 4. Record to SQLite handoffs repository
    const task = this.taskRepo.findById(snapshot.task_id);
    const projectId = task?.projectId ?? 'default';

    this.handoffRepo.create({
      taskId: snapshot.task_id,
      projectId,
      objective: snapshot.goal,
      completedWork,
      currentStep: snapshot.current_step,
      modifiedFiles: snapshot.modified_files,
      decisions: snapshot.decisions,
      blockers: snapshot.blockers.length > 0 ? snapshot.blockers.join('; ') : undefined,
      errors: snapshot.errors && snapshot.errors.length > 0 ? snapshot.errors.join('; ') : undefined,
      tests: snapshot.tests,
      nextAction: snapshot.next_action,
      gitState: {
        branch: snapshot.git.branch,
        commitHash: snapshot.git.commitHash,
        isDirty: snapshot.git.isDirty,
      },
      agentIdentity: snapshot.agent_identity,
    });

    return currentJsonPath;
  }

  /**
   * Reads `.ai/handoff/CURRENT.json` from disk.
   */
  public readCurrentHandoff(): HandoffSnapshotData | null {
    const currentPath = path.join(this.projectRoot, '.ai', 'handoff', 'CURRENT.json');
    if (!fs.existsSync(currentPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(currentPath, 'utf8');
      return JSON.parse(raw) as HandoffSnapshotData;
    } catch {
      return null;
    }
  }

  /**
   * Reads task-specific handoff file from disk.
   */
  public readTaskHandoff(taskId: string): HandoffSnapshotData | null {
    const taskPath = path.join(this.projectRoot, '.ai', 'handoff', `${taskId}.json`);
    if (!fs.existsSync(taskPath)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(taskPath, 'utf8');
      return JSON.parse(raw) as HandoffSnapshotData;
    } catch {
      return null;
    }
  }
}
