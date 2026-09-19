import type { DatabaseSync } from 'node:sqlite';
import { Task, TaskStatus, TaskPriority, TaskCheckpoint } from '../core/types.js';
import { TaskNotFoundError, ValidationError } from '../core/errors.js';
import { globalEventBus } from '../core/events.js';
import { randomUUID } from 'node:crypto';

export interface CreateTaskDTO {
  projectId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  parentTaskId?: string;
  acceptanceCriteria?: string;
}

export interface ITaskEngine {
  createTask(dto: CreateTaskDTO): Promise<Task>;
  getTask(taskId: string): Promise<Task>;
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task>;
  createCheckpoint(
    taskId: string,
    summary: string,
    agentIdentity: string,
    gitCommitHash?: string
  ): Promise<TaskCheckpoint>;
  listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]>;
}

export class TaskEngine implements ITaskEngine {
  constructor(private readonly db: DatabaseSync) {}

  public async createTask(dto: CreateTaskDTO): Promise<Task> {
    if (!dto.title || dto.title.trim() === '') {
      throw new ValidationError('Task title cannot be empty');
    }

    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      projectId: dto.projectId,
      title: dto.title.trim(),
      description: dto.description,
      status: 'BACKLOG',
      assignedAgent: dto.assignedAgent,
      priority: dto.priority ?? 'MEDIUM',
      parentTaskId: dto.parentTaskId,
      acceptanceCriteria: dto.acceptanceCriteria,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, status, assigned_agent, priority,
        parent_task_id, acceptance_criteria, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.description ?? null,
      task.status,
      task.assignedAgent ?? null,
      task.priority,
      task.parentTaskId ?? null,
      task.acceptanceCriteria ?? null,
      task.createdAt,
      task.updatedAt
    );

    await globalEventBus.publish('task:created', task);
    return task;
  }

  public async getTask(taskId: string): Promise<Task> {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(taskId) as Record<string, unknown> | undefined;

    if (!row) {
      throw new TaskNotFoundError(taskId);
    }

    return this.mapRowToTask(row);
  }

  public async updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
    const existing = await this.getTask(taskId);
    const now = Date.now();

    const stmt = this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, now, taskId);

    const updated: Task = {
      ...existing,
      status,
      updatedAt: now,
    };

    await globalEventBus.publish('task:status_changed', { taskId, previous: existing.status, current: status });
    return updated;
  }

  public async createCheckpoint(
    taskId: string,
    summary: string,
    agentIdentity: string,
    gitCommitHash?: string
  ): Promise<TaskCheckpoint> {
    // Verify task exists
    await this.getTask(taskId);

    if (!summary || summary.trim() === '') {
      throw new ValidationError('Checkpoint summary cannot be empty');
    }

    const checkpoint: TaskCheckpoint = {
      id: randomUUID(),
      taskId,
      summary: summary.trim(),
      gitCommitHash,
      agentIdentity,
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_checkpoints (id, task_id, summary, git_commit_hash, agent_identity, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.taskId,
      checkpoint.summary,
      checkpoint.gitCommitHash ?? null,
      checkpoint.agentIdentity,
      checkpoint.createdAt
    );

    await globalEventBus.publish('task:checkpoint_created', checkpoint);
    return checkpoint;
  }

  public async listTasks(filter?: { status?: TaskStatus; projectId?: string }): Promise<Task[]> {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.projectId) {
      query += ' AND project_id = ?';
      params.push(filter.projectId);
    }

    query += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((r) => this.mapRowToTask(r));
  }

  private mapRowToTask(row: Record<string, unknown>): Task {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      title: String(row['title']),
      description: row['description'] ? String(row['description']) : undefined,
      status: row['status'] as TaskStatus,
      assignedAgent: row['assigned_agent'] ? String(row['assigned_agent']) : undefined,
      priority: row['priority'] as TaskPriority,
      parentTaskId: row['parent_task_id'] ? String(row['parent_task_id']) : undefined,
      acceptanceCriteria: row['acceptance_criteria'] ? String(row['acceptance_criteria']) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
