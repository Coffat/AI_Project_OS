import { BaseRepository } from './base.repository.js';
import { ExecutionSessionRecord, ExecutionSessionStatus } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateExecutionSessionParams {
  id?: string;
  projectId: string;
  taskId?: string;
  provider: string;
  agent: string;
  accountLabel?: string;
  startedAt?: number;
  status?: ExecutionSessionStatus;
  metadata?: Record<string, unknown>;
}

export class ExecutionSessionRepository extends BaseRepository {
  public createSession(params: CreateExecutionSessionParams): ExecutionSessionRecord {
    if (!params.provider || params.provider.trim() === '') {
      throw new ValidationError('Provider cannot be empty');
    }
    if (!params.agent || params.agent.trim() === '') {
      throw new ValidationError('Agent cannot be empty');
    }

    const now = Date.now();
    const session: ExecutionSessionRecord = {
      id: params.id ?? randomUUID(),
      projectId: params.projectId,
      taskId: params.taskId,
      provider: params.provider.trim(),
      agent: params.agent.trim(),
      accountLabel: params.accountLabel?.trim(),
      startedAt: params.startedAt ?? now,
      status: params.status ?? 'active',
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO execution_sessions (
        id, project_id, task_id, provider, agent, account_label,
        started_at, ended_at, status, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.projectId,
      session.taskId ?? null,
      session.provider,
      session.agent,
      session.accountLabel ?? null,
      session.startedAt,
      session.endedAt ?? null,
      session.status,
      this.serializeJson(session.metadata, '{}'),
      session.createdAt,
      session.updatedAt
    );

    return session;
  }

  public findById(id: string): ExecutionSessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM execution_sessions WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findActiveByTask(taskId: string): ExecutionSessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_sessions
      WHERE task_id = ? AND status = 'active'
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `);
    const row = stmt.get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findLatestByProject(projectId: string): ExecutionSessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_sessions
      WHERE project_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `);
    const row = stmt.get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findLatestActiveByProject(projectId: string): ExecutionSessionRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_sessions
      WHERE project_id = ? AND status = 'active'
      ORDER BY started_at DESC, rowid DESC
      LIMIT 1
    `);
    const row = stmt.get(projectId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public updateStatus(
    id: string,
    status: ExecutionSessionStatus,
    endedAt?: number
  ): ExecutionSessionRecord {
    const current = this.findById(id);
    if (!current) {
      throw new ValidationError(`Execution session not found: ${id}`);
    }

    const now = Date.now();
    const effectiveEndedAt =
      status === 'ended' || status === 'handoff'
        ? endedAt ?? current.endedAt ?? now
        : current.endedAt;

    const stmt = this.db.prepare(`
      UPDATE execution_sessions
      SET status = ?, ended_at = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, effectiveEndedAt ?? null, now, id);

    return this.findById(id)!;
  }

  public attachTask(id: string, taskId: string): ExecutionSessionRecord {
    const current = this.findById(id);
    if (!current) {
      throw new ValidationError(`Execution session not found: ${id}`);
    }

    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE execution_sessions
      SET task_id = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(taskId, now, id);

    return this.findById(id)!;
  }

  public listByTask(taskId: string): ExecutionSessionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_sessions
      WHERE task_id = ?
      ORDER BY started_at DESC, rowid DESC
    `);
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public listByProject(projectId: string, limit = 50): ExecutionSessionRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM execution_sessions
      WHERE project_id = ?
      ORDER BY started_at DESC, rowid DESC
      LIMIT ?
    `);
    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): ExecutionSessionRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      taskId: row['task_id'] ? String(row['task_id']) : undefined,
      provider: String(row['provider']),
      agent: String(row['agent']),
      accountLabel: row['account_label'] ? String(row['account_label']) : undefined,
      startedAt: Number(row['started_at']),
      endedAt: row['ended_at'] ? Number(row['ended_at']) : undefined,
      status: row['status'] as ExecutionSessionStatus,
      metadata: this.parseJson<Record<string, unknown> | undefined>(row['metadata_json'], undefined),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
