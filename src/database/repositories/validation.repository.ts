import { BaseRepository } from './base.repository.js';
import {
  ValidationRunRecord,
  ValidationType,
  ValidationRunStatus,
} from '../../core/types.js';
import { SecurityGuard } from '../../core/security-guard.js';
import { randomUUID } from 'node:crypto';

export interface CreateValidationRunParams {
  projectId: string;
  taskId?: string;
  validatorType: ValidationType;
  status: ValidationRunStatus;
  results: Record<string, unknown>;
  runBy: string;
  command?: string;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  affectedFiles?: string[];
}

export class ValidationRepository extends BaseRepository {
  public recordValidationRun(params: CreateValidationRunParams): ValidationRunRecord {
    const now = Date.now();
    const sanitizedResults = SecurityGuard.sanitizePayload(params.results);
    const run: ValidationRunRecord = {
      id: randomUUID(),
      projectId: params.projectId,
      taskId: params.taskId,
      validatorType: params.validatorType,
      status: params.status,
      command: params.command,
      exitCode: params.exitCode,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt,
      affectedFiles: params.affectedFiles,
      resultsJson: this.serializeJson(sanitizedResults, '{}'),
      runBy: params.runBy.trim(),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO validation_runs (
        id, project_id, task_id, validator_type, status,
        command, exit_code, started_at, finished_at, affected_files_json,
        results_json, run_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      run.id,
      run.projectId,
      run.taskId ?? null,
      run.validatorType,
      run.status,
      run.command ?? null,
      run.exitCode ?? null,
      run.startedAt ?? null,
      run.finishedAt ?? null,
      run.affectedFiles ? JSON.stringify(run.affectedFiles) : null,
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

  public findLatestByTaskAndType(taskId: string, validatorType: ValidationType): ValidationRunRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM validation_runs WHERE task_id = ? AND validator_type = ? ORDER BY created_at DESC LIMIT 1'
    );
    const row = stmt.get(taskId, validatorType) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public updateStatus(id: string, status: ValidationRunStatus): void {
    const stmt = this.db.prepare(
      'UPDATE validation_runs SET status = ? WHERE id = ?'
    );
    stmt.run(status, id);
  }

  public listByProject(projectId: string, limit = 50): ValidationRunRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM validation_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    );
    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): ValidationRunRecord {
    let affectedFiles: string[] | undefined = undefined;
    if (row['affected_files_json']) {
      try {
        affectedFiles = JSON.parse(String(row['affected_files_json']));
      } catch {
        // Ignored
      }
    }

    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      taskId: row['task_id'] ? String(row['task_id']) : undefined,
      validatorType: row['validator_type'] as ValidationType,
      status: row['status'] as ValidationRunStatus,
      command: row['command'] ? String(row['command']) : undefined,
      exitCode: row['exit_code'] !== null && row['exit_code'] !== undefined ? Number(row['exit_code']) : undefined,
      startedAt: row['started_at'] !== null && row['started_at'] !== undefined ? Number(row['started_at']) : undefined,
      finishedAt: row['finished_at'] !== null && row['finished_at'] !== undefined ? Number(row['finished_at']) : undefined,
      affectedFiles,
      resultsJson: String(row['results_json']),
      runBy: String(row['run_by']),
      createdAt: Number(row['created_at']),
    };
  }
}
