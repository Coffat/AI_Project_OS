import type { DatabaseSync } from 'node:sqlite';
import {
  ContextPack,
  HandoffRecord,
  Task,
} from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import {
  TaskRepository,
  HandoffRepository,
  EventRepository,
} from '../database/repositories/index.js';
import { ContextService } from '../context/context-service.js';
import { GraphService } from '../graph/graph-service.js';
import {
  AgentAdapter,
  AgentAdapterState,
  AgentPromptPayload,
  SaveHandoffParams,
} from './types.js';
import { BaseAgentAdapter } from './adapter.js';

export interface AgentLifecycleManagerDependencies {
  db: DatabaseSync;
  projectRoot?: string;
  taskRepo?: TaskRepository;
  handoffRepo?: HandoffRepository;
  eventRepo?: EventRepository;
  contextService?: ContextService;
}

export interface StartLifecycleResult {
  state: AgentAdapterState;
  task: Task;
  context: ContextPack;
  promptPayload?: AgentPromptPayload;
}

export interface ResumeLifecycleResult {
  state: AgentAdapterState;
  task: Task;
  handoff: HandoffRecord;
  context: ContextPack;
  promptPayload?: AgentPromptPayload;
}

export interface StartLifecycleOptions {
  tokenBudget?: number;
}

export interface ResumeLifecycleOptions {
  handoffId?: string;
  tokenBudget?: number;
}

export interface SaveHandoffOptions {
  transitionTaskToHandoff?: boolean;
}

export interface CompleteTaskOptions {
  finalNotes?: string;
}

/**
 * AgentLifecycleManager orchestrates the provider-agnostic lifecycle:
 *
 * 1. Start:
 *    Project OS → Task → Context → Agent
 *
 * 2. Stop / Handoff:
 *    Agent → Handoff → Project OS
 *
 * 3. Resume:
 *    Project OS → Task → Handoff → Context → Agent
 *
 * Maintains the strict separation between Project OS domain state and
 * external AI agent providers.
 */
export class AgentLifecycleManager {
  private readonly db: DatabaseSync;
  private readonly projectRoot: string;
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly eventRepo: EventRepository;
  private readonly contextService: ContextService;

  constructor(deps: AgentLifecycleManagerDependencies) {
    this.db = deps.db;
    this.projectRoot = deps.projectRoot ?? process.cwd();

    this.taskRepo = deps.taskRepo ?? new TaskRepository(this.db);
    this.handoffRepo = deps.handoffRepo ?? new HandoffRepository(this.db);
    this.eventRepo = deps.eventRepo ?? new EventRepository(this.db);

    if (deps.contextService) {
      this.contextService = deps.contextService;
    } else {
      const graphService = new GraphService(this.db);
      this.contextService = new ContextService(this.db, graphService, this.projectRoot);
    }
  }

  /**
   * 1. Start Task Flow:
   * Project OS → Task → Context → Agent
   */
  public async startTask(
    adapter: AgentAdapter,
    taskId: string,
    options?: StartLifecycleOptions
  ): Promise<StartLifecycleResult> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    // Advance task to in_progress if still planned
    if (task.status === 'planned') {
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    }

    // Assign agent identity metadata
    this.taskRepo.update(taskId, {
      assignedAgent: adapter.identity.agentName,
    });

    const activeTask = this.taskRepo.findById(taskId)!;

    // Build targeted context pack
    const context = await this.contextService.buildContextPack(
      activeTask,
      options?.tokenBudget ?? 8000
    );

    // Wire automatic handoff saving hook on adapter if supported
    if (adapter instanceof BaseAgentAdapter) {
      adapter.setHandoffHandler((params) => this.saveHandoff(adapter, params));
    }

    // Start adapter and send context envelope
    const state = await adapter.start({
      taskId,
      initialContext: context,
    });

    const promptPayload = await adapter.sendContext({
      taskId,
      context,
    });

    // Record immutable audit event
    this.eventRepo.recordEvent({
      projectId: activeTask.projectId,
      eventType: 'AGENT_TASK_STARTED',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity: adapter.identity.agentName,
      payload: {
        provider: adapter.identity.provider,
        sessionId: adapter.identity.sessionId,
        accountLabel: adapter.identity.accountLabel,
        estimatedTokens: context.estimatedTokens,
      },
    });

