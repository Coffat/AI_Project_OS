import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { HandoffEngine } from '../../src/handoff/handoff-engine.js';
import { TaskEngine } from '../../src/tasks/task-engine.js';

describe('HandoffEngine', () => {
  let client: SQLiteDatabaseClient;
  let handoffEngine: HandoffEngine;
  let taskEngine: TaskEngine;
  let taskId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    client.initializeSchema();

    client.db.prepare(`
      INSERT INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('p1', 'Test Project', '/test', Date.now(), Date.now());

    taskEngine = new TaskEngine(client.db);
    const task = await taskEngine.createTask({
      projectId: 'p1',
      title: 'Handoff Test Task',
    });
    taskId = task.id;

    handoffEngine = new HandoffEngine(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('should record and retrieve latest handoff', async () => {
    const report = await handoffEngine.recordHandoff({
      taskId,
      fromAgent: 'ClaudeCode',
      statusSummary: 'Scaffolded core engines and tested database.',
      blockers: 'None',
      nextSteps: 'Implement MCP endpoints and UI dashboard.',
    });

    expect(report.id).toBeDefined();
    expect(report.fromAgent).toBe('ClaudeCode');

    const latest = await handoffEngine.getLatestHandoff(taskId);
    expect(latest).not.toBeNull();
    expect(latest?.statusSummary).toBe('Scaffolded core engines and tested database.');
    expect(latest?.nextSteps).toBe('Implement MCP endpoints and UI dashboard.');
  });

  it('should generate human-readable markdown handoff', async () => {
    const report = await handoffEngine.recordHandoff({
      taskId,
      fromAgent: 'GeminiCLI',
      statusSummary: 'Fixed memory sync bug',
      nextSteps: 'Run integration test suite',
    });

    const markdown = handoffEngine.generateMarkdownHandoff(report);
    expect(markdown).toContain('# Handoff Report: Task');
    expect(markdown).toContain('**From Agent**: GeminiCLI');
    expect(markdown).toContain('Fixed memory sync bug');
    expect(markdown).toContain('Run integration test suite');
  });
});
