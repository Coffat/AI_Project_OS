import { DatabaseSync } from 'node:sqlite';
import {
  ContextPack,
  HandoffGitState,
  Task,
  TaskValidationResult,
} from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  EventRepository,
  ValidationRepository,
  ExecutionSessionRepository,
  DecisionRepository,
} from '../database/repositories/index.js';
import { ContextService } from '../context/context-service.js';
import { GraphService } from '../graph/graph-service.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { ValidationService } from '../validation/validation-service.js';
import { MemoryCompiler } from '../memory/memory-compiler.js';
import { SessionManager } from '../sessions/session-manager.js';
import { SessionContinuityChecker } from '../sessions/session-continuity-checker.js';
import { HandoffSnapshot } from '../handoff/handoff-snapshot.js';
import { AgentAdapter, BaseAgentAdapter } from '../agents/index.js';
import {
  AgentSessionPackage,
  CompleteTaskParams,
  CompleteTaskResult,
  HandoffTaskParams,
  HandoffTaskResult,
  PrepareContextOptions,
  ProgressRecordResult,
  RecordProgressParams,
  ResumeOrchestratorTaskParams,
  StartAgentSessionOptions,
  StartOrchestratorTaskParams,
  TaskContinuationPackage,
  TaskExecutionPackage,
  ValidateOrchestratorTaskOptions,
} from './types.js';

export interface ProjectOrchestratorDependencies {
  db: DatabaseSync;
  projectRoot?: string;
  projectId?: string;
  taskRepo?: TaskRepository;
  projectRepo?: ProjectRepository;
  handoffRepo?: HandoffRepository;
  eventRepo?: EventRepository;
  validationRepo?: ValidationRepository;
  sessionRepo?: ExecutionSessionRepository;
  decisionRepo?: DecisionRepository;
  contextService?: ContextService;
  gitAnalyzer?: GitAnalyzer;
  validationService?: ValidationService;
  memoryCompiler?: MemoryCompiler;
  sessionManager?: SessionManager;
  continuityChecker?: SessionContinuityChecker;
}

/**
 * ProjectOrchestrator
 *
 * Master orchestrator unifying the entire AI PROJECT OS lifecycle:
 *
 * USER TASK
 *    ↓
 * Task Engine
 *    ↓
 * Context Engine
 *    ↓
 * Agent Adapter
 *    ↓
 * AI CODING AGENT
 *    ↓
 * CODE CHANGES (Single Working Tree)
 *    ↓
 * Validation Engine
 *    ↓
 * Git Analysis
 *    ↓
 * Code Intelligence
 *    ↓
 * Graph Update
 *    ↓
 * Incremental Memory Compiler
 *    ↓
 * Task Update
 *    ↓
 * Handoff / Resume / Complete
 */
export class ProjectOrchestrator {
  private readonly db: DatabaseSync;
  private readonly projectRoot: string;
  private readonly defaultProjectId: string;

  private readonly projectRepo: ProjectRepository;
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly eventRepo: EventRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly sessionRepo: ExecutionSessionRepository;
  private readonly decisionRepo: DecisionRepository;

  private readonly contextService: ContextService;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly validationService: ValidationService;
  private readonly memoryCompiler: MemoryCompiler;
  private readonly sessionManager: SessionManager;
  private readonly continuityChecker: SessionContinuityChecker;
  private readonly handoffSnapshot: HandoffSnapshot;

