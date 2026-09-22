import { DatabaseSync } from 'node:sqlite';
import {
  HandoffSnapshotData,
  CreateHandoffOptions,
  ResumeTaskOptions,
  TaskResumePack,
  RelevantDecisionItem,
} from '../core/types.js';
import { globalEventBus } from '../core/events.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { HandoffRepository } from '../database/repositories/handoff.repository.js';
import { ContextService } from '../context/context-service.js';
import { HandoffSnapshot } from './handoff-snapshot.js';
import { HandoffValidator } from './handoff-validator.js';

export class HandoffService {
  private readonly taskRepo: TaskRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly snapshot: HandoffSnapshot;
  private readonly validator: HandoffValidator;

  constructor(
    db: DatabaseSync,
    private readonly contextService: ContextService,
    projectRoot: string = process.cwd()
  ) {

    this.taskRepo = new TaskRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.handoffRepo = new HandoffRepository(db);
    this.snapshot = new HandoffSnapshot(db, projectRoot);
    this.validator = new HandoffValidator(projectRoot);
  }

  /**
   * Creates a standardized handoff snapshot, writes to .ai/handoff/CURRENT.json, and records to SQLite.
   */
  public async createHandoff(options: CreateHandoffOptions): Promise<HandoffSnapshotData> {
    const data = await this.snapshot.captureSnapshot(options);
    await this.snapshot.persistSnapshot(data, options.completedWork);

    await globalEventBus.publish('handoff:created', data);
    return data;
  }

  /**
   * Resumes a task from a handoff snapshot, verifying working tree consistency
   * and regenerating optimal context pack for the new agent.
   */
  public async resumeTask(
    taskId?: string,
    options: ResumeTaskOptions = {}
  ): Promise<TaskResumePack> {
    let resolvedTaskId = taskId;

    // If taskId is not provided, read from .ai/handoff/CURRENT.json
    if (!resolvedTaskId) {
      const currentHandoff = this.snapshot.readCurrentHandoff();
      if (!currentHandoff?.task_id) {
        throw new Error(
          'No active handoff found in .ai/handoff/CURRENT.json. Please specify a taskId.'
        );
      }
      resolvedTaskId = currentHandoff.task_id;
    }

    const task = this.taskRepo.findById(resolvedTaskId);
    if (!task) {
      throw new Error(`Task with id '${resolvedTaskId}' not found`);
    }

    // Load or generate snapshot
    let snapshotData =
      this.snapshot.readTaskHandoff(resolvedTaskId) ||
      this.snapshot.readCurrentHandoff();

    if (!snapshotData || snapshotData.task_id !== resolvedTaskId) {
      // Fallback: capture fresh snapshot from DB state
      snapshotData = await this.snapshot.captureSnapshot({
        taskId: resolvedTaskId,
        agentIdentity: options.agentIdentity ?? 'ResumingAgent',
      });
    }

    // 1. Run Consistency Checker
    const consistency = options.skipConsistencyCheck
      ? {
          isConsistent: true,
          validationStale: false,
          gitMismatch: false,
          warnings: [],
          checkedAt: Date.now(),
        }
      : await this.validator.validateConsistency(snapshotData);

    // 2. Generate Context Pack for the resuming agent
    const contextResult = await this.contextService.getContext(
      task.id,
      options.contextBudget ?? 8000
    );

    // 3. Resolve relevant decisions
    const projectDecisions = this.decisionRepo.listByProject(task.projectId);
    const relevantDecisions: RelevantDecisionItem[] = projectDecisions.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      summary: d.context,
      rationale: d.decisionRationale,
    }));

    return {
      task,
      objective: snapshotData.goal || task.description || task.title,
      current_state: task.status,
      current_step: snapshotData.current_step,
      completed_steps: snapshotData.completed,
      remaining_steps: snapshotData.remaining,
      modified_files: snapshotData.modified_files,
      blockers: snapshotData.blockers,
      relevant_decisions: relevantDecisions,
      relevant_context: contextResult,
      next_action: snapshotData.next_action,
      consistency,
      snapshot: snapshotData,
    };
  }

  /**
   * Retrieves the current active handoff from disk if present.
   */
  public getCurrentHandoff(): HandoffSnapshotData | null {
    return this.snapshot.readCurrentHandoff();
  }

  /**
   * Retrieves the latest SQLite handoff record for a task.
   */
  public async getLatestHandoffRecord(taskId: string) {
    return this.handoffRepo.findLatestByTaskId(taskId);
  }
}
