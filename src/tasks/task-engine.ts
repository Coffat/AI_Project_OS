import type { DatabaseSync } from 'node:sqlite';
import { Task, TaskStatus, TaskPriority, TaskCheckpoint } from '../core/types.js';
import { TaskNotFoundError, ValidationError } from '../core/errors.js';
import { globalEventBus } from '../core/events.js';
import { TaskRepository, CreateTaskParams } from '../database/repositories/task.repository.js';
import { randomUUID } from 'node:crypto';

export interface CreateTaskDTO {
  projectId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  parentTaskId?: string;
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
  private readonly repo: TaskRepository;

  constructor(private readonly db: DatabaseSync) {
    this.repo = new TaskRepository(db);
  }

  public async createTask(dto: CreateTaskDTO): Promise<Task> {
    const task = this.repo.create(dto as CreateTaskParams);
    await globalEventBus.publish('task:created', task);
    return task;
  }

  public async getTask(taskId: string): Promise<Task> {
    const task = this.repo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  public async updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
    const previous = await this.getTask(taskId);
    const updated = this.repo.transitionStatus(taskId, status);
    await globalEventBus.publish('task:status_changed', {
      taskId,
      previous: previous.status,
      current: status,
    });
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
    if (filter?.projectId) {
      return this.repo.listByProject(filter.projectId, { status: filter.status });
    }
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    query += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((r) => ({
      id: String(r['id']),
      projectId: String(r['project_id']),
      title: String(r['title']),
      description: r['description'] ? String(r['description']) : undefined,
      status: r['status'] as TaskStatus,
      priority: r['priority'] as TaskPriority,
      assignedAgent: r['assigned_agent'] ? String(r['assigned_agent']) : undefined,
      parentTaskId: r['parent_task_id'] ? String(r['parent_task_id']) : undefined,
      version: Number(r['version']),
      createdAt: Number(r['created_at']),
      updatedAt: Number(r['updated_at']),
    }));
  }
}
