import { BaseRepository } from './base.repository.js';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskStep,
  TaskStepStatus,
  TaskBlocker,
  TaskFileRelation,
  TaskSymbolRelation,
  TaskSnapshot,
} from '../../core/types.js';
import { TaskNotFoundError, ValidationError } from '../../core/errors.js';
import { TaskStateMachine } from '../../tasks/task-state-machine.js';
import { randomUUID } from 'node:crypto';

export interface CreateTaskParams {
  id?: string;
  projectId: string;
  title: string;
  goal?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string;
  parentTaskId?: string;
}

export interface UpdateTaskParams {
  title?: string;
  goal?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  currentStep?: string;
  assignedAgent?: string;
  expectedVersion?: number;
}

export class TaskRepository extends BaseRepository {
  public create(params: CreateTaskParams): Task {
    if (!params.title || params.title.trim() === '') {
      throw new ValidationError('Task title cannot be empty');
    }

    const now = Date.now();
    const task: Task = {
      id: params.id ?? randomUUID(),
      projectId: params.projectId,
      title: params.title.trim(),
      goal: params.goal?.trim() || params.title.trim(),
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
        id, project_id, title, goal, description, status, priority,
        assigned_agent, parent_task_id, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.goal ?? null,
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

    // Validate lifecycle transition using TaskStateMachine
    TaskStateMachine.assertTransition(current.status, newStatus, taskId);

    const now = Date.now();
    const nextVersion = current.version + 1;
    let startedAt = current.startedAt;
    let completedAt = current.completedAt;

    if (newStatus === 'in_progress' && !startedAt) {
      startedAt = now;
    }
    if (newStatus === 'done') {
      completedAt = now;
    } else if (newStatus === 'in_progress' && current.status === 'done') {
      // Reopened task
      completedAt = undefined;
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, version = ?, started_at = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(newStatus, nextVersion, startedAt ?? null, completedAt ?? null, now, taskId, current.version);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Concurrent update detected while transitioning task ${taskId}`);
    }

    return {
      ...current,
      status: newStatus,
      startedAt,
      completedAt,
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
    const goal = updates.goal !== undefined ? updates.goal.trim() : current.goal;
    const description = updates.description !== undefined ? updates.description?.trim() : current.description;
    const priority = updates.priority !== undefined ? updates.priority : current.priority;
    const status = updates.status !== undefined ? updates.status : current.status;
    const currentStep = updates.currentStep !== undefined ? updates.currentStep.trim() : current.currentStep;
    const assignedAgent = updates.assignedAgent !== undefined ? updates.assignedAgent?.trim() : current.assignedAgent;

    let startedAt = current.startedAt;
    let completedAt = current.completedAt;
    if (status === 'in_progress' && !startedAt) {
      startedAt = now;
    } else if (status === 'done' && !completedAt) {
      completedAt = now;
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET title = ?, goal = ?, description = ?, priority = ?, status = ?, started_at = ?, completed_at = ?, current_step = ?, assigned_agent = ?, version = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = stmt.run(
      title,
      goal ?? null,
      description ?? null,
      priority,
      status,
      startedAt ?? null,
      completedAt ?? null,
      currentStep ?? null,
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
      goal,
      description,
      priority,
      status,
      startedAt,
      completedAt,
      currentStep,
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

  // --- Task Blockers Management ---
  public addBlocker(taskId: string, reason: string): TaskBlocker {
    if (!reason || reason.trim() === '') {
      throw new ValidationError('Blocker reason cannot be empty');
    }

    const current = this.findById(taskId);
    if (!current) {
      throw new TaskNotFoundError(taskId);
    }

    const now = Date.now();
    const blocker: TaskBlocker = {
      id: randomUUID(),
      taskId,
      reason: reason.trim(),
      resolved: false,
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_blockers (id, task_id, reason, resolved, created_at)
      VALUES (?, ?, ?, 0, ?)
    `);

    stmt.run(blocker.id, blocker.taskId, blocker.reason, blocker.createdAt);
    return blocker;
  }

  public resolveBlocker(blockerId: string): TaskBlocker {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE task_blockers
      SET resolved = 1, resolved_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(now, blockerId);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Blocker not found: ${blockerId}`);
    }

    const row = this.db.prepare('SELECT * FROM task_blockers WHERE id = ?').get(blockerId) as Record<string, unknown>;
    return {
      id: String(row['id']),
      taskId: String(row['task_id']),
      reason: String(row['reason']),
      resolved: Boolean(row['resolved']),
      resolvedAt: row['resolved_at'] ? Number(row['resolved_at']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }

  public listBlockers(taskId: string, onlyUnresolved = false): TaskBlocker[] {
    let sql = 'SELECT * FROM task_blockers WHERE task_id = ?';
    if (onlyUnresolved) {
      sql += ' AND resolved = 0';
    }
    sql += ' ORDER BY created_at ASC';

    const rows = this.db.prepare(sql).all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      taskId: String(r['task_id']),
      reason: String(r['reason']),
      resolved: Boolean(r['resolved']),
      resolvedAt: r['resolved_at'] ? Number(r['resolved_at']) : undefined,
      createdAt: Number(r['created_at']),
    }));
  }

  // --- Task Files Relation ---
  public attachFile(
    taskId: string,
    filePath: string,
    relationType: 'created' | 'modified' | 'referenced' = 'modified'
  ): TaskFileRelation {
    const now = Date.now();
    const relation: TaskFileRelation = {
      id: randomUUID(),
      taskId,
      filePath: filePath.trim(),
      relationType,
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_files (id, task_id, file_path, relation_type, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, file_path) DO UPDATE SET
        relation_type = excluded.relation_type
    `);

    stmt.run(relation.id, relation.taskId, relation.filePath, relation.relationType, relation.createdAt);
    return relation;
  }

