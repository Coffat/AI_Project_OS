import { BaseRepository } from './base.repository.js';
import { ProjectInfo } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export class ProjectRepository extends BaseRepository {
  public create(data: { name: string; rootPath: string; description?: string }): ProjectInfo {
    if (!data.name || data.name.trim() === '') {
      throw new ValidationError('Project name cannot be empty');
    }
    if (!data.rootPath || data.rootPath.trim() === '') {
      throw new ValidationError('Project rootPath cannot be empty');
    }

    const now = Date.now();
    const project: ProjectInfo = {
      id: randomUUID(),
      name: data.name.trim(),
      rootPath: data.rootPath.trim(),
      description: data.description?.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, root_path, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      project.id,
      project.name,
      project.rootPath,
      project.description ?? null,
      project.createdAt,
      project.updatedAt
    );

    return project;
  }

  public findById(id: string): ProjectInfo | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public findByRootPath(rootPath: string): ProjectInfo | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE root_path = ?');
    const row = stmt.get(rootPath) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public list(): ProjectInfo[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?');
    const result = stmt.run(id);
    return Number(result.changes) > 0;
  }

  private mapRow(row: Record<string, unknown>): ProjectInfo {
    return {
      id: String(row['id']),
      name: String(row['name']),
      rootPath: String(row['root_path']),
      description: row['description'] ? String(row['description']) : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
