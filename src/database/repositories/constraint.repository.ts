import { BaseRepository } from './base.repository.js';
import { ConstraintRecord, ConstraintCategory, ConstraintEnforcement } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateConstraintParams {
  id?: string;
  projectId: string;
  category: ConstraintCategory;
  title: string;
  ruleContent: string;
  enforcementLevel?: ConstraintEnforcement;
  sourceFile?: string;
}

export class ConstraintRepository extends BaseRepository {
  public create(params: CreateConstraintParams): ConstraintRecord {
    if (!params.title || params.title.trim() === '') {
      throw new ValidationError('Constraint title cannot be empty');
    }
    if (!params.ruleContent || params.ruleContent.trim() === '') {
      throw new ValidationError('Constraint ruleContent cannot be empty');
    }

    const now = Date.now();
    const constraint: ConstraintRecord = {
      id: params.id ?? randomUUID(),
      projectId: params.projectId,
      category: params.category,
      title: params.title.trim(),
      ruleContent: params.ruleContent.trim(),
      enforcementLevel: params.enforcementLevel ?? 'mandatory',
      sourceFile: params.sourceFile?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO constraints (
        id, project_id, category, title, rule_content,
        enforcement_level, source_file, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      constraint.id,
      constraint.projectId,
      constraint.category,
      constraint.title,
      constraint.ruleContent,
      constraint.enforcementLevel,
      constraint.sourceFile ?? null,
      constraint.createdAt,
      constraint.updatedAt
    );

    return constraint;
  }

  public findById(id: string): ConstraintRecord | null {
    const stmt = this.db.prepare('SELECT * FROM constraints WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByProject(projectId: string, category?: ConstraintCategory): ConstraintRecord[] {
    let sql = 'SELECT * FROM constraints WHERE project_id = ?';
    const params: string[] = [projectId];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY created_at DESC';
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): ConstraintRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      category: row['category'] as ConstraintCategory,
      title: String(row['title']),
      ruleContent: String(row['rule_content']),
      enforcementLevel: row['enforcement_level'] as ConstraintEnforcement,
      sourceFile: row['source_file'] ? String(row['source_file']) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
