import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  EventRepository,
  ExecutionSessionRepository,
} from '../../src/database/repositories/index.js';
import {
  SessionService,
  SessionManager,
  SessionContinuityChecker,
  SessionCLI,
} from '../../src/sessions/index.js';
import { Task } from '../../src/core/types.js';

describe('Phase 13: Session Handoff Manager', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let eventRepo: EventRepository;
  let sessionRepo: ExecutionSessionRepository;
  let sessionService: SessionService;
  let sessionManager: SessionManager;
  let continuityChecker: SessionContinuityChecker;

  let projectId: string;
  let testTask: Task;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-session-test-'));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    eventRepo = new EventRepository(client.db);
    sessionRepo = new ExecutionSessionRepository(client.db);

    continuityChecker = new SessionContinuityChecker(client.db, tempDir);
    sessionService = new SessionService({
      db: client.db,
      projectRoot: tempDir,
      continuityChecker,
    });
    sessionManager = new SessionManager(
      {
        db: client.db,
        projectRoot: tempDir,
        continuityChecker,
      },
      tempDir
    );

    const proj = projectRepo.create({
      name: 'Session Manager Test Project',
      rootPath: tempDir,
      description: 'Testing provider-agnostic execution session handoff',
    });
    projectId = proj.id;

    testTask = taskRepo.create({
      projectId,
      title: 'Decoupled Session Architecture',
      goal: 'Enable seamless agent transitions without chat history dependencies',
      priority: 'high',
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. ExecutionSessionRepository CRUD
  // ---------------------------------------------------------------------------
  describe('ExecutionSessionRepository', () => {
    it('creates and manages session records with all required attributes', () => {
      const session = sessionRepo.createSession({
        projectId,
        taskId: testTask.id,
        provider: 'antigravity',
        agent: 'Antigravity-1',
        accountLabel: 'dev-tier',
        status: 'active',
      });

      expect(session.id).toBeDefined();
      expect(session.provider).toBe('antigravity');
      expect(session.agent).toBe('Antigravity-1');
      expect(session.accountLabel).toBe('dev-tier');
      expect(session.status).toBe('active');
      expect(session.startedAt).toBeGreaterThan(0);
      expect(session.endedAt).toBeUndefined();

      const retrieved = sessionRepo.findById(session.id);
      expect(retrieved?.id).toBe(session.id);

      const updated = sessionRepo.updateStatus(session.id, 'paused');
      expect(updated.status).toBe('paused');

      const handoffUpdated = sessionRepo.updateStatus(session.id, 'handoff');
      expect(handoffUpdated.status).toBe('handoff');
      expect(handoffUpdated.endedAt).toBeDefined();

      const activeByTask = sessionRepo.findActiveByTask(testTask.id);
      expect(activeByTask).toBeNull(); // Status is now 'handoff', not 'active'
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Session Lifecycle (Start, End/Handoff, Resume)
  // ---------------------------------------------------------------------------
  describe('SessionService Lifecycle', () => {
    it('starts an active session, advances task, and captures continuity report', async () => {
      const result = await sessionService.startSession(testTask.id, {
        provider: 'antigravity',
        agent: 'AntigravityCoder',
        accountLabel: 'primary-key',
      });

      expect(result.session.status).toBe('active');
      expect(result.session.taskId).toBe(testTask.id);
      expect(result.task.status).toBe('in_progress');
      expect(result.task.assignedAgent).toBe('AntigravityCoder');
      expect(result.context.taskId).toBe(testTask.id);
      expect(result.continuity.isConsistent).toBe(true);
      expect(result.nextAction).toBeDefined();

      const events = eventRepo.listByProject(projectId);
      expect(events.some((e) => e.eventType === 'SESSION_STARTED')).toBe(true);
    });

    it('ends an active session with full handoff, git state, and validation snapshot', async () => {
      const startResult = await sessionService.startSession(testTask.id, {
        provider: 'antigravity',
        agent: 'AntigravityCoder',
      });

      const endResult = await sessionService.endSession(startResult.session.id, {
        objective: 'Implement SQLite schema for execution sessions',
        completedWork: 'Created 009_execution_sessions.sql and repository',
        nextAction: 'Build SessionContinuityChecker and test handoffs',
        blockers: undefined,
        modifiedFiles: ['src/sessions/session-service.ts'],
        decisions: ['Store sessions independently of tasks'],
        status: 'handoff',
      });

      expect(endResult.session.status).toBe('handoff');
      expect(endResult.session.endedAt).toBeDefined();
      expect(endResult.handoff.agentIdentity).toBe('AntigravityCoder');
      expect(endResult.handoff.completedWork).toContain('Created 009_execution_sessions.sql');
      expect(endResult.task.status).toBe('handoff');
      const persistedHandoff = handoffRepo.findLatestByTaskId(testTask.id);
      expect(persistedHandoff?.id).toBe(endResult.handoff.id);

      // Verify on-disk snapshot (.ai/handoff/CURRENT.json)
      const snapshotPath = path.join(tempDir, '.ai', 'handoff', 'CURRENT.json');
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshotContent = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshotContent.task_id).toBe(testTask.id);
      expect(snapshotContent.completed).toBeDefined();

      // Verify audit event
      const events = eventRepo.listByProject(projectId);
      expect(events.some((e) => e.eventType === 'SESSION_ENDED')).toBe(true);
    });

    it('pauses an active session cleanly', async () => {
      const startResult = await sessionService.startSession(testTask.id);
      const paused = await sessionService.pauseSession(startResult.session.id);
      expect(paused.status).toBe('paused');

      const events = eventRepo.listByProject(projectId);
      expect(events.some((e) => e.eventType === 'SESSION_PAUSED')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. CRITICAL REQUIREMENT: Continuity without Old Conversation History
  // ---------------------------------------------------------------------------
  describe('Cross-Session Continuity Without Conversation History', () => {
    it('seamlessly transitions from Agent A (Session 1) to Agent B (Session 2) using Git + Task + Memory + Graph + Handoff', async () => {
      // Step 1: Session 1 (Agent A: Antigravity)
      const session1 = await sessionService.startSession(testTask.id, {
        provider: 'antigravity',
        agent: 'Antigravity-Lead',
        accountLabel: 'prod-account',
      });

      await sessionService.endSession(session1.session.id, {
        objective: 'Decouple session lifecycle from task state',
        completedWork: 'Built SessionService, ExecutionSessionRepository, and test suites',
        nextAction: 'Resume task from Agent B to verify zero-chat-history continuity',
        modifiedFiles: ['src/sessions/session-manager.ts'],
        status: 'handoff',
      });

      // Step 2: Simulate total disappearance of Session 1 transcript/memory
      // (No conversation history passed, no private session transfer)

      // Step 3: Session 2 (Agent B: Claude) resumes the task
      const session2 = await sessionService.resumeSession(testTask.id, {
        provider: 'claude',
        agent: 'ClaudeCode-Worker',
        accountLabel: 'anthropic-tier',
      });

      expect(session2.session.id).not.toBe(session1.session.id);
      expect(session2.session.provider).toBe('claude');
      expect(session2.session.agent).toBe('ClaudeCode-Worker');
      expect(session2.task.status).toBe('in_progress');
      expect(session2.task.assignedAgent).toBe('ClaudeCode-Worker');

      // Verify context pack contains predecessor's handoff
      expect(session2.context.recentHandoff).toBeDefined();
      expect(session2.context.recentHandoff?.agentIdentity).toBe('Antigravity-Lead');
      expect(session2.context.recentHandoff?.completedWork).toContain(
        'Built SessionService, ExecutionSessionRepository'
      );
      expect(session2.nextAction).toBe(
        'Resume task from Agent B to verify zero-chat-history continuity'
      );

      // Verify audit logs show seamless transition
      const events = eventRepo.listByProject(projectId);
      const resumeEvent = events.find((e) => e.eventType === 'SESSION_RESUMED');
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent?.agentIdentity).toBe('ClaudeCode-Worker');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. SessionContinuityChecker Mismatch Detection
  // ---------------------------------------------------------------------------
  describe('SessionContinuityChecker Mismatch Detection', () => {
    it('detects active blockers recorded on handoff', async () => {
      const session = await sessionService.startSession(testTask.id);
      await sessionService.endSession(session.session.id, {
        completedWork: 'Drafted architecture',
        nextAction: 'Resolve dependency conflict',
        blockers: 'External dependency v2 is deprecated',
        status: 'handoff',
      });

      const report = await continuityChecker.checkContinuity(testTask.id);
      expect(report.mismatches.some((m) => m.code === 'ACTIVE_TASK_BLOCKER')).toBe(true);
      expect(report.latestHandoff?.blockers).toContain('External dependency v2 is deprecated');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. SessionManager & Workspace Pointer
  // ---------------------------------------------------------------------------
  describe('SessionManager Workspace State', () => {
    it('writes and reads .ai/sessions/CURRENT_SESSION.json workspace pointer', async () => {
      const startResult = await sessionManager.startSession(testTask.id, {
        provider: 'gemini',
        agent: 'GeminiCLI',
      });

      const current = sessionManager.getCurrentSession();
      expect(current).not.toBeNull();
      expect(current?.sessionId).toBe(startResult.session.id);
      expect(current?.taskId).toBe(testTask.id);

      const statusView = await sessionManager.getStatus();
      expect(statusView.session.id).toBe(startResult.session.id);
      expect(statusView.task?.id).toBe(testTask.id);

      await sessionManager.endSession({
        completedWork: 'Finished subtask',
        nextAction: 'Deploy changes',
        status: 'handoff',
      });

      const endedStatus = await sessionManager.getStatus();
      expect(endedStatus.session.status).toBe('handoff');
    });
  });

  // ---------------------------------------------------------------------------
  // 6. UI-Independent CLI Commands
  // ---------------------------------------------------------------------------
  describe('SessionCLI Commands', () => {
    it('handles start, status, handoff, and resume CLI commands without errors', async () => {
      const cli = new SessionCLI({
        db: client.db,
        projectRoot: tempDir,
      });

      // 1. session start
      await cli.run(['start', testTask.id, '--provider', 'openai', '--agent', 'OpenAICodex']);
      const activeSession = sessionRepo.findActiveByTask(testTask.id);
      expect(activeSession).not.toBeNull();
      expect(activeSession?.provider).toBe('openai');
      expect(activeSession?.agent).toBe('OpenAICodex');

      // 2. session status
      await cli.run(['status']);

      // 3. session handoff
      await cli.run(['handoff', '--completed', 'Implemented OpenAI codex interface', '--next', 'Run unit tests']);
      const taskAfterHandoff = taskRepo.findById(testTask.id);
      expect(taskAfterHandoff?.status).toBe('handoff');

      // 4. session resume
      await cli.run(['resume', testTask.id, '--provider', 'antigravity', '--agent', 'AntigravityVerifier']);
      const taskAfterResume = taskRepo.findById(testTask.id);
      expect(taskAfterResume?.status).toBe('in_progress');
      expect(taskAfterResume?.assignedAgent).toBe('AntigravityVerifier');
    });
  });
});
