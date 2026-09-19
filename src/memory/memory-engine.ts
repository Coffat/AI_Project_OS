import type { DatabaseSync } from 'node:sqlite';
import { MemoryItem, MemoryCategory } from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import { globalEventBus } from '../core/events.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface IMemoryEngine {
  syncCanonicalDocs(projectRoot: string, projectId: string): Promise<number>;
  searchMemory(query: string, category?: MemoryCategory): Promise<MemoryItem[]>;
  recordLesson(projectId: string, title: string, content: string, sourceTask: string): Promise<MemoryItem>;
  getMemoryByKey(projectId: string, key: string): Promise<MemoryItem | null>;
}

export class MemoryEngine implements IMemoryEngine {
  constructor(private readonly db: DatabaseSync) {}

  public async syncCanonicalDocs(projectRoot: string, projectId: string): Promise<number> {
    const canonicalDir = path.join(projectRoot, '.ai', 'canonical');
    let syncedCount = 0;

    try {
      await fs.access(canonicalDir);
    } catch {
      return 0;
    }

    const filesToScan: Array<{ file: string; category: MemoryCategory; key: string }> = [
      { file: 'PROJECT.md', category: 'ARCHITECTURE', key: 'canonical:project' },
      { file: 'CONSTITUTION.md', category: 'CONSTITUTION', key: 'canonical:constitution' },
      { file: 'ARCHITECTURE.md', category: 'ARCHITECTURE', key: 'canonical:architecture' },
      { file: 'CONSTRAINTS.md', category: 'CONSTRAINT', key: 'canonical:constraints' },
    ];

    for (const item of filesToScan) {
      const fullPath = path.join(canonicalDir, item.file);
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        await this.upsertMemoryItem({
          id: randomUUID(),
          projectId,
          category: item.category,
          key: item.key,
          title: item.file.replace('.md', ''),
          content,
          sourceFile: path.relative(projectRoot, fullPath),
          version: 1,
          updatedAt: Date.now(),
        });
        syncedCount++;
      } catch {
        // Skip missing files
      }
    }

    // Scan DECISIONS directory if present
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    try {
      const decisionFiles = await fs.readdir(decisionsDir);
      for (const decFile of decisionFiles) {
        if (decFile.endsWith('.md')) {
          const decPath = path.join(decisionsDir, decFile);
          const decContent = await fs.readFile(decPath, 'utf8');
          await this.upsertMemoryItem({
            id: randomUUID(),
            projectId,
            category: 'DECISION',
            key: `decision:${decFile.replace('.md', '')}`,
            title: decFile.replace('.md', ''),
            content: decContent,
            sourceFile: path.relative(projectRoot, decPath),
            version: 1,
            updatedAt: Date.now(),
          });
          syncedCount++;
        }
      }
    } catch {
      // DECISIONS directory might not exist yet
    }

    return syncedCount;
  }

  public async searchMemory(query: string, category?: MemoryCategory): Promise<MemoryItem[]> {
    if (!query || query.trim() === '') return [];

    let sql = `
      SELECT m.* FROM project_memory m
      JOIN fts_project_memory fts ON m.id = fts.memory_id
      WHERE fts_project_memory MATCH ?
    `;
    const params: (string | number)[] = [query];

    if (category) {
      sql += ' AND m.category = ?';
      params.push(category);
    }

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return rows.map((r) => this.mapRowToMemory(r));
    } catch {
      // Fallback to LIKE if FTS fails or expression syntax is raw
      let fallbackSql = 'SELECT * FROM project_memory WHERE (title LIKE ? OR content LIKE ?)';
      const fallbackParams: (string | number)[] = [`%${query}%`, `%${query}%`];
      if (category) {
        fallbackSql += ' AND category = ?';
        fallbackParams.push(category);
      }
      const stmt = this.db.prepare(fallbackSql);
      const rows = stmt.all(...fallbackParams) as Record<string, unknown>[];
      return rows.map((r) => this.mapRowToMemory(r));
    }
  }

  public async recordLesson(
    projectId: string,
    title: string,
    content: string,
    sourceTask: string
  ): Promise<MemoryItem> {
    if (!title || title.trim() === '') {
      throw new ValidationError('Lesson title is required');
    }

    const item: MemoryItem = {
      id: randomUUID(),
      projectId,
      category: 'LESSON',
      key: `lesson:${sourceTask}:${Date.now()}`,
      title: title.trim(),
      content: content.trim(),
      sourceFile: `.ai/canonical/DECISIONS/${title.toLowerCase().replace(/\s+/g, '-')}.md`,
      version: 1,
      updatedAt: Date.now(),
    };

    await this.upsertMemoryItem(item);
    await globalEventBus.publish('memory:lesson_recorded', item);
    return item;
  }

  public async getMemoryByKey(projectId: string, key: string): Promise<MemoryItem | null> {
    const stmt = this.db.prepare('SELECT * FROM project_memory WHERE project_id = ? AND key = ?');
    const row = stmt.get(projectId, key) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToMemory(row);
  }

  private async upsertMemoryItem(item: MemoryItem): Promise<void> {
    const existing = await this.getMemoryByKey(item.projectId, item.key);
    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE project_memory
        SET title = ?, content = ?, source_file = ?, version = version + 1, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(item.title, item.content, item.sourceFile, item.updatedAt, existing.id);

      // Update FTS
      try {
        const ftsDelete = this.db.prepare('DELETE FROM fts_project_memory WHERE memory_id = ?');
        ftsDelete.run(existing.id);
        const ftsInsert = this.db.prepare(`
          INSERT INTO fts_project_memory (memory_id, title, content, category, source_file)
          VALUES (?, ?, ?, ?, ?)
        `);
        ftsInsert.run(existing.id, item.title, item.content, item.category, item.sourceFile);
      } catch {
        // Ignore FTS sync error in fallback
      }
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO project_memory (id, project_id, category, key, title, content, source_file, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        item.id,
        item.projectId,
        item.category,
        item.key,
        item.title,
        item.content,
        item.sourceFile,
        item.version,
        item.updatedAt
      );

      // Insert FTS
      try {
        const ftsInsert = this.db.prepare(`
          INSERT INTO fts_project_memory (memory_id, title, content, category, source_file)
          VALUES (?, ?, ?, ?, ?)
        `);
        ftsInsert.run(item.id, item.title, item.content, item.category, item.sourceFile);
      } catch {
        // Ignore FTS sync error in fallback
      }
    }
  }

  private mapRowToMemory(row: Record<string, unknown>): MemoryItem {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      category: row['category'] as MemoryCategory,
      key: String(row['key']),
      title: String(row['title']),
      content: String(row['content']),
      sourceFile: String(row['source_file']),
      version: Number(row['version']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
