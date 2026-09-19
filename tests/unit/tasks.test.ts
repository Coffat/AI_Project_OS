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

  it('should create a new task in planned status', async () => {
    const task = await taskEngine.createTask({
      projectId,
      title: 'Implement Task Engine',
      description: 'Create lifecycle logic for tasks',
      priority: 'high',
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Implement Task Engine');
    expect(task.status).toBe('planned');
    expect(task.priority).toBe('high');
    expect(task.version).toBe(1);
  });

  it('should reject task creation with empty title', async () => {
    await expect(
      taskEngine.createTask({
        projectId,
        title: '   ',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should update task status following valid transitions', async () => {
    const task = await taskEngine.createTask({
      projectId,
      title: 'Update Status Test',
    });

    // planned -> in_progress
    const updated = await taskEngine.updateTaskStatus(task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');
    expect(updated.version).toBe(2);

    const fetched = await taskEngine.getTask(task.id);
    expect(fetched.status).toBe('in_progress');
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
