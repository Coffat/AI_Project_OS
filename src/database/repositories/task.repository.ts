import { BaseRepository } from './base.repository.js';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskStep,
  TaskStepStatus,
} from '../../core/types.js';
import { TaskNotFoundError, ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateTaskParams {
  projectId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  parentTaskId?: string;
}

export interface UpdateTaskParams {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  expectedVersion?: number;
}

export class TaskRepository extends BaseRepository {
  private static readonly VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
    planned: ['in_progress', 'blocked'],
    in_progress: ['blocked', 'handoff', 'testing', 'done'],
    blocked: ['in_progress', 'resumed', 'handoff'],
    handoff: ['resumed', 'in_progress', 'blocked'],
    resumed: ['in_progress', 'testing', 'blocked'],
    testing: ['done', 'in_progress', 'blocked'],
    done: ['in_progress'], // Allowed to reopen if regressions occur
  };

  public create(params: CreateTaskParams): Task {
    if (!params.title || params.title.trim() === '') {
      throw new ValidationError('Task title cannot be empty');
    }

    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      projectId: params.projectId,
      title: params.title.trim(),
      description: params.description?.trim(),
      status: 'planned',
      priority: params.priority ?? 'medium',
      assignedAgent: params.assignedAgent?.trim(),
      parentTaskId: params.parentTaskId,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, status, priority,
        assigned_agent, parent_task_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.description ?? null,
      task.status,
      task.priority,
      task.assignedAgent ?? null,
      task.parentTaskId ?? null,
      task.version,
      task.createdAt,
      task.updatedAt
    );

    return task;
  }

  public findById(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToTask(row);
  }

  public listByProject(
    projectId: string,
    filter?: { status?: TaskStatus; priority?: TaskPriority }
  ): Task[] {
    let query = 'SELECT * FROM tasks WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.priority) {
      query += ' AND priority = ?';
      params.push(filter.priority);
    }

    query += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToTask(r));
  }

  public transitionStatus(
    taskId: string,
    newStatus: TaskStatus,
    options?: { expectedVersion?: number }
  ): Task {
    const current = this.findById(taskId);
    if (!current) {
      throw new TaskNotFoundError(taskId);
    }

    if (options?.expectedVersion !== undefined && current.version !== options.expectedVersion) {
      throw new ValidationError(
        `Optimistic lock failure: Task version mismatch (expected: ${options.expectedVersion}, actual: ${current.version})`
      );
    }

    // Validate lifecycle transition
    const allowed = TaskRepository.VALID_TRANSITIONS[current.status];
    if (!allowed.includes(newStatus)) {
      throw new ValidationError(
        `Invalid task lifecycle transition from '${current.status}' to '${newStatus}'`
      );
    }

    const now = Date.now();
    const nextVersion = current.version + 1;

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(newStatus, nextVersion, now, taskId, current.version);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Concurrent update detected while transitioning task ${taskId}`);
    }

    return {
      ...current,
      status: newStatus,
      version: nextVersion,
      updatedAt: now,
    };
  }

  public update(taskId: string, updates: UpdateTaskParams): Task {
    const current = this.findById(taskId);
    if (!current) {
      throw new TaskNotFoundError(taskId);
    }

    if (updates.expectedVersion !== undefined && current.version !== updates.expectedVersion) {
      throw new ValidationError(
        `Optimistic lock failure: Task version mismatch (expected: ${updates.expectedVersion}, actual: ${current.version})`
      );
    }

    const now = Date.now();
    const nextVersion = current.version + 1;
    const title = updates.title !== undefined ? updates.title.trim() : current.title;
    const description = updates.description !== undefined ? updates.description?.trim() : current.description;
    const priority = updates.priority !== undefined ? updates.priority : current.priority;
    const assignedAgent = updates.assignedAgent !== undefined ? updates.assignedAgent?.trim() : current.assignedAgent;

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, priority = ?, assigned_agent = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(
      title,
      description ?? null,
      priority,
      assignedAgent ?? null,
      nextVersion,
      now,
      taskId,
      current.version
    );

    if (Number(result.changes) === 0) {
      throw new ValidationError(`Concurrent update detected on task ${taskId}`);
    }

    return {
      ...current,
      title,
      description,
      priority,
      assignedAgent,
      version: nextVersion,
      updatedAt: now,
    };
  }

  // --- Task Steps Management ---
  public addStep(taskId: string, title: string, stepOrder: number): TaskStep {
    const current = this.findById(taskId);
    if (!current) {
      throw new TaskNotFoundError(taskId);
    }

    const now = Date.now();
    const step: TaskStep = {
      id: randomUUID(),
      taskId,
      stepOrder,
      title: title.trim(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_steps (id, task_id, step_order, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(step.id, step.taskId, step.stepOrder, step.title, step.status, step.createdAt, step.updatedAt);
    return step;
  }

  public updateStepStatus(stepId: string, status: TaskStepStatus, resultSummary?: string): TaskStep {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE task_steps
      SET status = ?, result_summary = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(status, resultSummary ?? null, now, stepId);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Task step not found: ${stepId}`);
    }

    const getStmt = this.db.prepare('SELECT * FROM task_steps WHERE id = ?');
    const row = getStmt.get(stepId) as Record<string, unknown>;
    return this.mapRowToStep(row);
  }

  public listSteps(taskId: string): TaskStep[] {
    const stmt = this.db.prepare('SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order ASC');
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToStep(r));
  }

  private mapRowToTask(row: Record<string, unknown>): Task {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      title: String(row['title']),
      description: row['description'] ? String(row['description']) : undefined,
      status: row['status'] as TaskStatus,
      priority: row['priority'] as TaskPriority,
      assignedAgent: row['assigned_agent'] ? String(row['assigned_agent']) : undefined,
      parentTaskId: row['parent_task_id'] ? String(row['parent_task_id']) : undefined,
      version: Number(row['version']),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  private mapRowToStep(row: Record<string, unknown>): TaskStep {
    return {
      id: String(row['id']),
      taskId: String(row['task_id']),
      stepOrder: Number(row['step_order']),
      title: String(row['title']),
      status: row['status'] as TaskStepStatus,
      resultSummary: row['result_summary'] ? String(row['result_summary']) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
