import { DatabaseSync } from 'node:sqlite';
import {
  ExecutionSessionRecord,
  HandoffRecord,
  Task,
} from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import {
  ExecutionSessionRepository,
  TaskRepository,
  HandoffRepository,
  EventRepository,
  ValidationRepository,
} from '../database/repositories/index.js';
import { ContextService } from '../context/context-service.js';
import { GraphService } from '../graph/graph-service.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { HandoffSnapshot } from '../handoff/handoff-snapshot.js';
import { SessionContinuityChecker } from './session-continuity-checker.js';
import {
  EndSessionOptions,
  EndSessionResult,
  ResumeSessionOptions,
  SessionStatusView,
  StartSessionOptions,
  StartSessionResult,
} from './types.js';

export interface SessionServiceDependencies {
  db: DatabaseSync;
  projectRoot?: string;
  sessionRepo?: ExecutionSessionRepository;
  taskRepo?: TaskRepository;
  handoffRepo?: HandoffRepository;
  eventRepo?: EventRepository;
  contextService?: ContextService;
  continuityChecker?: SessionContinuityChecker;
}

export class SessionService {
  private readonly db: DatabaseSync;
  private readonly projectRoot: string;
  private readonly sessionRepo: ExecutionSessionRepository;
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly eventRepo: EventRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly contextService: ContextService;
  private readonly continuityChecker: SessionContinuityChecker;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly handoffSnapshot: HandoffSnapshot;

  constructor(deps: SessionServiceDependencies) {
    this.db = deps.db;
    this.projectRoot = deps.projectRoot ?? process.cwd();

    this.sessionRepo = deps.sessionRepo ?? new ExecutionSessionRepository(this.db);
    this.taskRepo = deps.taskRepo ?? new TaskRepository(this.db);
    this.handoffRepo = deps.handoffRepo ?? new HandoffRepository(this.db);
    this.eventRepo = deps.eventRepo ?? new EventRepository(this.db);
    this.validationRepo = new ValidationRepository(this.db);
    this.gitAnalyzer = new GitAnalyzer();
    this.handoffSnapshot = new HandoffSnapshot(this.db, this.projectRoot);

    if (deps.contextService) {
      this.contextService = deps.contextService;
    } else {
      const graphService = new GraphService(this.db);
      this.contextService = new ContextService(this.db, graphService, this.projectRoot);
    }

    this.continuityChecker =
      deps.continuityChecker ??
      new SessionContinuityChecker(this.db, this.projectRoot);
  }

  /**
   * 1. Start a new session for a task:
   *   - Identify task
   *   - Read previous handoff
   *   - Verify git state & detect mismatches
   *   - Generate context pack
   *   - Expose next action
   */
  public async startSession(
    taskId: string,
    options?: StartSessionOptions
  ): Promise<StartSessionResult> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    // Check continuity across Git, Task, Memory, Graph, Handoff
    const continuity = await this.continuityChecker.checkContinuity(taskId);

    // If task was planned, advance to in_progress
    if (task.status === 'planned') {
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    }

    const assignedAgent = options?.agent ?? 'Agent';
    this.taskRepo.update(taskId, {
      assignedAgent,
    });

    const activeTask = this.taskRepo.findById(taskId)!;

    // Generate context pack
    const context = await this.contextService.buildContextPack(
      activeTask,
      options?.tokenBudget ?? 8000
    );
    if (continuity.latestHandoff) {
      context.recentHandoff = continuity.latestHandoff;
    }

    // Create session record
    const session = this.sessionRepo.createSession({
      projectId: activeTask.projectId,
      taskId: activeTask.id,
      provider: options?.provider ?? 'antigravity',
      agent: assignedAgent,
      accountLabel: options?.accountLabel,
      startedAt: Date.now(),
      status: 'active',
      metadata: options?.metadata,
    });

