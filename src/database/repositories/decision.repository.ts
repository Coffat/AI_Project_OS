import { BaseRepository } from './base.repository.js';
import { DecisionRecord, DecisionStatus } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateDecisionParams {
  projectId: string;
  taskId?: string;
  title: string;
  context: string;
  decisionRationale: string;
  consequences?: string;
  status?: DecisionStatus;
  sourceFile?: string;
}

export class DecisionRepository extends BaseRepository {
  public create(params: CreateDecisionParams): DecisionRecord {
    if (!params.title || params.title.trim() === '') {
      throw new ValidationError('Decision title cannot be empty');
    }
    if (!params.context || params.context.trim() === '') {
      throw new ValidationError('Decision context cannot be empty');
    }
    if (!params.decisionRationale || params.decisionRationale.trim() === '') {
      throw new ValidationError('Decision rationale cannot be empty');
    }

    const now = Date.now();
    const decision: DecisionRecord = {
      id: randomUUID(),
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title.trim(),
      context: params.context.trim(),
      decisionRationale: params.decisionRationale.trim(),
      consequences: params.consequences?.trim(),
      status: params.status ?? 'proposed',
      sourceFile: params.sourceFile?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO decisions (
        id, project_id, task_id, title, context, decision_rationale,
        consequences, status, source_file, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      decision.id,
      decision.projectId,
      decision.taskId ?? null,
      decision.title,
      decision.context,
      decision.decisionRationale,
      decision.consequences ?? null,
      decision.status,
      decision.sourceFile ?? null,
      decision.createdAt,
      decision.updatedAt
    );

    return decision;
  }

  public findById(id: string): DecisionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM decisions WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByProject(projectId: string, status?: DecisionStatus): DecisionRecord[] {
    let sql = 'SELECT * FROM decisions WHERE project_id = ?';
    const params: string[] = [projectId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public updateStatus(id: string, status: DecisionStatus): DecisionRecord {
    const now = Date.now();
    const stmt = this.db.prepare(
      'UPDATE decisions SET status = ?, updated_at = ? WHERE id = ?'
    );
    const result = stmt.run(status, now, id);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Decision not found: ${id}`);
    }

    const updated = this.findById(id);
    return updated!;
  }

  private mapRow(row: Record<string, unknown>): DecisionRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      taskId: row['task_id'] ? String(row['task_id']) : undefined,
      title: String(row['title']),
      context: String(row['context']),
      decisionRationale: String(row['decision_rationale']),
      consequences: row['consequences'] ? String(row['consequences']) : undefined,
      status: row['status'] as DecisionStatus,
      sourceFile: row['source_file'] ? String(row['source_file']) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
