import { BaseRepository } from './base.repository.js';
import { HandoffRecord } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateHandoffParams {
  taskId: string;
  projectId: string;
  objective: string;
  completedWork: string;
  currentStep?: string;
  currentFile?: string;
  modifiedFiles?: string[];
  decisions?: string[];
  blockers?: string;
  errors?: string;
  tests?: string[];
  nextAction: string;
  gitState?: {
    commitHash?: string;
    branch?: string;
    isDirty?: boolean;
    untrackedFilesCount?: number;
  };
  agentIdentity: string;
}

export class HandoffRepository extends BaseRepository {
  public create(params: CreateHandoffParams): HandoffRecord {
    if (!params.objective || params.objective.trim() === '') {
      throw new ValidationError('Handoff objective cannot be empty');
    }
    if (!params.completedWork || params.completedWork.trim() === '') {
      throw new ValidationError('Handoff completedWork cannot be empty');
    }
    if (!params.nextAction || params.nextAction.trim() === '') {
      throw new ValidationError('Handoff nextAction cannot be empty');
    }
    if (!params.agentIdentity || params.agentIdentity.trim() === '') {
      throw new ValidationError('Handoff agentIdentity cannot be empty');
    }

    const now = Date.now();
    const record: HandoffRecord = {
      id: randomUUID(),
      taskId: params.taskId,
      projectId: params.projectId,
      objective: params.objective.trim(),
      completedWork: params.completedWork.trim(),
      currentStep: params.currentStep?.trim(),
      currentFile: params.currentFile?.trim(),
      modifiedFiles: params.modifiedFiles ?? [],
      decisions: params.decisions ?? [],
      blockers: params.blockers?.trim(),
      errors: params.errors?.trim(),
      tests: params.tests ?? [],
      nextAction: params.nextAction.trim(),
      gitState: params.gitState ?? {},
      agentIdentity: params.agentIdentity.trim(),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO handoffs (
        id, task_id, project_id, objective, completed_work, current_step, current_file,
        modified_files, decisions, blockers, errors, tests, next_action, git_state,
        agent_identity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.taskId,
      record.projectId,
      record.objective,
      record.completedWork,
      record.currentStep ?? null,
      record.currentFile ?? null,
      this.serializeJson(record.modifiedFiles, '[]'),
      this.serializeJson(record.decisions, '[]'),
      record.blockers ?? null,
      record.errors ?? null,
      this.serializeJson(record.tests, '[]'),
      record.nextAction,
      this.serializeJson(record.gitState, '{}'),
      record.agentIdentity,
      record.createdAt
    );

    return record;
  }

  public findById(id: string): HandoffRecord | null {
    const stmt = this.db.prepare('SELECT * FROM handoffs WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findLatestByTaskId(taskId: string): HandoffRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1'
    );
    const row = stmt.get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByTaskId(taskId: string): HandoffRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC'
    );
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public listByProjectId(projectId: string, limit = 50): HandoffRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM handoffs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'
    );
    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): HandoffRecord {
    return {
      id: String(row['id']),
      taskId: String(row['task_id']),
      projectId: String(row['project_id']),
      objective: String(row['objective']),
      completedWork: String(row['completed_work']),
      currentStep: row['current_step'] ? String(row['current_step']) : undefined,
      currentFile: row['current_file'] ? String(row['current_file']) : undefined,
      modifiedFiles: this.parseJson<string[]>(row['modified_files'], []),
      decisions: this.parseJson<string[]>(row['decisions'], []),
      blockers: row['blockers'] ? String(row['blockers']) : undefined,
      errors: row['errors'] ? String(row['errors']) : undefined,
      tests: this.parseJson<string[]>(row['tests'], []),
      nextAction: String(row['next_action']),
      gitState: this.parseJson(row['git_state'], {}),
      agentIdentity: String(row['agent_identity']),
      createdAt: Number(row['created_at']),
    };
  }
}