    // Record audit event
    this.eventRepo.recordEvent({
      projectId: activeTask.projectId,
      eventType: 'SESSION_STARTED',
      aggregateType: 'execution_session',
      aggregateId: session.id,
      agentIdentity: session.agent,
      payload: {
        sessionId: session.id,
        taskId: activeTask.id,
        provider: session.provider,
        accountLabel: session.accountLabel,
        isConsistent: continuity.isConsistent,
      },
    });

    return {
      session,
      task: activeTask,
      context,
      continuity,
      nextAction: continuity.recommendedNextAction,
    };
  }

  /**
   * 2. End an active session:
   *   - Save session metadata
   *   - Save task snapshot
   *   - Save handoff
   *   - Capture git state
   *   - Capture validation state
   *   - Determine next action
   */
  public async endSession(
    sessionId: string,
    options: EndSessionOptions
  ): Promise<EndSessionResult> {
    const session = this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new ValidationError(`Execution session not found: ${sessionId}`);
    }

    const taskId = session.taskId;
    if (!taskId) {
      throw new ValidationError(`Session ${sessionId} is not linked to any task`);
    }

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    // Capture Git State
    let gitState: HandoffRecord['gitState'] = {};
    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
    if (isGit) {
      const branch = await this.gitAnalyzer.getCurrentBranch(this.projectRoot);
      const commit = await this.gitAnalyzer.getCurrentCommit(this.projectRoot);
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
      const isDirty = changes.modified.length > 0 || changes.added.length > 0 || changes.deleted.length > 0;
      gitState = {
        branch: branch ?? 'main',
        commitHash: commit ?? 'HEAD',
        isDirty,
        untrackedFilesCount: changes.added.length,
      };
    }

    // Capture Validation State
    const validationRuns = this.validationRepo.listByTask(taskId);
    const latestVal = validationRuns.length > 0 ? validationRuns[0] : undefined;

    // 1. Capture and persist task snapshot on disk (.ai/handoff/CURRENT.json)
    const snapshotData = await this.handoffSnapshot.captureSnapshot({
      taskId,
      projectId: task.projectId,
      agentIdentity: session.agent,
      completedWork: options.completedWork,
      currentStep: options.currentFile,
      blockers: options.blockers ? [options.blockers] : undefined,
      tests: options.tests,
      nextAction: options.nextAction,
      validation: latestVal
        ? {
            status: latestVal.status as 'passed' | 'failed' | 'pending',
            timestamp: latestVal.finishedAt ?? Date.now(),
            lastTestedCommit: gitState.commitHash,
          }
        : undefined,
    });
    await this.handoffSnapshot.persistSnapshot(snapshotData, options.completedWork);

    // 2. Persist handoff record in SQLite
    const handoff = this.handoffRepo.create({
      taskId,
      projectId: task.projectId,
      objective: options.objective || task.goal || task.title,
      completedWork: options.completedWork,
      currentFile: options.currentFile,
      modifiedFiles: options.modifiedFiles ?? snapshotData.modified_files,
      decisions: options.decisions ?? snapshotData.decisions,
      blockers: options.blockers,
      tests: options.tests ?? snapshotData.tests,
      nextAction: options.nextAction,
      gitState,
      agentIdentity: session.agent,
    });

    // 3. Update session metadata and status
    const targetStatus = options.status ?? 'handoff';
    const updatedSession = this.sessionRepo.updateStatus(
      sessionId,
      targetStatus,
      Date.now()
    );

    // 4. Update task state
    if (targetStatus === 'handoff' && task.status === 'in_progress') {
      this.taskRepo.transitionStatus(taskId, 'handoff');
    }

    const updatedTask = this.taskRepo.findById(taskId)!;

    // 5. Record audit event
    this.eventRepo.recordEvent({
      projectId: task.projectId,
      eventType: 'SESSION_ENDED',
      aggregateType: 'execution_session',
      aggregateId: sessionId,
      agentIdentity: session.agent,
      payload: {
        sessionId,
        taskId,
        handoffId: handoff.id,
        status: targetStatus,
        nextAction: options.nextAction,
      },
    });

    return {
      session: updatedSession,
      handoff,
      task: updatedTask,
      nextAction: options.nextAction,
    };
  }

  /**
   * 3. Resume an interrupted or handed-off task in a new session:
   *   - Read handoff
   *   - Verify git state & detect mismatches
   *   - Transition task state to in_progress
   *   - Expose next action
   */
  public async resumeSession(
    taskId: string,
    options?: ResumeSessionOptions
  ): Promise<StartSessionResult> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new ValidationError(`Task not found: ${taskId}`);
    }

    // Read previous handoff
    const handoff = options?.handoffId
      ? this.handoffRepo.findById(options.handoffId)
      : this.handoffRepo.findLatestByTaskId(taskId);

    if (!handoff) {
      throw new ValidationError(`No handoff found to resume task: ${taskId}`);
    }

    // Transition task state: handoff -> resumed -> in_progress
    if (task.status === 'handoff') {
      this.taskRepo.transitionStatus(taskId, 'resumed');
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    } else if (task.status === 'resumed') {
      this.taskRepo.transitionStatus(taskId, 'in_progress');
    }

    const assignedAgent = options?.agent ?? 'Agent';
    this.taskRepo.update(taskId, {
      assignedAgent,
    });

    const activeTask = this.taskRepo.findById(taskId)!;

    // Check continuity across Git, Task, Memory, Graph, Handoff
    const continuity = await this.continuityChecker.checkContinuity(taskId, handoff.id);

    // Refresh context pack with predecessor's handoff
    const context = await this.contextService.buildContextPack(
      activeTask,
      options?.tokenBudget ?? 8000
    );
    context.recentHandoff = handoff;

    // Create a new execution session for the resuming agent
    const session = this.sessionRepo.createSession({
      projectId: activeTask.projectId,
      taskId: activeTask.id,
      provider: options?.provider ?? 'antigravity',
      agent: assignedAgent,
      accountLabel: options?.accountLabel,
      startedAt: Date.now(),
      status: 'active',
    });

    this.eventRepo.recordEvent({
      projectId: activeTask.projectId,
      eventType: 'SESSION_RESUMED',
      aggregateType: 'execution_session',
      aggregateId: session.id,
      agentIdentity: session.agent,
      payload: {
        sessionId: session.id,
        taskId: activeTask.id,
        resumedFromHandoffId: handoff.id,
        previousAgent: handoff.agentIdentity,
      },
    });

    return {
      session,
      task: activeTask,
      context,
      continuity,
      nextAction: continuity.recommendedNextAction,
    };
  }

  /**
   * Pause an active session.
   */
  public async pauseSession(sessionId: string): Promise<ExecutionSessionRecord> {
    const session = this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new ValidationError(`Execution session not found: ${sessionId}`);
    }

    const updated = this.sessionRepo.updateStatus(sessionId, 'paused');

    this.eventRepo.recordEvent({
      projectId: session.projectId,
      eventType: 'SESSION_PAUSED',
      aggregateType: 'execution_session',
      aggregateId: sessionId,
      agentIdentity: session.agent,
      payload: { sessionId, taskId: session.taskId },
    });

    return updated;
  }

  /**
   * Query status of current active or requested session.
   */
  public async getSessionStatus(sessionId?: string): Promise<SessionStatusView> {
    let session: ExecutionSessionRecord | null = null;

    if (sessionId) {
      session = this.sessionRepo.findById(sessionId);
    } else {
      // Find latest active session or latest overall session
      session =
        this.sessionRepo.findLatestActiveByProject('') ??
        this.sessionRepo.findLatestByProject('');
    }

    if (!session) {
      throw new ValidationError('No active or recent execution session found');
    }

    let task: Task | undefined;
    let latestHandoff: HandoffRecord | undefined;
    let continuity: StartSessionResult['continuity'] | undefined;

    if (session.taskId) {
      task = this.taskRepo.findById(session.taskId) ?? undefined;
      latestHandoff = this.handoffRepo.findLatestByTaskId(session.taskId) ?? undefined;
      if (task) {
        continuity = await this.continuityChecker.checkContinuity(task.id);
      }
    }

    return {
      session,
      task,
      latestHandoff,
      continuity,
    };
  }
}
