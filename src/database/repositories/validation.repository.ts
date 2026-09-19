import { BaseRepository } from './base.repository.js';
import {
  ValidationRunRecord,
  ValidationType,
  ValidationRunStatus,
} from '../../core/types.js';
import { randomUUID } from 'node:crypto';

export interface CreateValidationRunParams {
  projectId: string;
  taskId?: string;
  validatorType: ValidationType;
  status: ValidationRunStatus;
  results: Record<string, unknown>;
  runBy: string;
}

export class ValidationRepository extends BaseRepository {
  public recordValidationRun(params: CreateValidationRunParams): ValidationRunRecord {
    const now = Date.now();
    const run: ValidationRunRecord = {
      id: randomUUID(),
      projectId: params.projectId,
      taskId: params.taskId,
      validatorType: params.validatorType,
      status: params.status,
      resultsJson: this.serializeJson(params.results, '{}'),
      runBy: params.runBy.trim(),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO validation_runs (id, project_id, task_id, validator_type, status, results_json, run_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.projectId,
      run.taskId ?? null,
      run.validatorType,
      run.status,
      run.resultsJson,
      run.runBy,
      run.createdAt
    );

    return run;
  }

  public listByTask(taskId: string): ValidationRunRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM validation_runs WHERE task_id = ? ORDER BY created_at DESC'
    );
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public listByProject(projectId: string, limit = 50): ValidationRunRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM validation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    );
    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): ValidationRunRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      taskId: row['task_id'] ? String(row['task_id']) : undefined,
      validatorType: row['validator_type'] as ValidationType,
      status: row['status'] as ValidationRunStatus,
      resultsJson: String(row['results_json']),
      runBy: String(row['run_by']),
      createdAt: Number(row['created_at']),
    };
  }
}
