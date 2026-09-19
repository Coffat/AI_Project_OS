import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { TaskEngine } from '../../src/tasks/task-engine.js';
import { TaskNotFoundError, ValidationError } from '../../src/core/errors.js';

describe('TaskEngine', () => {
  let client: SQLiteDatabaseClient;
  let taskEngine: TaskEngine;
  const projectId = 'proj-test-1';

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    client.initializeSchema();

    // Insert sample project
    client.db.prepare(`
      INSERT INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, 'Test Project', '/path/to/project', Date.now(), Date.now());

    taskEngine = new TaskEngine(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('should create a new task in BACKLOG status', async () => {
    const task = await taskEngine.createTask({
      projectId,
      title: 'Implement Task Engine',
      description: 'Create lifecycle logic for tasks',
      priority: 'HIGH',
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Implement Task Engine');
    expect(task.status).toBe('BACKLOG');
    expect(task.priority).toBe('HIGH');
  });

  it('should reject task creation with empty title', async () => {
    await expect(
      taskEngine.createTask({
        projectId,
        title: '   ',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should update task status', async () => {
    const task = await taskEngine.createTask({
      projectId,
      title: 'Update Status Test',
    });

    const updated = await taskEngine.updateTaskStatus(task.id, 'IN_PROGRESS');
    expect(updated.status).toBe('IN_PROGRESS');

    const fetched = await taskEngine.getTask(task.id);
    expect(fetched.status).toBe('IN_PROGRESS');
  });

  it('should throw TaskNotFoundError when getting non-existent task', async () => {
    await expect(taskEngine.getTask('invalid-id')).rejects.toThrow(TaskNotFoundError);
  });

  it('should create and associate checkpoints', async () => {
    const task = await taskEngine.createTask({
      projectId,
      title: 'Checkpoint Test',
    });

    const checkpoint = await taskEngine.createCheckpoint(
      task.id,
      'Completed unit tests',
      'Antigravity',
      'c0ffee'
    );

    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.taskId).toBe(task.id);
    expect(checkpoint.summary).toBe('Completed unit tests');
    expect(checkpoint.gitCommitHash).toBe('c0ffee');
  });
});
