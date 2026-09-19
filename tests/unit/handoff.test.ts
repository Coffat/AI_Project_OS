import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { HandoffEngine } from '../../src/handoff/handoff-engine.js';
import { TaskEngine } from '../../src/tasks/task-engine.js';

describe('HandoffEngine', () => {
  let client: SQLiteDatabaseClient;
  let handoffEngine: HandoffEngine;
  let taskEngine: TaskEngine;
  let taskId: string;
  const projectId = 'p1';

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');

    client.db.prepare(`
      INSERT INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, 'Test Project', '/test', Date.now(), Date.now());

    taskEngine = new TaskEngine(client.db);
    const task = await taskEngine.createTask({
      projectId,
      title: 'Handoff Test Task',
    });
    taskId = task.id;

    handoffEngine = new HandoffEngine(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('should record and retrieve latest handoff with all 14 attributes', async () => {
    const report = await handoffEngine.recordHandoff({
      taskId,
      projectId,
      objective: 'Scaffold core engines and test database',
      completedWork: 'Built migration engine and repository layer',
      currentStep: 'Verification',
      currentFile: 'src/database/client.ts',
      modifiedFiles: ['src/database/client.ts', 'src/tasks/task-engine.ts'],
      decisions: ['Use native node:sqlite'],
      blockers: undefined,
      errors: undefined,
      tests: ['tests/unit/database.test.ts'],
      nextAction: 'Implement MCP endpoints and UI dashboard',
      gitState: { branch: 'main', commitHash: 'abc1234' },
      agentIdentity: 'ClaudeCode',
    });

    expect(report.id).toBeDefined();
    expect(report.agentIdentity).toBe('ClaudeCode');
    expect(report.objective).toBe('Scaffold core engines and test database');

    const latest = await handoffEngine.getLatestHandoff(taskId);
    expect(latest).not.toBeNull();
    expect(latest?.completedWork).toBe('Built migration engine and repository layer');
    expect(latest?.nextAction).toBe('Implement MCP endpoints and UI dashboard');
    expect(latest?.modifiedFiles).toContain('src/database/client.ts');
  });

  it('should generate human-readable markdown handoff', async () => {
    const report = await handoffEngine.recordHandoff({
      taskId,
      projectId,
      objective: 'Fix memory sync bug',
      completedWork: 'Added transaction around upsert operations',
      nextAction: 'Run integration test suite',
      agentIdentity: 'GeminiCLI',
    });

    const markdown = handoffEngine.generateMarkdownHandoff(report);
    expect(markdown).toContain('# Handoff Report: Task');
    expect(markdown).toContain('**From Agent**: GeminiCLI');
    expect(markdown).toContain('Added transaction around upsert operations');
    expect(markdown).toContain('Run integration test suite');
  });
});
