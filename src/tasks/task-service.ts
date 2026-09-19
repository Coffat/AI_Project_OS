import type { DatabaseSync } from 'node:sqlite';
import {
  Task,
  TaskStep,
  TaskBlocker,
  TaskFileRelation,
  TaskSymbolRelation,
  TaskSnapshot,
  TaskPriority,
  DecisionRecord,
  ValidationRunRecord,
  HandoffRecord,
  AuditEvent,
} from '../core/types.js';
import { TaskNotFoundError, ValidationError } from '../core/errors.js';
import { globalEventBus } from '../core/events.js';
import {
  TaskRepository,
  CreateTaskParams,
  UpdateTaskParams,
} from '../database/repositories/task.repository.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { HandoffRepository } from '../database/repositories/handoff.repository.js';
import { ValidationRepository } from '../database/repositories/validation.repository.js';
import { EventRepository } from '../database/repositories/event.repository.js';

export interface CreateTaskInput {
  projectId: string;
  title: string;
  goal?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  parentTaskId?: string;
}

export interface TaskAggregate {
  task: Task;
  steps: TaskStep[];
  files: TaskFileRelation[];
  symbols: TaskSymbolRelation[];
  decisions: DecisionRecord[];
  blockers: TaskBlocker[];
  validationRuns: ValidationRunRecord[];
  handoffHistory: HandoffRecord[];
}

export interface TaskHistory {
  taskId: string;
  events: AuditEvent[];
  snapshots: TaskSnapshot[];
  handoffs: HandoffRecord[];
}

export class TaskService {
  private readonly taskRepo: TaskRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly eventRepo: EventRepository;

  constructor(private readonly db: DatabaseSync) {
    this.taskRepo = new TaskRepository(db);
    this.decisionRepo = new DecisionRepository(db);
    this.handoffRepo = new HandoffRepository(db);
    this.validationRepo = new ValidationRepository(db);
    this.eventRepo = new EventRepository(db);
  }

