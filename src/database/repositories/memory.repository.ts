import { BaseRepository } from './base.repository.js';
import { MemoryDocument, MemoryChunk, MemoryDocType } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface UpsertDocumentParams {
  projectId: string;
  docType: MemoryDocType;
  path: string;
  title: string;
  contentHash: string;
  rawContent: string;
}

export interface SaveChunkParams {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadata?: Record<string, unknown>;
}

export class MemoryRepository extends BaseRepository {
  public upsertDocument(params: UpsertDocumentParams): MemoryDocument {
    if (!params.path || params.path.trim() === '') {
      throw new ValidationError('Document path cannot be empty');
    }

    const now = Date.now();
    const existing = this.findDocumentByPath(params.projectId, params.path);

    if (existing) {
      const nextVersion = existing.version + 1;
      const stmt = this.db.prepare(`
        UPDATE memory_documents
        SET doc_type = ?, title = ?, content_hash = ?, raw_content = ?, version = ?, updated_at = ?
        WHERE id = ?
      `);

      stmt.run(
        params.docType,
        params.title,
        params.contentHash,
        params.rawContent,
        nextVersion,
        now,
        existing.id
      );

      return {
        ...existing,
        docType: params.docType,
        title: params.title,
        contentHash: params.contentHash,
        rawContent: params.rawContent,
        version: nextVersion,
        updatedAt: now,
      };
    }

    const doc: MemoryDocument = {
      id: randomUUID(),
      projectId: params.projectId,
      docType: params.docType,
      path: params.path.trim(),
      title: params.title.trim(),
      contentHash: params.contentHash,
      rawContent: params.rawContent,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO memory_documents (
        id, project_id, doc_type, path, title, content_hash, raw_content, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.id,
      doc.projectId,
      doc.docType,
      doc.path,
      doc.title,
      doc.contentHash,
      doc.rawContent,
      doc.version,
      doc.createdAt,
      doc.updatedAt
    );

    return doc;
  }

  public findDocumentById(id: string): MemoryDocument | null {
    const stmt = this.db.prepare('SELECT * FROM memory_documents WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToDocument(row);
  }

  public findDocumentByPath(projectId: string, path: string): MemoryDocument | null {
    const stmt = this.db.prepare(
      'SELECT * FROM memory_documents WHERE project_id = ? AND path = ?'
    );
    const row = stmt.get(projectId, path) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRowToDocument(row);
  }

  public listDocuments(projectId: string, docType?: MemoryDocType): MemoryDocument[] {
    let sql = 'SELECT * FROM memory_documents WHERE project_id = ?';
    const params: string[] = [projectId];

    if (docType) {
      sql += ' AND doc_type = ?';
      params.push(docType);
    }

    sql += ' ORDER BY updated_at DESC';
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToDocument(r));
  }

  public saveChunks(documentId: string, chunks: SaveChunkParams[]): MemoryChunk[] {
    // Delete old chunks and FTS
    this.db.prepare('DELETE FROM memory_chunks WHERE document_id = ?').run(documentId);
    this.db.prepare('DELETE FROM fts_memory_chunks WHERE document_id = ?').run(documentId);

    const now = Date.now();
    const insertChunk = this.db.prepare(`
      INSERT INTO memory_chunks (id, document_id, chunk_index, content, token_count, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO fts_memory_chunks (chunk_id, document_id, content)
      VALUES (?, ?, ?)
    `);

    const savedChunks: MemoryChunk[] = [];
    for (const c of chunks) {
      const chunk: MemoryChunk = {
        id: randomUUID(),
        documentId,
        chunkIndex: c.chunkIndex,
        content: c.content,
        tokenCount: c.tokenCount,
        metadataJson: this.serializeJson(c.metadata, '{}'),
        createdAt: now,
      };

      insertChunk.run(
        chunk.id,
        chunk.documentId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenCount,
        chunk.metadataJson ?? null,
        chunk.createdAt
      );

      insertFts.run(chunk.id, chunk.documentId, chunk.content);
      savedChunks.push(chunk);
    }

    return savedChunks;
  }

  public listChunksByDocument(documentId: string): MemoryChunk[] {
    const stmt = this.db.prepare(
      'SELECT * FROM memory_chunks WHERE document_id = ? ORDER BY chunk_index ASC'
    );
    const rows = stmt.all(documentId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRowToChunk(r));
  }

  public searchChunksFTS(query: string, limit = 20): Array<{ chunk: MemoryChunk; documentPath: string }> {
    if (!query || query.trim() === '') return [];

    try {
      const stmt = this.db.prepare(`
        SELECT c.*, d.path as document_path
        FROM memory_chunks c
        JOIN fts_memory_chunks fts ON c.id = fts.chunk_id
        JOIN memory_documents d ON c.document_id = d.id
        WHERE fts_memory_chunks MATCH ?
        LIMIT ?
      `);

      const rows = stmt.all(query, limit) as Record<string, unknown>[];
      return rows.map((r) => ({
        chunk: this.mapRowToChunk(r),
        documentPath: String(r['document_path']),
      }));
    } catch {
      // Fallback to LIKE query if FTS expression syntax fails
      const stmt = this.db.prepare(`
        SELECT c.*, d.path as document_path
        FROM memory_chunks c
        JOIN memory_documents d ON c.document_id = d.id
        WHERE c.content LIKE ?
        LIMIT ?
      `);
      const rows = stmt.all(`%${query}%`, limit) as Record<string, unknown>[];
      return rows.map((r) => ({
        chunk: this.mapRowToChunk(r),
        documentPath: String(r['document_path']),
      }));
    }
  }

  private mapRowToDocument(row: Record<string, unknown>): MemoryDocument {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      docType: row['doc_type'] as MemoryDocType,
      path: String(row['path']),
      title: String(row['title']),
      contentHash: String(row['content_hash']),
      rawContent: String(row['raw_content']),
      version: Number(row['version']),
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }

  private mapRowToChunk(row: Record<string, unknown>): MemoryChunk {
    return {
      id: String(row['id']),
      documentId: String(row['document_id']),
      chunkIndex: Number(row['chunk_index']),
      content: String(row['content']),
      tokenCount: Number(row['token_count']),
      metadataJson: row['metadata_json'] ? String(row['metadata_json']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }
}