  constructor(deps: ProjectOrchestratorDependencies) {
    this.db = deps.db;
    this.projectRoot = deps.projectRoot ?? process.cwd();
    this.defaultProjectId = deps.projectId ?? 'default-project';

    this.projectRepo = deps.projectRepo ?? new ProjectRepository(this.db);
    this.taskRepo = deps.taskRepo ?? new TaskRepository(this.db);
    this.handoffRepo = deps.handoffRepo ?? new HandoffRepository(this.db);
    this.eventRepo = deps.eventRepo ?? new EventRepository(this.db);
    this.validationRepo = deps.validationRepo ?? new ValidationRepository(this.db);
    this.sessionRepo = deps.sessionRepo ?? new ExecutionSessionRepository(this.db);
    this.decisionRepo = deps.decisionRepo ?? new DecisionRepository(this.db);

    this.gitAnalyzer = deps.gitAnalyzer ?? new GitAnalyzer();
    this.memoryCompiler = deps.memoryCompiler ?? new MemoryCompiler(this.db);
    this.validationService =
      deps.validationService ?? new ValidationService(this.db, this.projectRoot);
    this.continuityChecker =
      deps.continuityChecker ??
      new SessionContinuityChecker(this.db, this.projectRoot);
    this.handoffSnapshot = new HandoffSnapshot(this.db, this.projectRoot);

    if (deps.contextService) {
      this.contextService = deps.contextService;
    } else {
      const graphService = new GraphService(this.db);
      this.contextService = new ContextService(this.db, graphService, this.projectRoot);
    }

    this.sessionManager =
      deps.sessionManager ??
      new SessionManager(
        {
          db: this.db,
          projectRoot: this.projectRoot,
          sessionRepo: this.sessionRepo,
          taskRepo: this.taskRepo,
          handoffRepo: this.handoffRepo,
          eventRepo: this.eventRepo,
          contextService: this.contextService,
          continuityChecker: this.continuityChecker,
        },
        this.projectRoot
      );
  }

  // ---------------------------------------------------------------------------
  // 1. startTask
  // ---------------------------------------------------------------------------
  /**
   * Starts a new or existing task:
   * - Creates/loads task
   * - Advances status to in_progress
   * - Inspects git
   * - Builds context pack
   * - Creates session
   * - Returns agent-ready context package
   */
  public async startTask(
    params: StartOrchestratorTaskParams
  ): Promise<TaskExecutionPackage> {
    let projectId = params.projectId ?? this.defaultProjectId;
    if (!params.taskId) {
      const project = this.projectRepo.findById(projectId);
      if (!project) {
        const first = this.projectRepo.list()[0];
        if (first) {
          projectId = first.id;
        }
      }
    }

    let task: Task;
    if (params.taskId) {
      const existing = this.taskRepo.findById(params.taskId);
      if (!existing) {
        throw new ValidationError(`Task not found: ${params.taskId}`);
      }
      task = existing;
    } else {
      task = this.taskRepo.create({
        projectId,
        title: params.title ?? 'New Orchestrated Task',
        goal: params.goal,
        priority: params.priority ?? 'medium',
      });
    }

    if (task.status === 'planned') {
      this.taskRepo.transitionStatus(task.id, 'in_progress');
    }

    const assignedAgent = params.agent ?? params.adapter?.agentName ?? 'Agent';
    this.taskRepo.update(task.id, {
      assignedAgent,
    });

    const activeTask = this.taskRepo.findById(task.id)!;

    // Inspect Git State
    const gitState = await this.captureGitState();

    // Check Continuity
    const continuity = await this.continuityChecker.checkContinuity(activeTask.id);

    // Build Context Pack
    const context = await this.prepareContext(activeTask.id, {
      tokenBudget: params.tokenBudget,
    });

    // Create Execution Session
    const sessionResult = await this.sessionManager.startSession(activeTask.id, {
      provider: params.provider ?? params.adapter?.identity.provider ?? 'antigravity',
      agent: assignedAgent,
      accountLabel: params.accountLabel,
      metadata: params.metadata,
      tokenBudget: params.tokenBudget,
    });

    let promptPayload;
    if (params.adapter) {
      if (params.adapter instanceof BaseAgentAdapter) {
        params.adapter.setHandoffHandler((p) =>
          this.handoffTask({
            taskId: activeTask.id,
            completedWork: p.completedWork,
            nextAction: p.nextAction,
            objective: p.objective,
            blockers: p.blockers,
            modifiedFiles: p.modifiedFiles,
            decisions: p.decisions,
            tests: p.tests,
            currentFile: p.currentFile,
          }).then((r) => r.handoff)
        );
      }
      await params.adapter.start({ taskId: activeTask.id, initialContext: context });
      const sent = await params.adapter.sendContext({ taskId: activeTask.id, context });
      if (sent) promptPayload = sent;
    }

    return {
      task: activeTask,
      session: sessionResult.session,
      context,
      gitState,
      continuity,
      recommendedNextAction: continuity.recommendedNextAction,
      promptPayload,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. prepareContext
  // ---------------------------------------------------------------------------
  /**
   * Generates a budget-constrained context pack for a task.
   */
  public async prepareContext(
    taskId: string,
    options?: PrepareContextOptions
  ): Promise<ContextPack> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    const context = await this.contextService.buildContextPack(
      task,
      options?.tokenBudget ?? 8000
    );

    const latestHandoff = this.handoffRepo.findLatestByTaskId(taskId);
    if (latestHandoff) {
      context.recentHandoff = latestHandoff;
    }

    return context;
  }

  // ---------------------------------------------------------------------------
  // 3. startAgentSession
  // ---------------------------------------------------------------------------
  /**
   * Connects an AgentAdapter to an active task and session.
   */
  public async startAgentSession(
    taskId: string,
    adapter: AgentAdapter,
    options?: StartAgentSessionOptions
  ): Promise<AgentSessionPackage> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    const context = await this.prepareContext(taskId, {
      tokenBudget: options?.tokenBudget,
    });

    const session = this.sessionRepo.createSession({
      projectId: task.projectId,
      taskId: task.id,
      provider: options?.provider ?? adapter.identity.provider,
      agent: adapter.agentName,
      accountLabel: options?.accountLabel,
      startedAt: Date.now(),
      status: 'active',
    });

    if (adapter instanceof BaseAgentAdapter) {
      adapter.setHandoffHandler((p) =>
        this.handoffTask({
          taskId: task.id,
          completedWork: p.completedWork,
          nextAction: p.nextAction,
          objective: p.objective,
          blockers: p.blockers,
          modifiedFiles: p.modifiedFiles,
          decisions: p.decisions,
          tests: p.tests,
          currentFile: p.currentFile,
        }).then((r) => r.handoff)
      );
    }

    await adapter.start({ taskId: task.id, initialContext: context });
    const promptPayload = await adapter.sendContext({ taskId: task.id, context });

    return {
      session,
      task,
      context,
      promptPayload:
        promptPayload ??
        (adapter instanceof BaseAgentAdapter
          ? adapter.formatContextEnvelope(context)
          : { systemPrompt: '', userPrompt: `Execute task [${task.id}] ${task.title}` }),
    };
  }

