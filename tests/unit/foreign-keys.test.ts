import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  DecisionRepository,
} from '../../src/database/repositories/index.js';

describe('Foreign Key Integrity & Cascades', () => {
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let decisionRepo: DecisionRepository;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('should reject records with non-existent foreign keys', () => {
    expect(() => {
      taskRepo.create({
        projectId: 'non-existent-proj',
        title: 'Orphan Task',
      });
    }).toThrow();
  });

  it('should cascade delete child tasks, steps, handoffs, and decisions when project is deleted', () => {
    const project = projectRepo.create({
      name: 'Cascade Test Project',
      rootPath: '/cascade/test',
    });

    const task = taskRepo.create({
      projectId: project.id,
      title: 'Parent Task',
    });

    taskRepo.addStep(task.id, 'Step 1', 1);

    handoffRepo.create({
      taskId: task.id,
      projectId: project.id,
      objective: 'Objective',
      completedWork: 'Work done',
      nextAction: 'Next action',
      agentIdentity: 'AgentA',
    });

    decisionRepo.create({
      projectId: project.id,
      taskId: task.id,
      title: 'ADR-001',
      context: 'Context',
      decisionRationale: 'Rationale',
    });

    // Verify entities exist
    expect(taskRepo.findById(task.id)).not.toBeNull();
    expect(taskRepo.listSteps(task.id)).toHaveLength(1);
    expect(handoffRepo.findLatestByTaskId(task.id)).not.toBeNull();
    expect(decisionRepo.listByProject(project.id)).toHaveLength(1);

    // Delete project
    projectRepo.delete(project.id);

    // Verify cascade deleted everything belonging to the project
    expect(projectRepo.findById(project.id)).toBeNull();
    expect(taskRepo.findById(task.id)).toBeNull();
    expect(taskRepo.listSteps(task.id)).toHaveLength(0);
    expect(handoffRepo.findLatestByTaskId(task.id)).toBeNull();
    expect(decisionRepo.listByProject(project.id)).toHaveLength(0);
  });

  it('should set parent_task_id to null when parent task is deleted', () => {
    const project = projectRepo.create({
      name: 'Subtask Test Project',
      rootPath: '/subtask/test',
    });

    const parentTask = taskRepo.create({
      projectId: project.id,
      title: 'Parent Task',
    });

    const subTask = taskRepo.create({
      projectId: project.id,
      title: 'Child Subtask',
      parentTaskId: parentTask.id,
    });

    expect(taskRepo.findById(subTask.id)?.parentTaskId).toBe(parentTask.id);

    // Delete parent task
    client.db.prepare('DELETE FROM tasks WHERE id = ?').run(parentTask.id);

    // Child task should still exist, with parentTaskId set to null
    const updatedSubTask = taskRepo.findById(subTask.id);
    expect(updatedSubTask).not.toBeNull();
    expect(updatedSubTask?.parentTaskId).toBeUndefined();
  });
});
