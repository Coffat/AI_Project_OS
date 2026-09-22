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
} from '../../src/database/repositories/index.js';
import {
  AntigravityAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  OpenAIAdapter,
  LocalModelAdapter,
  MockAgentAdapter,
  AgentLifecycleManager,
} from '../../src/agents/index.js';
import { ContextPack, Task } from '../../src/core/types.js';
import { ValidationError } from '../../src/core/errors.js';

describe('Phase 12: Agent Adapter Architecture & Multi-Agent Lifecycle', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let eventRepo: EventRepository;
  let manager: AgentLifecycleManager;

  let projectId: string;
  let createdTask: Task;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-agent-test-'));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    eventRepo = new EventRepository(client.db);

    manager = new AgentLifecycleManager({
      db: client.db,
      projectRoot: tempDir,
    });

    // Create test project
    const proj = projectRepo.create({
      name: 'Agent Adapter Test Project',
      rootPath: tempDir,
      description: 'Verifying provider-agnostic agent adapter integration',
    });
    projectId = proj.id;

    // Create initial task
    createdTask = taskRepo.create({
      projectId,
      title: 'Implement Multi-Agent Authentication Boundary',
      goal: 'Decouple AI Project OS from specific LLM providers',
      priority: 'high',
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. Adapter Interface & Provider Decoupling
  // ---------------------------------------------------------------------------
  describe('Provider Adapter Abstractions', () => {
    it('AntigravityAdapter instantiates with metadata-only identity', () => {
      const adapter = new AntigravityAdapter({
        identity: { accountLabel: 'corp-antigravity' },
      });

      expect(adapter.provider).toBe('antigravity');
      expect(adapter.agentName).toBe('Antigravity');
      expect(adapter.identity.accountLabel).toBe('corp-antigravity');
      expect(typeof adapter.identity.sessionId).toBe('string');
      expect(adapter.identity.sessionId.length).toBeGreaterThan(0);

      // Verify no secret or credential fields are present
      const identityKeys = Object.keys(adapter.identity);
      expect(identityKeys).not.toContain('cookie');
      expect(identityKeys).not.toContain('token');
      expect(identityKeys).not.toContain('apiKey');
      expect(identityKeys).not.toContain('password');
    });

    it('ClaudeAdapter, GeminiAdapter, OpenAIAdapter, LocalModelAdapter instantiate properly', () => {
      const claude = new ClaudeAdapter();
      expect(claude.provider).toBe('claude');
      expect(claude.agentName).toBe('ClaudeCode');

      const gemini = new GeminiAdapter();
      expect(gemini.provider).toBe('gemini');
      expect(gemini.agentName).toBe('GeminiCLI');

      const openai = new OpenAIAdapter();
      expect(openai.provider).toBe('openai');
      expect(openai.agentName).toBe('OpenAICodex');

      const local = new LocalModelAdapter('http://localhost:8000/v1');
      expect(local.provider).toBe('local');
      expect(local.agentName).toBe('LocalLLM');
    });

    it('MockAgentAdapter records context and simulates step completions', async () => {
      const mock = new MockAgentAdapter('MockWorker');
      expect(mock.provider).toBe('mock');
      expect(mock.agentName).toBe('MockWorker');

      const dummyContext: ContextPack = {
        taskId: 'task-test',
        taskTitle: 'Test Task',
        constitutionRules: ['Local First'],
        architectureRules: ['Hexagonal'],
        relevantDecisions: [],
        relevantSymbols: [],
        tokenBudget: 4000,
        estimatedTokens: 120,
      };

      const envelope = await mock.sendContext({
        taskId: 'task-test',
        context: dummyContext,
      });

      expect(mock.receivedEnvelopes.length).toBe(1);
      expect(envelope.systemPrompt).toContain('Local First');
      expect(envelope.userPrompt).toContain('Active Task: [task-test] Test Task');

      mock.simulateStepExecution('Step 1: Analyzed codebase');
      expect(mock.executedSteps).toContain('Step 1: Analyzed codebase');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Full Multi-Agent Lifecycle
  // ---------------------------------------------------------------------------
  describe('Full Multi-Agent Lifecycle Execution', () => {
    it('executes start -> handoff -> resume -> complete across different agent providers', async () => {
      // -----------------------------------------------------------------------
      // Step 1: Agent A (Antigravity) starts the task
      // Flow: Project OS → Task → Context → Agent
      // -----------------------------------------------------------------------
      const antigravity = new AntigravityAdapter({
        identity: { accountLabel: 'developer-primary' },
      });

      const startResult = await manager.startTask(antigravity, createdTask.id, {
        tokenBudget: 6000,
      });

      expect(startResult.state.status).toBe('running');
      expect(startResult.state.currentTaskId).toBe(createdTask.id);
      expect(startResult.task.status).toBe('in_progress');
      expect(startResult.task.assignedAgent).toBe('Antigravity');
      expect(startResult.context.taskId).toBe(createdTask.id);
      expect(startResult.promptPayload?.userPrompt).toContain(createdTask.title);

      // Check audit event for start
      const eventsAfterStart = eventRepo.listByProject(projectId);
      expect(eventsAfterStart.some((e) => e.eventType === 'AGENT_TASK_STARTED')).toBe(true);

      // -----------------------------------------------------------------------
      // Step 2: Agent A (Antigravity) stops and saves handoff
      // Flow: Agent → Handoff → Project OS
      // -----------------------------------------------------------------------
      const handoffRecord = await antigravity.saveHandoff({
        taskId: createdTask.id,
        objective: 'Decouple AI provider logic and define standard AgentAdapter',
        completedWork: 'Created AgentAdapter interface, types, and BaseAgentAdapter',
        modifiedFiles: ['src/agents/types.ts', 'src/agents/adapter.ts'],
        decisions: ['Keep task state exclusively in Project OS'],
        nextAction: 'Implement AgentLifecycleManager and test resume flow',
        blockers: undefined,
      });

      expect(handoffRecord.id).toBeDefined();
      expect(handoffRecord.agentIdentity).toBe('Antigravity');
      expect(handoffRecord.completedWork).toContain('Created AgentAdapter interface');

      const savedHandoff = handoffRepo.findLatestByTaskId(createdTask.id);
      expect(savedHandoff?.id).toBe(handoffRecord.id);

      // Task status should now be 'handoff' in Project OS
      const taskAtHandoff = taskRepo.findById(createdTask.id)!;
      expect(taskAtHandoff.status).toBe('handoff');

      // Check audit event for handoff
      const eventsAfterHandoff = eventRepo.listByProject(projectId);
      expect(eventsAfterHandoff.some((e) => e.eventType === 'AGENT_HANDOFF_SAVED')).toBe(true);

      // -----------------------------------------------------------------------
      // Step 3: Agent B (ClaudeCode) resumes the task
      // Flow: Project OS → Task → Handoff → Context → Agent
      // -----------------------------------------------------------------------
      const claude = new ClaudeAdapter({
        identity: { accountLabel: 'team-claude' },
      });

      const resumeResult = await manager.resumeTask(claude, createdTask.id, {
        tokenBudget: 8000,
      });

      expect(resumeResult.state.status).toBe('running');
      expect(resumeResult.state.currentTaskId).toBe(createdTask.id);
      expect(resumeResult.task.status).toBe('in_progress');
      expect(resumeResult.task.assignedAgent).toBe('ClaudeCode');

      // Verify that Agent B receives the exact handoff from Agent A in its context
      expect(resumeResult.handoff.agentIdentity).toBe('Antigravity');
      expect(resumeResult.context.recentHandoff).toBeDefined();
      expect(resumeResult.context.recentHandoff?.agentIdentity).toBe('Antigravity');
      expect(resumeResult.context.recentHandoff?.nextAction).toBe(
        'Implement AgentLifecycleManager and test resume flow'
      );

      // Prompt sent to Agent B must contain Agent A's handoff details
      expect(resumeResult.promptPayload?.userPrompt).toContain('=== PREVIOUS AGENT HANDOFF ===');
      expect(resumeResult.promptPayload?.userPrompt).toContain('From: Antigravity');
      expect(resumeResult.promptPayload?.userPrompt).toContain(
        'Next Action: Implement AgentLifecycleManager and test resume flow'
      );

      // Check audit event for resume
      const eventsAfterResume = eventRepo.listByProject(projectId);
      const resumeEvent = eventsAfterResume.find((e) => e.eventType === 'AGENT_TASK_RESUMED');
      expect(resumeEvent).toBeDefined();
      expect(resumeEvent?.agentIdentity).toBe('ClaudeCode');

      // -----------------------------------------------------------------------
      // Step 4: Agent B completes the task
      // -----------------------------------------------------------------------
      const completedTask = await manager.completeTask(claude, createdTask.id, {
        finalNotes: 'Multi-agent lifecycle fully implemented and verified',
      });

      expect(completedTask.status).toBe('done');

      const eventsAfterComplete = eventRepo.listByProject(projectId);
      expect(eventsAfterComplete.some((e) => e.eventType === 'AGENT_TASK_COMPLETED')).toBe(true);
    });

    it('rejects starting a non-existent task', async () => {
      const adapter = new AntigravityAdapter();
      await expect(
        manager.startTask(adapter, 'non-existent-task-id')
      ).rejects.toThrow(ValidationError);
    });

    it('rejects resuming a task with no existing handoff', async () => {
      const freshTask = taskRepo.create({
        projectId,
        title: 'Fresh Task Without Handoff',
        goal: 'Testing resume without handoff',
      });

      const adapter = new ClaudeAdapter();
      await expect(
        manager.resumeTask(adapter, freshTask.id)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects handoff with empty required fields', async () => {
      const adapter = new AntigravityAdapter();
      await manager.startTask(adapter, createdTask.id);

      await expect(
        adapter.saveHandoff({
          taskId: createdTask.id,
          objective: '',
          completedWork: 'Done something',
          nextAction: 'Next step',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        adapter.saveHandoff({
          taskId: createdTask.id,
          objective: 'Valid objective',
          completedWork: '',
          nextAction: 'Next step',
        })
      ).rejects.toThrow(ValidationError);

      await expect(
        adapter.saveHandoff({
          taskId: createdTask.id,
          objective: 'Valid objective',
          completedWork: 'Done something',
          nextAction: '',
        })
      ).rejects.toThrow(ValidationError);
    });
  });
});