  // ---------------------------------------------------------------------------
  // 4. recordProgress
  // ---------------------------------------------------------------------------
  /**
   * Records step updates, architectural decisions, and blocker notes.
   */
  public async recordProgress(
    params: RecordProgressParams
  ): Promise<ProgressRecordResult> {
    const task = this.taskRepo.findById(params.taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${params.taskId}`);
    }

    let completedStepId: string | undefined;
    let addedStepId: string | undefined;
    let recordedDecisionId: string | undefined;

    // 1. Complete Step
    if (params.completeStep) {
      const steps = this.taskRepo.listSteps(task.id);
      let targetStep = steps.find((s) => s.id === params.stepId);
      if (!targetStep && params.stepOrder !== undefined) {
        targetStep = steps.find((s) => s.stepOrder === params.stepOrder);
      }
      if (targetStep) {
        this.taskRepo.updateStepStatus(targetStep.id, 'completed');
        completedStepId = targetStep.id;
      }
    }

    // 2. Add Step
    if (params.addStep) {
      const step = this.taskRepo.addStep(
        task.id,
        params.addStep.title,
        params.addStep.stepOrder ?? 1
      );
      addedStepId = step.id;
    }

    // 3. Record Decision
    if (params.decision) {
      const dec = this.decisionRepo.create({
        projectId: task.projectId,
        taskId: task.id,
        title: params.decision.title,
        context: `Decision made during execution of task ${task.id}`,
        decisionRationale: params.decision.rationale,
        status: params.decision.status ?? 'accepted',
      });
      recordedDecisionId = dec.id;
    }

    // 4. Record Blocker
    if (params.blocker) {
      this.taskRepo.update(task.id, {
        description: `${task.description ?? ''}\n[BLOCKER]: ${params.blocker}`.trim(),
      });
    }

    const updatedTask = this.taskRepo.findById(task.id)!;

    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'TASK_PROGRESS_RECORDED',
      aggregateType: 'task',
      aggregateId: task.id,
      agentIdentity: params.agentIdentity ?? task.assignedAgent ?? 'Agent',
      payload: {
        completedStepId,
        addedStepId,
        recordedDecisionId,
        blocker: params.blocker,
      },
    });

    return {
      task: updatedTask,
      completedStepId,
      addedStepId,
      recordedDecisionId,
      recordedBlocker: params.blocker,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. validateTask
  // ---------------------------------------------------------------------------
  /**
   * Invokes the deterministic validation engine (tests, typecheck, lint, git diff).
   */
  public async validateTask(
    taskId: string,
    options?: ValidateOrchestratorTaskOptions
  ): Promise<TaskValidationResult> {
    return this.validationService.validateTask(taskId, {
      skipLint: options?.skipLint,
      skipTypecheck: options?.skipTypecheck,
      skipBuild: options?.skipBuild,
      skipArchitectureGuard: options?.skipArchitectureGuard,
      strictGuard: options?.strictGuard,
      testCommand: options?.testCommand,
      typecheckCommand: options?.typecheckCommand,
      lintCommand: options?.lintCommand,
      agentIdentity: options?.agentIdentity,
      autoCompleteOnPass: options?.autoCompleteOnPass ?? false,
    });
  }

  // ---------------------------------------------------------------------------
  // 6. handoffTask
  // ---------------------------------------------------------------------------
  /**
   * Executes a standard task handover:
   * - Inspects git, task, validation
   * - Saves snapshot to disk (.ai/handoff/CURRENT.json)
   * - Generates handoff in SQLite
   * - Compiles incremental memory
   * - Closes active session
   */
  public async handoffTask(params: HandoffTaskParams): Promise<HandoffTaskResult> {
    const task = this.taskRepo.findById(params.taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${params.taskId}`);
    }

