import { BaseRepository } from './base.repository.js';
import { AgentSessionRecord, AgentSessionStatus } from '../../core/types.js';
import { ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateSessionParams {
  projectId: string;
  agentIdentity: string;
  agentType: string;
  sessionToken?: string;
}

export class AgentSessionRepository extends BaseRepository {
  public createSession(params: CreateSessionParams): AgentSessionRecord {
    if (!params.agentIdentity || params.agentIdentity.trim() === '') {
      throw new ValidationError('Agent identity cannot be empty');
    }

    const now = Date.now();
    const session: AgentSessionRecord = {
      id: randomUUID(),
      projectId: params.projectId,
      agentIdentity: params.agentIdentity.trim(),
      agentType: params.agentType.trim(),
      sessionToken: params.sessionToken ?? randomUUID(),
      startedAt: now,
      status: 'active',
    };

    const stmt = this.db.prepare(`
      INSERT INTO agent_sessions (id, project_id, agent_identity, agent_type, session_token, started_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.projectId,
      session.agentIdentity,
      session.agentType,
      session.sessionToken,
      session.startedAt,
      session.status
    );

    return session;
  }

  public closeSession(id: string): AgentSessionRecord {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE agent_sessions
      SET status = 'closed', ended_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(now, id);
    if (Number(result.changes) === 0) {
      throw new ValidationError(`Agent session not found: ${id}`);
    }

    const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    return this.mapRow(row);
  }

  public findActiveByProject(projectId: string): AgentSessionRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM agent_sessions WHERE project_id = ? AND status = 'active' ORDER BY started_at DESC"
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  private mapRow(row: Record<string, unknown>): AgentSessionRecord {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      agentIdentity: String(row['agent_identity']),
      agentType: String(row['agent_type']),
      sessionToken: String(row['session_token']),
      startedAt: Number(row['started_at']),
      endedAt: row['ended_at'] ? Number(row['ended_at']) : undefined,
      status: row['status'] as AgentSessionStatus,
    };
  }
}