  public listFiles(taskId: string): TaskFileRelation[] {
    const stmt = this.db.prepare('SELECT * FROM task_files WHERE task_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      taskId: String(r['task_id']),
      filePath: String(r['file_path']),
      relationType: r['relation_type'] as 'created' | 'modified' | 'referenced',
      createdAt: Number(r['created_at']),
    }));
  }

  // --- Task Symbols Relation ---
  public attachSymbol(taskId: string, symbolName: string, symbolId?: string): TaskSymbolRelation {
    const now = Date.now();
    const relation: TaskSymbolRelation = {
      id: randomUUID(),
      taskId,
      symbolId,
      symbolName: symbolName.trim(),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO task_symbols (id, task_id, symbol_id, symbol_name, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(task_id, symbol_name) DO NOTHING
    `);

    stmt.run(relation.id, relation.taskId, relation.symbolId ?? null, relation.symbolName, relation.createdAt);
    return relation;
  }

  public listSymbols(taskId: string): TaskSymbolRelation[] {
    const stmt = this.db.prepare('SELECT * FROM task_symbols WHERE task_id = ? ORDER BY created_at ASC');
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      taskId: String(r['task_id']),
      symbolId: r['symbol_id'] ? String(r['symbol_id']) : undefined,
      symbolName: String(r['symbol_name']),
      createdAt: Number(r['created_at']),
    }));
  }

  // --- Task Snapshots ---
  public saveSnapshot(taskId: string, snapshot: TaskSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT INTO task_snapshots (id, task_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(randomUUID(), taskId, JSON.stringify(snapshot), snapshot.timestamp);
  }

  public listSnapshots(taskId: string, limit = 20): TaskSnapshot[] {
    const stmt = this.db.prepare(`
      SELECT snapshot_json FROM task_snapshots
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(taskId, limit) as Array<{ snapshot_json: string }>;
    return rows.map((r) => JSON.parse(r.snapshot_json) as TaskSnapshot);
  }

  private mapRowToTask(row: Record<string, unknown>): Task {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      title: String(row['title']),
      goal: row['goal'] ? String(row['goal']) : undefined,
      description: row['description'] ? String(row['description']) : undefined,
      status: row['status'] as TaskStatus,
      priority: row['priority'] as TaskPriority,
      currentStep: row['current_step'] ? String(row['current_step']) : undefined,
      assignedAgent: row['assigned_agent'] ? String(row['assigned_agent']) : undefined,
      parentTaskId: row['parent_task_id'] ? String(row['parent_task_id']) : undefined,
      version: Number(row['version']),
      startedAt: row['started_at'] ? Number(row['started_at']) : undefined,
      completedAt: row['completed_at'] ? Number(row['completed_at']) : undefined,
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