    // 1. Inspect Git
    const gitState = await this.captureGitState();

    // 2. Inspect Validation History
    const valRuns = this.validationRepo.listByTask(task.id);
    const latestVal = valRuns.length > 0 ? valRuns[0] : undefined;

    // 3. Resolve active session
    let session = params.sessionId ? this.sessionRepo.findById(params.sessionId) : null;
    if (!session) {
      session = this.sessionRepo.findActiveByTask(task.id);
    }
    if (!session) {
      session = this.sessionRepo.createSession({
        projectId: task.projectId,
        taskId: task.id,
        provider: 'antigravity',
        agent: task.assignedAgent ?? 'Agent',
        status: 'active',
      });
    }

    // 4. Capture & persist snapshot to disk
    const snapshotData = await this.handoffSnapshot.captureSnapshot({
      taskId: task.id,
      projectId: task.projectId,
      agentIdentity: session.agent,
      completedWork: params.completedWork,
      currentStep: params.currentFile,
      blockers: params.blockers ? [params.blockers] : undefined,
      tests: params.tests,
      nextAction: params.nextAction,
      validation: latestVal
        ? {
            status: latestVal.status as 'passed' | 'failed' | 'pending',
            timestamp: latestVal.finishedAt ?? Date.now(),
            lastTestedCommit: gitState.commitHash,
          }
        : undefined,
    });
    await this.handoffSnapshot.persistSnapshot(snapshotData, params.completedWork);

    // 5. Persist handoff record in SQLite
    const handoff = this.handoffRepo.create({
      taskId: task.id,
      projectId: task.projectId,
      objective: params.objective || task.goal || task.title,
      completedWork: params.completedWork,
      currentFile: params.currentFile,
      modifiedFiles: params.modifiedFiles ?? snapshotData.modified_files,
      decisions: params.decisions ?? snapshotData.decisions,
      blockers: params.blockers,
      tests: params.tests ?? snapshotData.tests,
      nextAction: params.nextAction,
      gitState,
      agentIdentity: session.agent,
    });

    // 6. Compile Incremental Memory
    let memoryResult;
    try {
      memoryResult = await this.memoryCompiler.compileChanges(
        this.projectRoot,
        task.projectId
      );
    } catch {
      // Memory compilation non-blocking for handoff
    }