  public async createTask(input: CreateTaskInput): Promise<Task> {
    const task = this.taskRepo.create({
      projectId: input.projectId,
      title: input.title,
      goal: input.goal,
      description: input.description,
      priority: input.priority,
      assignedAgent: input.assignedAgent,
      parentTaskId: input.parentTaskId,
    } as CreateTaskParams);

    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'task.created',
      aggregateType: 'task',
      aggregateId: task.id,
      payload: { title: task.title, goal: task.goal },
      agentIdentity: input.assignedAgent ?? 'System',
    });

    await globalEventBus.publish('task:created', task);
    return task;
  }

  public async getTask(taskId: string): Promise<TaskAggregate> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const steps = this.taskRepo.listSteps(taskId);
    const files = this.taskRepo.listFiles(taskId);
    const symbols = this.taskRepo.listSymbols(taskId);
    const decisions = this.decisionRepo.listByProject(task.projectId).filter((d) => d.taskId === taskId);
    const blockers = this.taskRepo.listBlockers(taskId);
    const validationRuns = this.validationRepo.listByTask(taskId);
    const handoffHistory = this.handoffRepo.listByTaskId(taskId);

    return {
      task,
      steps,
      files,
      symbols,
      decisions,
      blockers,
      validationRuns,
      handoffHistory,
    };
  }

  public async updateTask(taskId: string, updates: UpdateTaskParams): Promise<Task> {
    const updated = this.taskRepo.update(taskId, updates);
    await globalEventBus.publish('task:updated', updated);
    return updated;
  }

  public async startTask(taskId: string, agentIdentity = 'System'): Promise<Task> {
    const updated = this.taskRepo.transitionStatus(taskId, 'in_progress');

    this.eventRepo.recordEvent({
      projectId: updated.projectId,
      eventType: 'task.started',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity,
    });

    await globalEventBus.publish('task:started', updated);
    return updated;
  }

  public async pauseTask(taskId: string, nextAction: string, agentIdentity = 'System'): Promise<Task> {
    const updated = this.taskRepo.transitionStatus(taskId, 'handoff');

    // Create automatic snapshot when paused
    const snapshot = await this.getTaskSnapshot(taskId, nextAction);
    this.taskRepo.saveSnapshot(taskId, snapshot);

    this.eventRepo.recordEvent({
      projectId: updated.projectId,
      eventType: 'task.paused',
      aggregateType: 'task',
      aggregateId: taskId,
      payload: { nextAction },
      agentIdentity,
    });

    await globalEventBus.publish('task:paused', { task: updated, snapshot });
    return updated;
  }

  public async blockTask(taskId: string, reason: string, agentIdentity = 'System'): Promise<Task> {
    if (!reason || reason.trim() === '') {
      throw new ValidationError('Blocker reason is required when blocking a task');
    }

    const blocker = this.taskRepo.addBlocker(taskId, reason);
    const updated = this.taskRepo.transitionStatus(taskId, 'blocked');

    this.eventRepo.recordEvent({
      projectId: updated.projectId,
      eventType: 'task.blocked',
      aggregateType: 'task',
      aggregateId: taskId,
      payload: { blockerId: blocker.id, reason },
      agentIdentity,
    });

    await globalEventBus.publish('task:blocked', { task: updated, blocker });
    return updated;
  }

  public async resumeTask(taskId: string, agentIdentity = 'System'): Promise<Task> {
    // Transition to resumed, then directly to in_progress
    const current = this.taskRepo.findById(taskId);
    if (!current) throw new TaskNotFoundError(taskId);

    let updated: Task;
    if (current.status === 'blocked' || current.status === 'handoff') {
      const resumed = this.taskRepo.transitionStatus(taskId, 'resumed');
      updated = this.taskRepo.transitionStatus(taskId, 'in_progress');
      await globalEventBus.publish('task:resumed', resumed);
    } else {
      updated = this.taskRepo.transitionStatus(taskId, 'in_progress');
    }

    this.eventRepo.recordEvent({
      projectId: updated.projectId,
      eventType: 'task.resumed',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity,
    });

    await globalEventBus.publish('task:resumed', updated);
    return updated;
  }

  public async completeTask(taskId: string, agentIdentity = 'System'): Promise<Task> {
    const current = this.taskRepo.findById(taskId);
    if (!current) throw new TaskNotFoundError(taskId);

    // Check unresolved blockers
    const unresolved = this.taskRepo.listBlockers(taskId, true);
    if (unresolved.length > 0) {
      throw new ValidationError(
        `Cannot complete task ${taskId}: has ${unresolved.length} unresolved blocker(s).`
      );
    }

    let updated: Task;
    if (current.status === 'in_progress') {
      // Valid transition in_progress -> testing -> done
      this.taskRepo.transitionStatus(taskId, 'testing');
      updated = this.taskRepo.transitionStatus(taskId, 'done');
    } else if (current.status === 'testing') {
      updated = this.taskRepo.transitionStatus(taskId, 'done');
    } else {
      throw new ValidationError(`Cannot complete task from '${current.status}' status directly.`);
    }

    // Capture final snapshot
    const finalSnapshot = await this.getTaskSnapshot(taskId, 'Task successfully completed and verified.');
    this.taskRepo.saveSnapshot(taskId, finalSnapshot);

    this.eventRepo.recordEvent({
      projectId: updated.projectId,
      eventType: 'task.completed',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity,
    });

    await globalEventBus.publish('task:completed', updated);
    return updated;
  }

  public async addStep(taskId: string, title: string, stepOrder?: number): Promise<TaskStep> {
    const steps = this.taskRepo.listSteps(taskId);
    const order = stepOrder ?? steps.length + 1;
    const step = this.taskRepo.addStep(taskId, title, order);

    const task = this.taskRepo.findById(taskId);
    if (task && !task.currentStep) {
      this.taskRepo.update(taskId, { currentStep: step.title });
    }

    return step;
  }

  public async completeStep(stepId: string, resultSummary?: string): Promise<TaskStep> {
    const step = this.taskRepo.updateStepStatus(stepId, 'completed', resultSummary);

    // Advance currentStep on task to next pending step
    const steps = this.taskRepo.listSteps(step.taskId);
    const nextPending = steps.find((s) => s.status === 'pending');
    this.taskRepo.update(step.taskId, {
      currentStep: nextPending ? nextPending.title : 'All steps completed',
    });

    return step;
  }

  public async addBlocker(taskId: string, reason: string): Promise<TaskBlocker> {
    const blocker = this.taskRepo.addBlocker(taskId, reason);
    await globalEventBus.publish('task:blocker_added', blocker);
    return blocker;
  }

  public async removeBlocker(blockerId: string): Promise<TaskBlocker> {
    const blocker = this.taskRepo.resolveBlocker(blockerId);
    await globalEventBus.publish('task:blocker_resolved', blocker);
    return blocker;
  }

  public async attachFile(
    taskId: string,
    filePath: string,
    relationType: 'created' | 'modified' | 'referenced' = 'modified'
  ): Promise<TaskFileRelation> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return this.taskRepo.attachFile(taskId, filePath, relationType);
  }

  public async attachDecision(taskId: string, decisionId: string): Promise<DecisionRecord> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const decision = this.decisionRepo.findById(decisionId);
    if (!decision) throw new ValidationError(`Decision not found: ${decisionId}`);

    this.db.prepare('UPDATE decisions SET task_id = ? WHERE id = ?').run(taskId, decisionId);
    return { ...decision, taskId };
  }

  public async attachSymbol(taskId: string, symbolName: string, symbolId?: string): Promise<TaskSymbolRelation> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return this.taskRepo.attachSymbol(taskId, symbolName, symbolId);
  }

  public async getTaskSnapshot(taskId: string, nextAction = 'Continue execution'): Promise<TaskSnapshot> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const steps = this.taskRepo.listSteps(taskId);
    const files = this.taskRepo.listFiles(taskId);
    const symbols = this.taskRepo.listSymbols(taskId);
    const decisions = this.decisionRepo.listByProject(task.projectId).filter((d) => d.taskId === taskId);
    const unresolvedBlockers = this.taskRepo.listBlockers(taskId, true);

    const completedSteps = steps.filter((s) => s.status === 'completed').map((s) => s.title);
    const remainingSteps = steps.filter((s) => s.status !== 'completed').map((s) => s.title);

    const snapshot: TaskSnapshot = {
      taskId: task.id,
      taskTitle: task.title,
      goal: task.goal ?? task.title,
      status: task.status,
      currentStep: task.currentStep ?? (remainingSteps.length > 0 ? remainingSteps[0] : 'None'),
      completedSteps,
      remainingSteps,
      files: files.map((f) => f.filePath),
      symbols: symbols.map((s) => s.symbolName),
      decisions: decisions.map((d) => `[${d.status.toUpperCase()}] ${d.title}`),
      blockers: unresolvedBlockers.map((b) => b.reason),
      nextAction,
      timestamp: Date.now(),
    };

    return snapshot;
  }

  public async getTaskHistory(taskId: string): Promise<TaskHistory> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new TaskNotFoundError(taskId);

    const events = this.eventRepo.listByAggregate('task', taskId);
    const snapshots = this.taskRepo.listSnapshots(taskId);
    const handoffs = this.handoffRepo.listByTaskId(taskId);

    return {
      taskId,
      events,
      snapshots,
      handoffs,
    };
  }
}
