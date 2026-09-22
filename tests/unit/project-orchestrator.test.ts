import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  EventRepository,
  ValidationRepository,
  ExecutionSessionRepository,
  DecisionRepository,
} from '../../src/database/repositories/index.js';
import { ProjectOrchestrator } from '../../src/orchestrator/index.js';
import { AntigravityAdapter, ClaudeAdapter } from '../../src/agents/adapter.js';

describe('Phase 14: Project OS Orchestrator (End-to-End Workflow)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let eventRepo: EventRepository;
  let validationRepo: ValidationRepository;
  let sessionRepo: ExecutionSessionRepository;
  let decisionRepo: DecisionRepository;
  let orchestrator: ProjectOrchestrator;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-orchestrator-test-'));

    // Initialize genuine git repository in tempDir
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Project OS Orchestrator"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "orchestrator@cofaios.local"', { cwd: tempDir, stdio: 'ignore' });

    // Initial files and commit
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'calculator.ts'),
      'export class Calculator {\n  add(a: number, b: number) { return a + b; }\n}\n'
    );
    execSync('git add . && git commit -m "initial commit"', { cwd: tempDir, stdio: 'ignore' });

    // Database & Repositories
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });
    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    eventRepo = new EventRepository(client.db);
    validationRepo = new ValidationRepository(client.db);
    sessionRepo = new ExecutionSessionRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);

    const project = projectRepo.create({
      name: 'Calculator Service',
      rootPath: tempDir,
      description: 'End-to-end orchestration test project',
    });
    projectId = project.id;

    orchestrator = new ProjectOrchestrator({
      db: client.db,
      projectRoot: tempDir,
      projectId,
      projectRepo,
      taskRepo,
      handoffRepo,
      eventRepo,
      validationRepo,
      sessionRepo,
      decisionRepo,
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. End-to-End Multi-Session Workflow (The Core Invariant)
  // ---------------------------------------------------------------------------
  describe('End-to-End Agent Collaboration Scenario', () => {
    it('executes full lifecycle: Agent A starts -> modifies -> handoff -> Agent B resumes on SAME working tree -> modifies -> completes', async () => {
      // Setup Adapters for Agent A (Antigravity) and Agent B (ClaudeCode)
      const agentA = new AntigravityAdapter({
        identity: { accountLabel: 'antigravity-dev' },
      });
      const agentB = new ClaudeAdapter({
        identity: { accountLabel: 'claude-pro' },
      });

      // -----------------------------------------------------------------------
      // Step 1: Agent A starts task
      // -----------------------------------------------------------------------
      const execPackageA = await orchestrator.startTask({
        adapter: agentA,
        projectId,
        title: 'Implement Multiplication and Division',
        goal: 'Extend Calculator with multiply and divide methods with proper zero-handling',
        priority: 'high',
        tokenBudget: 8000,
      });

      const taskId = execPackageA.task.id;
      const sessionAId = execPackageA.session.id;

      expect(execPackageA.task.status).toBe('in_progress');
      expect(execPackageA.task.assignedAgent).toBe('Antigravity');
      expect(execPackageA.session.status).toBe('active');
      expect(execPackageA.session.provider).toBe('antigravity');
      expect(execPackageA.context.taskId).toBe(taskId);
      expect(execPackageA.promptPayload?.systemPrompt).toBeDefined();
      expect(execPackageA.promptPayload?.userPrompt).toContain('Implement Multiplication and Division');

      // Verify audit event
      const eventsAfterStart = eventRepo.listByProject(projectId);
      expect(eventsAfterStart.some((e) => e.eventType === 'SESSION_STARTED')).toBe(true);

      // -----------------------------------------------------------------------
      // Step 2: Agent A records progress and modifies code in working tree
      // -----------------------------------------------------------------------
      const step1 = await orchestrator.recordProgress({
        taskId,
        addStep: { title: 'Implement multiply method' },
        decision: { title: 'Multiply implementation', rationale: 'Simple standard product' },
      });
      await orchestrator.recordProgress({
        taskId,
        stepId: step1.addedStepId,
        completeStep: true,
      });
      await orchestrator.recordProgress({
        taskId,
        addStep: { title: 'Implement divide method with zero check' },
      });

      // Modify code in the working tree
      fs.writeFileSync(
        path.join(tempDir, 'src', 'calculator.ts'),
        [
          'export class Calculator {',
          '  add(a: number, b: number) { return a + b; }',
          '  multiply(a: number, b: number) { return a * b; }',
          '}',
        ].join('\n')
      );

      // -----------------------------------------------------------------------
      // Step 3: Agent A tests changes
      // -----------------------------------------------------------------------
      const valResultA = await orchestrator.validateTask(taskId, {
        skipLint: true,
        skipTypecheck: true,
        skipBuild: true,
        testCommand: 'node -e "process.exit(0)"',
      });
      expect(valResultA.status).toBe('passed');

      // -----------------------------------------------------------------------
      // Step 4: Agent A initiates handoff
      // -----------------------------------------------------------------------
      const handoffResult = await orchestrator.handoffTask({
        taskId,
        sessionId: sessionAId,
        objective: 'Extend Calculator with multiply and divide methods',
        completedWork: 'Implemented multiply(a, b). Added unit test verification.',
        currentFile: 'src/calculator.ts',
        modifiedFiles: ['src/calculator.ts'],
        decisions: ['Implemented multiply; divide remains to be implemented with zero-check'],
        nextAction: 'Implement divide(a, b) method throwing Error on zero divisor',
      });

      expect(handoffResult.task.status).toBe('handoff');
      expect(handoffResult.session.status).toBe('handoff');
      expect(handoffResult.handoff.agentIdentity).toBe('Antigravity');
      expect(handoffResult.handoff.completedWork).toContain('Implemented multiply');
      expect(handoffResult.handoff.nextAction).toContain('Implement divide');

      // Verify on-disk snapshot exists (.ai/handoff/CURRENT.json)
      const snapshotPath = path.join(tempDir, '.ai', 'handoff', 'CURRENT.json');
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(snapshot.task_id).toBe(taskId);
      expect(snapshot.next_action).toContain('Implement divide');

      // -----------------------------------------------------------------------
      // Step 5-8: Agent B resumes task on the EXACT SAME working tree (no branch switch)
      // -----------------------------------------------------------------------
      const continuationPackage = await orchestrator.resumeTask({
        taskId,
        adapter: agentB,
        tokenBudget: 8000,
      });

      const sessionBId = continuationPackage.session.id;

      // Invariant checks:
      expect(continuationPackage.task.id).toBe(taskId);
      expect(continuationPackage.task.status).toBe('in_progress');
      expect(continuationPackage.task.assignedAgent).toBe('ClaudeCode');
      expect(continuationPackage.session.id).not.toBe(sessionAId); // New session!
      expect(continuationPackage.session.provider).toBe('claude');
      expect(continuationPackage.session.status).toBe('active');
      expect(continuationPackage.continuity.isConsistent).toBe(true);
      expect(continuationPackage.nextAction).toContain('Implement divide');
      expect(continuationPackage.handoff.agentIdentity).toBe('Antigravity');
      expect(continuationPackage.context.recentHandoff?.id).toBe(handoffResult.handoff.id);

      // Verify Agent B prompt envelope contains predecessor handoff info
      expect(continuationPackage.promptPayload?.systemPrompt).toBeDefined();
      expect(continuationPackage.promptPayload?.userPrompt).toContain('Implement Multiplication and Division');

      // -----------------------------------------------------------------------
      // Step 9: Agent B continues work on the SAME working tree
      // -----------------------------------------------------------------------
      const activeSteps = taskRepo.listSteps(taskId);
      const divideStep = activeSteps.find((s) => s.title.includes('divide'));
      if (divideStep) {
        await orchestrator.recordProgress({
          taskId,
          stepId: divideStep.id,
          completeStep: true,
          decision: { title: 'Division by Zero Behavior', rationale: 'Throws Error("Division by zero")' },
        });
      }

      // Agent B writes divide method to src/calculator.ts
      fs.writeFileSync(
        path.join(tempDir, 'src', 'calculator.ts'),
        [
          'export class Calculator {',
          '  add(a: number, b: number) { return a + b; }',
          '  multiply(a: number, b: number) { return a * b; }',
          '  divide(a: number, b: number) {',
          '    if (b === 0) throw new Error("Division by zero");',
          '    return a / b;',
          '  }',
          '}',
        ].join('\n')
      );

      // -----------------------------------------------------------------------
      // Step 10: Agent B runs validation tests
      // -----------------------------------------------------------------------
      const valResultB = await orchestrator.validateTask(taskId, {
        skipLint: true,
        skipTypecheck: true,
        skipBuild: true,
        testCommand: 'node -e "process.exit(0)"',
      });
      expect(valResultB.status).toBe('passed');

      // -----------------------------------------------------------------------
      // Step 11: Agent B completes the task
      // -----------------------------------------------------------------------
      const completeResult = await orchestrator.completeTask({
        taskId,
        sessionId: sessionBId,
        finalNotes: 'Successfully implemented multiply and divide methods with zero-check test coverage',
        skipValidation: true,
      });

      expect(completeResult.task.status).toBe('done');
      expect(completeResult.session.status).toBe('ended');
      expect(completeResult.session.id).toBe(sessionBId);
      expect(completeResult.gitDiffSummary).toBeDefined();
      expect(completeResult.gitDiffSummary).toContain('calculator.ts');

      // -----------------------------------------------------------------------
      // Invariant Verifications across the entire pipeline
      // -----------------------------------------------------------------------
      // 1. Task entity invariant: One single Task ID throughout
      const finalTask = taskRepo.findById(taskId)!;
      expect(finalTask.status).toBe('done');

      // 2. Session continuity invariant: Exactly 2 sessions recorded for this task
      const allSessions = sessionRepo.listByTask(taskId);
      expect(allSessions.length).toBe(2);
      expect(allSessions[0]?.provider).toBe('claude'); // Most recent first
      expect(allSessions[1]?.provider).toBe('antigravity');

      // 3. Audit trail invariant: Key lifecycle events recorded
      const events = eventRepo.listByProject(projectId);
      const eventTypes = events.map((e) => e.eventType);
      expect(eventTypes).toContain('SESSION_STARTED');
      expect(eventTypes).toContain('AGENT_HANDOFF_COMPLETED');
      expect(eventTypes).toContain('TASK_RESUMED');
      expect(eventTypes).toContain('TASK_COMPLETED');

      // 4. Decision repository invariant: Decisions recorded from both agents
      const decisions = decisionRepo.listByProject(projectId);
      expect(decisions.length).toBeGreaterThanOrEqual(2);
      expect(decisions.some((d) => d.title.includes('Division by Zero'))).toBe(true);

      // 5. Final snapshot on disk reflects task completion
      const finalSnapshotData = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      expect(finalSnapshotData.task_id).toBe(taskId);
      expect(finalSnapshotData.completed).toBeDefined();
    }, 15000);
  });

  // ---------------------------------------------------------------------------
  // 2. Context Preparation and Budgeting
  // ---------------------------------------------------------------------------
  describe('Context Preparation', () => {
    it('builds a token-budgeted context package and includes active handoff', async () => {
      const task = taskRepo.create({
        projectId,
        title: 'Context Budgeting Test',
        goal: 'Verify context pack bounds',
        priority: 'medium',
      });

      handoffRepo.create({
        taskId: task.id,
        projectId,
        objective: 'Baseline test',
        completedWork: 'Created foundation files',
        nextAction: 'Continue with feature',
        gitState: { branch: 'main', isDirty: false },
        agentIdentity: 'PredecessorAgent',
      });

      const contextPack = await orchestrator.prepareContext(task.id, {
        tokenBudget: 4000,
      });

      expect(contextPack.taskId).toBe(task.id);
      expect(contextPack.tokenBudget).toBe(4000);
      expect(contextPack.recentHandoff).toBeDefined();
      expect(contextPack.recentHandoff?.agentIdentity).toBe('PredecessorAgent');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Error Handling and Edge Cases
  // ---------------------------------------------------------------------------
  describe('Error Handling and Edge Cases', () => {
    it('throws when starting an invalid taskId', async () => {
      await expect(
        orchestrator.startTask({
          taskId: 'non-existent-task-id',
        })
      ).rejects.toThrow('Task not found');
    });

    it('throws when resuming a task without an existing handoff', async () => {
      const task = taskRepo.create({
        projectId,
        title: 'Task without handoff',
        goal: 'Cannot be resumed without handoff',
      });

      await expect(
        orchestrator.resumeTask({
          taskId: task.id,
        })
      ).rejects.toThrow('No handoff found');
    });

    it('throws when completing a non-existent task', async () => {
      await expect(
        orchestrator.completeTask({
          taskId: 'non-existent-task-id',
        })
      ).rejects.toThrow('Task not found');
    });

    it('gracefully handles non-git repositories', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-nongit-test-'));
      const nonGitOrchestrator = new ProjectOrchestrator({
        db: client.db,
        projectRoot: nonGitDir,
        projectId,
      });

      const task = await nonGitOrchestrator.startTask({
        title: 'Non-git task',
        goal: 'Verify graceful fallback without git',
      });

      expect(task.gitState.branch).toBeUndefined();
      expect(task.gitState.isDirty).toBe(false);
      expect(task.task.status).toBe('in_progress');

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });
  });
});
