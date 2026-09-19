import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { TaskCliAPI } from '../../src/tasks/task-cli.js';
import { TaskService } from '../../src/tasks/task-service.js';
import { ProjectRepository } from '../../src/database/repositories/index.js';

describe('TaskCliAPI & Dev Inspection', () => {
  let client: SQLiteDatabaseClient;
  let cli: TaskCliAPI;
  let taskService: TaskService;
  let projectRepo: ProjectRepository;
  let projectId: string;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    cli = new TaskCliAPI(client.db);
    taskService = new TaskService(client.db);
    projectRepo = new ProjectRepository(client.db);

    const proj = projectRepo.create({
      name: 'CLI Test Project',
      rootPath: '/test/cli',
    });
    projectId = proj.id;
  });

  afterEach(() => {
    client.close();
  });

  it('createTask should return formatted summary', async () => {
    const output = await cli.createTask({
      projectId,
      title: 'Setup Environment via CLI',
      goal: 'Verify dev inspection capability',
      priority: 'high',
      assignedAgent: 'CliUser',
    });

    expect(output).toContain('=== TASK CREATED ===');
    expect(output).toContain('Setup Environment via CLI');
    expect(output).toContain('Verify dev inspection capability');
    expect(output).toContain('Status:      planned');
  });

  it('inspectTask should output complete state report with steps and snapshot', async () => {
    const task = await taskService.createTask({
      projectId,
      title: 'Detailed Inspection Task',
      goal: 'Demonstrate terminal inspector',
      priority: 'critical',
      assignedAgent: 'Antigravity',
    });

    await taskService.startTask(task.id);
    const step1 = await taskService.addStep(task.id, 'Configure database', 1);
    await taskService.addStep(task.id, 'Run migrations', 2);
    await taskService.completeStep(step1.id, 'DB configured');

    await taskService.attachFile(task.id, 'src/database/client.ts', 'modified');
    await taskService.attachSymbol(task.id, 'SQLiteDatabaseClient');
    await taskService.addBlocker(task.id, 'Waiting for disk quota check');

    const report = await cli.inspectTask(task.id);

    expect(report).toContain('AI PROJECT OS — TASK INSPECTOR');
    expect(report).toContain('Title:          Detailed Inspection Task');
    expect(report).toContain('Goal:           Demonstrate terminal inspector');
    expect(report).toContain('Status:         IN_PROGRESS');
    expect(report).toContain('[x] Step 1: Configure database (completed) -> DB configured');
    expect(report).toContain('[ ] Step 2: Run migrations (pending)');
    expect(report).toContain('src/database/client.ts (modified)');
    expect(report).toContain('SQLiteDatabaseClient');
    expect(report).toContain('[!] Waiting for disk quota check');
    expect(report).toContain('AGENT SNAPSHOT');
  });
});