    return {
      state,
      task: activeTask,
      context,
      promptPayload: promptPayload ?? undefined,
    };
  }

  /**
   * 2. Save Handoff Flow:
   * Agent → Handoff → Project OS
   */
  public async saveHandoff(
    adapter: AgentAdapter,
    params: SaveHandoffParams,
    options?: SaveHandoffOptions
  ): Promise<HandoffRecord> {
    const task = this.taskRepo.findById(params.taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${params.taskId}`);
    }

    // Persist handoff in Project OS canonical repository
    const record = this.handoffRepo.create({
      taskId: params.taskId,
      projectId: task.projectId,
      objective: params.objective,
      completedWork: params.completedWork,
      currentFile: params.currentFile,
      modifiedFiles: params.modifiedFiles,
      decisions: params.decisions,
      blockers: params.blockers,
      tests: params.tests,
      nextAction: params.nextAction,
      agentIdentity: adapter.identity.agentName,
    });

    // Transition task status to handoff if requested
    const shouldTransition = options?.transitionTaskToHandoff ?? true;
    if (shouldTransition && task.status === 'in_progress') {
      this.taskRepo.transitionStatus(params.taskId, 'handoff');
    }

    // Record audit event
    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'AGENT_HANDOFF_SAVED',
      aggregateType: 'handoff',
      aggregateId: record.id,
      agentIdentity: adapter.identity.agentName,
      payload: {
        taskId: params.taskId,
        provider: adapter.identity.provider,
        nextAction: params.nextAction,
        modifiedFiles: params.modifiedFiles ?? [],
      },
    });

    return record;
  }

  /**
   * 3. Resume Task Flow:
   * Project OS → Task → Handoff → Context → Agent
   */
  public async resumeTask(
    adapter: AgentAdapter,
    taskId: string,
    options?: ResumeLifecycleOptions
  ): Promise<ResumeLifecycleResult> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    // Retrieve previous handoff
    const handoff = options?.handoffId
      ? this.handoffRepo.findById(options.handoffId)
      : this.handoffRepo.findLatestByTaskId(taskId);

    if (!handoff) {
      throw new ValidationError(`No handoff found to resume task: ${taskId}`);
    }

    // Transition state: handoff -> resumed -> in_progress
    if (task.status === 'handoff') {
      this.taskRepo.transitionStatus(taskId, 'resumed');
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    } else if (task.status === 'resumed') {
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    }

    // Reassign to current agent
    this.taskRepo.update(taskId, {
      assignedAgent: adapter.identity.agentName,
    });

    const activeTask = this.taskRepo.findById(taskId)!;

    // Refresh context pack including previous handoff
    const context = await this.contextService.buildContextPack(
      activeTask,
      options?.tokenBudget ?? 8000
    );
    context.recentHandoff = handoff;

    // Wire automatic handoff saving hook on adapter if supported
    if (adapter instanceof BaseAgentAdapter) {
      adapter.setHandoffHandler((params) => this.saveHandoff(adapter, params));
    }

    // Resume adapter
    const state = await adapter.resumeTask({
      taskId,
      handoffId: handoff.id,
      context,
    });

    const promptPayload = await adapter.sendContext({
      taskId,
      context,
    });

    // Record audit event
    this.eventRepo.recordEvent({
      projectId: activeTask.projectId,
      eventType: 'AGENT_TASK_RESUMED',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity: adapter.identity.agentName,
      payload: {
        provider: adapter.identity.provider,
        resumedFromHandoffId: handoff.id,
        previousAgent: handoff.agentIdentity,
        currentAgent: adapter.identity.agentName,
      },
    });

    return {
      state,
      task: activeTask,
      handoff,
      context,
      promptPayload: promptPayload ?? undefined,
    };
  }

  /**
   * Completes task and notifies adapter.
   */
  public async completeTask(
    adapter: AgentAdapter,
    taskId: string,
    options?: CompleteTaskOptions
  ): Promise<Task> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    if (task.status === 'in_progress') {
      this.taskRepo.transitionStatus(taskId, 'done');
    } else if (task.status !== 'done') {
      this.taskRepo.transitionStatus(taskId, 'in_progress');
      this.taskRepo.transitionStatus(taskId, 'done');
    }

    const updatedTask = this.taskRepo.findById(taskId)!;

    this.eventRepo.recordEvent({
      projectId: updatedTask.projectId,
      eventType: 'AGENT_TASK_COMPLETED',
      aggregateType: 'task',
      aggregateId: taskId,
      agentIdentity: adapter.identity.agentName,
      payload: {
        provider: adapter.identity.provider,
        finalNotes: options?.finalNotes,
      },
    });

    if (adapter.stop) {
      await adapter.stop();
    }

    return updatedTask;
  }

  /**
   * Stop an active agent adapter.
   */
  public async stopAgent(adapter: AgentAdapter): Promise<AgentAdapterState> {
    if (adapter.stop) {
      return adapter.stop();
    }
    return adapter.getStatus();
  }
}
