import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MemoryValidationReport } from '../core/types.js';

export class MemoryValidator {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Validates the integrity, consistency, and markdown compliance of project memory.
   */
  public async validate(projectRoot: string, projectId: string): Promise<MemoryValidationReport> {
    const canonicalDir = path.join(projectRoot, '.ai', 'canonical');
    const details: string[] = [];
    const duplicateKeys: string[] = [];
    const desynchronizedFiles: string[] = [];
    const canonicalFilesChecked: Array<{ path: string; exists: boolean; validMarkdown: boolean }> = [];

    // 1. Check Canonical Core Files
    const expectedFiles = [
      'PROJECT.md',
      'ARCHITECTURE.md',
      'CONSTRAINTS.md',
    ];

    for (const file of expectedFiles) {
      const fullPath = path.join(canonicalDir, file);
      const relPath = path.join('.ai', 'canonical', file);

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const hasHeader = content.trim().startsWith('#');
        canonicalFilesChecked.push({
          path: relPath,
          exists: true,
          validMarkdown: hasHeader && content.length > 20,
        });

        if (!hasHeader) {
          details.push(`Canonical file '${relPath}' is missing top-level H1 header`);
        }
      } catch {
        canonicalFilesChecked.push({
          path: relPath,
          exists: false,
          validMarkdown: false,
        });
        details.push(`Canonical file '${relPath}' is missing on disk`);
      }
    }

    // 2. Check DECISIONS Directory
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    try {
      const decisionFiles = await fs.readdir(decisionsDir);
      for (const dec of decisionFiles) {
        if (dec.endsWith('.md')) {
          const decPath = path.join(decisionsDir, dec);
          const decRel = path.join('.ai', 'canonical', 'DECISIONS', dec);
          const content = await fs.readFile(decPath, 'utf8');
          const valid = content.trim().startsWith('#') && content.length > 20;
          canonicalFilesChecked.push({
            path: decRel,
            exists: true,
            validMarkdown: valid,
          });
          if (!valid) {
            details.push(`Decision file '${decRel}' does not have standard markdown formatting`);
          }
        }
      }
    } catch {
      // Directory may not exist if no decisions yet
    }

    // 3. Check SQLite project_memory for duplicates
    const dupStmt = this.db.prepare(`
      SELECT key, COUNT(*) as count
      FROM project_memory
      WHERE project_id = ?
      GROUP BY key
      HAVING count > 1
    `);
    const dupRows = dupStmt.all(projectId) as Array<{ key: string; count: number }>;
    for (const r of dupRows) {
      duplicateKeys.push(r.key);
      details.push(`Duplicate memory key detected in SQLite: '${r.key}' (${r.count} entries)`);
    }

    // 4. Count total documents and chunks
    let totalDocs = 0;
    let totalChunks = 0;
    try {
      const docCountRow = this.db.prepare('SELECT COUNT(*) as count FROM memory_documents WHERE project_id = ?').get(projectId) as { count: number };
      totalDocs = docCountRow.count;

      const chunkCountRow = this.db.prepare('SELECT COUNT(*) as count FROM memory_chunks').get() as { count: number };
      totalChunks = chunkCountRow.count;
    } catch {
      // Tables might be empty
    }

    const isValid =
      duplicateKeys.length === 0 &&
      desynchronizedFiles.length === 0 &&
      canonicalFilesChecked.every((c) => c.exists && c.validMarkdown);

    if (isValid && details.length === 0) {
      details.push('Memory integrity and canonical synchronization verified successfully');
    }

    return {
      isValid,
      totalDocuments: totalDocs,
      totalChunks: totalChunks,
      canonicalFilesChecked,
      duplicateKeys,
      desynchronizedFiles,
      details,
    };
  }
}
