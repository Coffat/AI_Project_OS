import { BaseRepository } from './base.repository.js';
import { AuditEvent } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface RecordEventParams {
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  agentIdentity: string;
}

export class EventRepository extends BaseRepository {
  public recordEvent(params: RecordEventParams): AuditEvent {
    if (!params.eventType || params.eventType.trim() === '') {
      throw new ValidationError('Event type cannot be empty');
    }
    if (!params.aggregateType || params.aggregateType.trim() === '') {
      throw new ValidationError('Aggregate type cannot be empty');
    }
    if (!params.agentIdentity || params.agentIdentity.trim() === '') {
      throw new ValidationError('Agent identity cannot be empty');
    }

    const now = Date.now();
    const event: AuditEvent = {
      id: randomUUID(),
      projectId: params.projectId,
      eventType: params.eventType.trim(),
      aggregateType: params.aggregateType.trim(),
      aggregateId: params.aggregateId,
      payloadJson: this.serializeJson(params.payload, '{}'),
      agentIdentity: params.agentIdentity.trim(),
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO events (id, project_id, event_type, aggregate_type, aggregate_id, payload_json, agent_identity, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.projectId,
      event.eventType,
      event.aggregateType,
      event.aggregateId,
      event.payloadJson ?? null,
      event.agentIdentity,
      event.createdAt
    );

    return event;
  }

  public listByProject(projectId: string, limit = 100): AuditEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(projectId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public listByAggregate(aggregateType: string, aggregateId: string): AuditEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM events
      WHERE aggregate_type = ? AND aggregate_id = ?
      ORDER BY created_at DESC
    `);

    const rows = stmt.all(aggregateType, aggregateId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): AuditEvent {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      eventType: String(row['event_type']),
      aggregateType: String(row['aggregate_type']),
      aggregateId: String(row['aggregate_id']),
      payloadJson: row['payload_json'] ? String(row['payload_json']) : undefined,
      agentIdentity: String(row['agent_identity']),
      createdAt: Number(row['created_at']),
    };
  }
}
