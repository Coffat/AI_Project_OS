import { BaseRepository } from './base.repository.js';
import {
  ObsidianSyncRecord,
  ObsidianEntityType,
  ObsidianSyncSource,
} from '../../core/types.js';
import { randomUUID } from 'node:crypto';

export interface UpsertObsidianLedgerParams {
  projectId: string;
  entityType: ObsidianEntityType;
  entityId: string;
  filePath: string;
  lastSyncedHash: string;
  lastSyncedMtime: number;
  syncSource: ObsidianSyncSource;
}

export class ObsidianLedgerRepository extends BaseRepository {
  public upsertEntry(params: UpsertObsidianLedgerParams): ObsidianSyncRecord {
    const now = Date.now();
    const existing = this.getEntry(params.projectId, params.filePath);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE obsidian_sync_ledger
        SET entity_type = ?, entity_id = ?, last_synced_hash = ?, last_synced_mtime = ?,
            last_synced_at = ?, sync_source = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        params.entityType,
        params.entityId,
        params.lastSyncedHash,
        params.lastSyncedMtime,
        now,
        params.syncSource,
        now,
        existing.id
      );

      return {
        ...existing,
        entityType: params.entityType,
        entityId: params.entityId,
        lastSyncedHash: params.lastSyncedHash,
        lastSyncedMtime: params.lastSyncedMtime,
        lastSyncedAt: now,
        syncSource: params.syncSource,
        updatedAt: now,
      };
    }

    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO obsidian_sync_ledger (
        id, project_id, entity_type, entity_id, file_path,
        last_synced_hash, last_synced_mtime, last_synced_at, sync_source,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      params.projectId,
      params.entityType,
      params.entityId,
      params.filePath,
      params.lastSyncedHash,
      params.lastSyncedMtime,
      now,
      params.syncSource,
      now,
      now
    );

    return {
      id,
      projectId: params.projectId,
      entityType: params.entityType,
      entityId: params.entityId,
      filePath: params.filePath,
      lastSyncedHash: params.lastSyncedHash,
      lastSyncedMtime: params.lastSyncedMtime,
      lastSyncedAt: now,
      syncSource: params.syncSource,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getEntry(projectId: string, filePath: string): ObsidianSyncRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM obsidian_sync_ledger WHERE project_id = ? AND file_path = ? LIMIT 1'
    );
    const row = stmt.get(projectId, filePath) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public getEntryByEntity(
    projectId: string,
    entityType: ObsidianEntityType,
    entityId: string
  ): ObsidianSyncRecord | null {
    const stmt = this.db.prepare(
      'SELECT * FROM obsidian_sync_ledger WHERE project_id = ? AND entity_type = ? AND entity_id = ? LIMIT 1'
    );
    const row = stmt.get(projectId, entityType, entityId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listAll(projectId: string): ObsidianSyncRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM obsidian_sync_ledger WHERE project_id = ? ORDER BY file_path ASC'
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public deleteEntry(projectId: string, filePath: string): void {
    const stmt = this.db.prepare(
      'DELETE FROM obsidian_sync_ledger WHERE project_id = ? AND file_path = ?'
    );
    stmt.run(projectId, filePath);
  }

  private mapRow(row: Record<string, unknown>): ObsidianSyncRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      entityType: row['entity_type'] as ObsidianEntityType,
      entityId: String(row['entity_id']),
      filePath: String(row['file_path']),
      lastSyncedHash: String(row['last_synced_hash']),
      lastSyncedMtime: Number(row['last_synced_mtime']),
      lastSyncedAt: Number(row['last_synced_at']),
      syncSource: row['sync_source'] as ObsidianSyncSource,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