    // 7. Update Session State
    const targetStatus = params.status ?? 'handoff';
    const updatedSession = this.sessionRepo.updateStatus(
      session.id,
      targetStatus,
      Date.now()
    );

    // 8. Update Task State
    const currentTask = this.taskRepo.findById(task.id)!;
    if (currentTask.status === 'testing') {
      this.taskRepo.transitionStatus(currentTask.id, 'in_progress');
      this.taskRepo.transitionStatus(currentTask.id, 'handoff');
    } else if (currentTask.status === 'in_progress') {
      this.taskRepo.transitionStatus(currentTask.id, 'handoff');
    }
    const updatedTask = this.taskRepo.findById(task.id)!;

    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'AGENT_HANDOFF_COMPLETED',
      aggregateType: 'handoff',
      aggregateId: handoff.id,
      agentIdentity: session.agent,
      payload: {
        taskId: task.id,
        sessionId: session.id,
        nextAction: params.nextAction,
      },
    });

    return {
      handoff,
      snapshot: snapshotData,
      session: updatedSession,
      task: updatedTask,
      memoryResult,
      nextAction: params.nextAction,
    };
  }

  // ---------------------------------------------------------------------------
  // 7. resumeTask
  // ---------------------------------------------------------------------------
  /**
   * Resumes a task from a previous handoff:
   * - Loads task & handoff
   * - Verifies git state & detects mismatches
   * - Retrieves context pack with predecessor handoff
   * - Creates new session
   * - Returns continuation package
   */
  public async resumeTask(
    params: ResumeOrchestratorTaskParams
  ): Promise<TaskContinuationPackage> {
    const task = this.taskRepo.findById(params.taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${params.taskId}`);
    }

    const handoff = params.handoffId
      ? this.handoffRepo.findById(params.handoffId)
      : this.handoffRepo.findLatestByTaskId(task.id);

    if (!handoff) {
      throw new ValidationError(`No handoff found to resume task: ${params.taskId}`);
    }

    // Verify git state & continuity
    const continuity = await this.continuityChecker.checkContinuity(task.id, handoff.id);

    // State transition: handoff -> resumed -> in_progress
    if (task.status === 'handoff') {
      this.taskRepo.transitionStatus(task.id, 'resumed');
      this.taskRepo.transitionStatus(task.id, 'in_progress');
    } else if (task.status === 'resumed') {
      this.taskRepo.transitionStatus(task.id, 'in_progress');
    }

    const assignedAgent = params.agent ?? params.adapter?.agentName ?? 'Agent';
    this.taskRepo.update(task.id, {
      assignedAgent,
    });

    const activeTask = this.taskRepo.findById(task.id)!;

    // Refresh context pack
    const context = await this.prepareContext(activeTask.id, {
      tokenBudget: params.tokenBudget,
    });
    context.recentHandoff = handoff;

    // Create fresh session for resuming agent
    const session = this.sessionRepo.createSession({
      projectId: activeTask.projectId,
      taskId: activeTask.id,
      provider: params.provider ?? params.adapter?.identity.provider ?? 'antigravity',
      agent: assignedAgent,
      accountLabel: params.accountLabel,
      startedAt: Date.now(),
      status: 'active',
    });

    let promptPayload;
    if (params.adapter) {
      if (params.adapter instanceof BaseAgentAdapter) {
        params.adapter.setHandoffHandler((p) =>
          this.handoffTask({
            taskId: activeTask.id,
            completedWork: p.completedWork,
            nextAction: p.nextAction,
            objective: p.objective,
            blockers: p.blockers,
            modifiedFiles: p.modifiedFiles,
            decisions: p.decisions,
            tests: p.tests,
            currentFile: p.currentFile,
          }).then((r) => r.handoff)
        );
      }
      await params.adapter.resumeTask({ taskId: activeTask.id, handoffId: handoff.id, context });
      const sent = await params.adapter.sendContext({ taskId: activeTask.id, context });
      if (sent) promptPayload = sent;
    }

    this.eventRepo.recordEvent({
      projectId: activeTask.projectId,
      eventType: 'TASK_RESUMED',
      aggregateType: 'task',
      aggregateId: activeTask.id,
      agentIdentity: session.agent,
      payload: {
        sessionId: session.id,
        resumedFromHandoffId: handoff.id,
        previousAgent: handoff.agentIdentity,
      },
    });

    return {
      task: activeTask,
      session,
      handoff,
      context,
      continuity,
      nextAction: continuity.recommendedNextAction,
      promptPayload,
    };
  }

  // ---------------------------------------------------------------------------
  // 8. completeTask
  // ---------------------------------------------------------------------------
  /**
   * Finalizes task execution:
   * - Runs validation
   * - Inspects git diff
   * - Updates graph & compiles incremental memory
   * - Transitions task status to 'done'
   * - Saves final snapshot
   * - Closes active session
   */
  public async completeTask(
    params: CompleteTaskParams
  ): Promise<CompleteTaskResult> {
    const task = this.taskRepo.findById(params.taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${params.taskId}`);
    }

    // 1. Validation
    let validation: TaskValidationResult | undefined;
    if (!params.skipValidation) {
      validation = await this.validateTask(task.id, params.validationOptions);
    }

    // 2. Inspect Git diff
    const gitDiffSummary = await this.gitAnalyzer.getDiffSummary(this.projectRoot);

    // 3. Compile memory & update graph
    let memoryResult;
    try {
      memoryResult = await this.memoryCompiler.compileChanges(
        this.projectRoot,
        task.projectId
      );
    } catch {
      // Memory compilation non-blocking
    }

    // 4. Resolve session and close
    let session = params.sessionId ? this.sessionRepo.findById(params.sessionId) : null;
    if (!session) {
      session = this.sessionRepo.findActiveByTask(task.id);
    }
    if (session) {
      session = this.sessionRepo.updateStatus(session.id, 'ended', Date.now());
    } else {
      session = this.sessionRepo.createSession({
        projectId: task.projectId,
        taskId: task.id,
        provider: 'antigravity',
        agent: task.assignedAgent ?? 'Agent',
        status: 'ended',
        startedAt: Date.now(),
      });
    }

    // 5. Save final snapshot to disk
    try {
      const finalSnapshot = await this.handoffSnapshot.captureSnapshot({
        taskId: task.id,
        projectId: task.projectId,
        agentIdentity: session.agent,
        completedWork: params.finalNotes || 'Task completed successfully',
        nextAction: 'None (Task completed)',
      });
      await this.handoffSnapshot.persistSnapshot(finalSnapshot, params.finalNotes || 'Task completed');
    } catch {
      // Snapshot non-blocking
    }

    // 6. Transition task status to 'done'
    if (task.status === 'in_progress') {
      this.taskRepo.transitionStatus(task.id, 'done');
    } else if (task.status !== 'done') {
      this.taskRepo.transitionStatus(task.id, 'in_progress');
      this.taskRepo.transitionStatus(task.id, 'done');
    }

    const updatedTask = this.taskRepo.findById(task.id)!;

    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'TASK_COMPLETED',
      aggregateType: 'task',
      aggregateId: task.id,
      agentIdentity: session.agent,
      payload: {
        sessionId: session.id,
        finalNotes: params.finalNotes,
      },
    });

    return {
      task: updatedTask,
      session,
      validation,
      memoryResult,
      gitDiffSummary,
    };
  }

  private async captureGitState(): Promise<HandoffGitState> {
    let branch: string | undefined;
    let commitHash: string | undefined;
    let isDirty = false;
    let modifiedFiles: string[] = [];
    let untrackedFiles: string[] = [];

    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
    if (isGit) {
      branch = (await this.gitAnalyzer.getCurrentBranch(this.projectRoot)) ?? undefined;
      commitHash = (await this.gitAnalyzer.getCurrentCommit(this.projectRoot)) ?? undefined;
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
      modifiedFiles = changes.modified;
      untrackedFiles = changes.added;
      isDirty = changes.modified.length > 0 || changes.added.length > 0 || changes.deleted.length > 0;
    }

    return {
      branch,
      commitHash,
      isDirty,
      modifiedFiles,
      untrackedFiles,
    };
  }
}
