import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { TaskService } from '../../src/tasks/task-service.js';
import { ProjectRepository, DecisionRepository } from '../../src/database/repositories/index.js';
import { ValidationError, TaskNotFoundError } from '../../src/core/errors.js';

describe('TaskService Comprehensive Operations', () => {
  let client: SQLiteDatabaseClient;
  let taskService: TaskService;
  let projectRepo: ProjectRepository;
  let decisionRepo: DecisionRepository;
  let projectId: string;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    projectRepo = new ProjectRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    taskService = new TaskService(client.db);

    const project = projectRepo.create({
      name: 'Task Engine Test Project',
      rootPath: '/test/task/engine',
    });
    projectId = project.id;
  });

  afterEach(() => {
    client.close();
  });

  it('createTask should set goal and initial planned status', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Build Task Engine',
      goal: 'Decouple tasks from conversations completely',
      description: 'Implement state machine and snapshot logic',
      priority: 'high',
      assignedAgent: 'Antigravity',
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Build Task Engine');
    expect(task.goal).toBe('Decouple tasks from conversations completely');
    expect(task.status).toBe('planned');
    expect(task.version).toBe(1);
    expect(task.startedAt).toBeUndefined();
    expect(task.completedAt).toBeUndefined();
  });

  it('startTask should transition to in_progress and set startedAt', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Start Task Test',
    });

    const started = await taskService.startTask(task.id, 'Agent-1');
    expect(started.status).toBe('in_progress');
    expect(started.startedAt).toBeDefined();
    expect(started.version).toBe(2);
  });

  it('addStep and completeStep should update step status and advance currentStep', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Step Workflow Test',
    });

    const step1 = await taskService.addStep(task.id, 'Write types', 1);
    const step2 = await taskService.addStep(task.id, 'Write service', 2);

    expect(step1.status).toBe('pending');
    expect(step2.status).toBe('pending');

    // Completing step 1 should advance currentStep to step 2
    await taskService.completeStep(step1.id, 'Completed types successfully');

    const agg = await taskService.getTask(task.id);
    expect(agg.steps[0]?.status).toBe('completed');
    expect(agg.steps[0]?.resultSummary).toBe('Completed types successfully');
    expect(agg.task.currentStep).toBe('Write service');

    // Completing step 2
    await taskService.completeStep(step2.id, 'Completed service');
    const aggAfter = await taskService.getTask(task.id);
    expect(aggAfter.task.currentStep).toBe('All steps completed');
  });

  it('blocking and resolving blockers lifecycle', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Blocker Workflow Test',
    });
    await taskService.startTask(task.id);

    // Block the task
    const blocked = await taskService.blockTask(task.id, 'Waiting for database migration 002 approval');
    expect(blocked.status).toBe('blocked');

    const agg = await taskService.getTask(task.id);
    expect(agg.blockers).toHaveLength(1);
    expect(agg.blockers[0]?.reason).toBe('Waiting for database migration 002 approval');
    expect(agg.blockers[0]?.resolved).toBe(false);

    // Attempting to complete task with unresolved blocker must fail
    await expect(taskService.completeTask(task.id)).rejects.toThrow(ValidationError);

    // Resolve blocker
    const blockerId = agg.blockers[0]!.id;
    await taskService.removeBlocker(blockerId);

    const aggAfter = await taskService.getTask(task.id);
    expect(aggAfter.blockers[0]?.resolved).toBe(true);
    expect(aggAfter.blockers[0]?.resolvedAt).toBeDefined();

    // Resume task
    const resumed = await taskService.resumeTask(task.id);
    expect(resumed.status).toBe('in_progress');

    // Complete task
    const completed = await taskService.completeTask(task.id);
    expect(completed.status).toBe('done');
    expect(completed.completedAt).toBeDefined();
  });

  it('pauseTask should transition to handoff and capture snapshot', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Pause & Handoff Test',
    });
    await taskService.startTask(task.id);
    await taskService.addStep(task.id, 'Initial step', 1);

    const paused = await taskService.pauseTask(task.id, 'Next agent should run integration tests');
    expect(paused.status).toBe('handoff');

    const history = await taskService.getTaskHistory(task.id);
    expect(history.snapshots.length).toBeGreaterThan(0);
    expect(history.snapshots[0]?.status).toBe('handoff');
    expect(history.snapshots[0]?.nextAction).toBe('Next agent should run integration tests');
  });

  it('attachFile, attachDecision, attachSymbol should associate context to task', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Attached Context Test',
    });

    const fileRel = await taskService.attachFile(task.id, 'src/tasks/task-service.ts', 'modified');
    expect(fileRel.filePath).toBe('src/tasks/task-service.ts');

    const symbolRel = await taskService.attachSymbol(task.id, 'TaskService');
    expect(symbolRel.symbolName).toBe('TaskService');

    const decision = decisionRepo.create({
      projectId,
      title: 'Decouple State Machine',
      context: 'Need isolated state validation',
      decisionRationale: 'Clean architecture',
    });

    const attachedDec = await taskService.attachDecision(task.id, decision.id);
    expect(attachedDec.taskId).toBe(task.id);

    const agg = await taskService.getTask(task.id);
    expect(agg.files).toHaveLength(1);
    expect(agg.symbols).toHaveLength(1);
    expect(agg.decisions).toHaveLength(1);
  });

  it('getTaskSnapshot should format complete state for incoming agent', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Full Snapshot Test',
      goal: 'Test comprehensive snapshot creation',
    });
    await taskService.startTask(task.id);
    const step = await taskService.addStep(task.id, 'Step A', 1);
    await taskService.addStep(task.id, 'Step B', 2);
    await taskService.completeStep(step.id, 'Step A finished');

    await taskService.attachFile(task.id, 'src/index.ts', 'modified');

    const snapshot = await taskService.getTaskSnapshot(task.id, 'Execute Step B');

    expect(snapshot.taskId).toBe(task.id);
    expect(snapshot.taskTitle).toBe('Full Snapshot Test');
    expect(snapshot.goal).toBe('Test comprehensive snapshot creation');
    expect(snapshot.status).toBe('in_progress');
    expect(snapshot.currentStep).toBe('Step B');
    expect(snapshot.completedSteps).toEqual(['Step A']);
    expect(snapshot.remainingSteps).toEqual(['Step B']);
    expect(snapshot.files).toContain('src/index.ts');
    expect(snapshot.nextAction).toBe('Execute Step B');
    expect(snapshot.timestamp).toBeDefined();
  });

  it('getTask should throw TaskNotFoundError for invalid ID', async () => {
    await expect(taskService.getTask('non-existent-task-id')).rejects.toThrow(TaskNotFoundError);
  });
});
