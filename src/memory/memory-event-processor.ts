import type { DatabaseSync } from 'node:sqlite';
import { MemoryEvent, MemoryEventType } from '../core/types.js';
import { globalEventBus } from '../core/events.js';

export class MemoryEventProcessor {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Records a batch of MemoryEvents into the database event log and notifies listeners on the event bus.
   */
  public async processEvents(projectId: string, events: MemoryEvent[]): Promise<void> {
    if (events.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT INTO memory_events (
        id, project_id, event_type, source, entity, before_json, after_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const ev of events) {
      stmt.run(
        ev.eventId,
        projectId,
        ev.type,
        ev.source,
        ev.entity,
        ev.before !== null && ev.before !== undefined ? JSON.stringify(ev.before) : null,
        ev.after !== null && ev.after !== undefined ? JSON.stringify(ev.after) : null,
        ev.metadata ? JSON.stringify(ev.metadata) : null,
        ev.timestamp
      );

      // Publish to global event bus asynchronously
      await globalEventBus.publish('memory:event', ev);
      await globalEventBus.publish(`memory:${ev.type.toLowerCase()}`, ev);
    }
  }

  /**
   * Retrieves event history for a project with optional filtering.
   */
  public getHistory(
    projectId: string,
    options: {
      limit?: number;
      entity?: string;
      type?: MemoryEventType;
    } = {}
  ): MemoryEvent[] {
    let query = 'SELECT * FROM memory_events WHERE project_id = ?';
    const params: (string | number)[] = [projectId];

    if (options.entity) {
      query += ' AND entity = ?';
      params.push(options.entity);
    }

    if (options.type) {
      query += ' AND event_type = ?';
      params.push(options.type);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(options.limit ?? 100);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];

    return rows.map((r) => this.mapRowToEvent(r));
  }

  public getEventsByEntity(projectId: string, entity: string): MemoryEvent[] {
    return this.getHistory(projectId, { entity, limit: 100 });
  }

  private mapRowToEvent(row: Record<string, unknown>): MemoryEvent {
    return {
      eventId: String(row['id']),
      type: row['event_type'] as MemoryEventType,
      timestamp: Number(row['created_at']),
      source: String(row['source']),
      entity: String(row['entity']),
      before: row['before_json'] ? JSON.parse(String(row['before_json'])) : null,
      after: row['after_json'] ? JSON.parse(String(row['after_json'])) : null,
      metadata: row['metadata_json'] ? JSON.parse(String(row['metadata_json'])) : undefined,
    };
  }
}
