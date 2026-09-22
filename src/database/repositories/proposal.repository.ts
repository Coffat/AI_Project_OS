import { BaseRepository } from './base.repository.js';
import { ResearchProposal, ProposalStatus, ProposalConfidence } from '../../core/types.js';
import { ProposalNotFoundError, ValidationError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';

export interface CreateProposalParams {
  id?: string;
  projectId: string;
  taskId?: string;
  title: string;
  question: string;
  sources?: string[];
  findings?: string;
  proposedChanges?: string;
  confidence?: ProposalConfidence;
  openQuestions?: string[];
  status?: ProposalStatus;
}

export interface UpdateProposalParams {
  title?: string;
  question?: string;
  sources?: string[];
  findings?: string;
  proposedChanges?: string;
  confidence?: ProposalConfidence;
  openQuestions?: string[];
  status?: ProposalStatus;
  reviewedBy?: string;
  reviewComment?: string;
  promotedDecisionId?: string;
}

export class ProposalRepository extends BaseRepository {
  public create(params: CreateProposalParams): ResearchProposal {
    if (!params.title || params.title.trim() === '') {
      throw new ValidationError('Proposal title cannot be empty');
    }
    if (!params.question || params.question.trim() === '') {
      throw new ValidationError('Proposal question cannot be empty');
    }

    const now = Date.now();
    const proposal: ResearchProposal = {
      id: params.id ?? `PROPOSAL-${randomUUID().slice(0, 8).toUpperCase()}`,
      projectId: params.projectId,
      taskId: params.taskId,
      title: params.title.trim(),
      question: params.question.trim(),
      sources: params.sources ?? [],
      findings: params.findings ?? '',
      proposedChanges: params.proposedChanges ?? '',
      confidence: params.confidence ?? 'medium',
      openQuestions: params.openQuestions ?? [],
      status: params.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO research_proposals (
        id, project_id, task_id, title, question, sources, findings,
        proposed_changes, confidence, open_questions, status,
        reviewed_by, review_comment, promoted_decision_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      proposal.id,
      proposal.projectId,
      proposal.taskId ?? null,
      proposal.title,
      proposal.question,
      JSON.stringify(proposal.sources),
      proposal.findings,
      proposal.proposedChanges,
      proposal.confidence,
      JSON.stringify(proposal.openQuestions),
      proposal.status,
      proposal.reviewedBy ?? null,
      proposal.reviewComment ?? null,
      proposal.promotedDecisionId ?? null,
      proposal.createdAt,
      proposal.updatedAt
    );

    return proposal;
  }

  public findById(id: string): ResearchProposal | null {
    const stmt = this.db.prepare('SELECT * FROM research_proposals WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapRow(row);
  }

  public listByProject(projectId: string, status?: ProposalStatus): ResearchProposal[] {
    if (status) {
      const stmt = this.db.prepare(
        'SELECT * FROM research_proposals WHERE project_id = ? AND status = ? ORDER BY updated_at DESC'
      );
      const rows = stmt.all(projectId, status) as Record<string, unknown>[];
      return rows.map((r) => this.mapRow(r));
    }
    const stmt = this.db.prepare(
      'SELECT * FROM research_proposals WHERE project_id = ? ORDER BY updated_at DESC'
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  public update(id: string, updates: UpdateProposalParams): ResearchProposal {
    const existing = this.findById(id);
    if (!existing) throw new ProposalNotFoundError(id);

    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE research_proposals
      SET title              = ?,
          question           = ?,
          sources            = ?,
          findings           = ?,
          proposed_changes   = ?,
          confidence         = ?,
          open_questions     = ?,
          status             = ?,
          reviewed_by        = ?,
          review_comment     = ?,
          promoted_decision_id = ?,
          updated_at         = ?
      WHERE id = ?
    `);

    stmt.run(
      updates.title ?? existing.title,
      updates.question ?? existing.question,
      JSON.stringify(updates.sources ?? existing.sources),
      updates.findings ?? existing.findings,
      updates.proposedChanges ?? existing.proposedChanges,
      updates.confidence ?? existing.confidence,
      JSON.stringify(updates.openQuestions ?? existing.openQuestions ?? []),
      updates.status ?? existing.status,
      updates.reviewedBy ?? existing.reviewedBy ?? null,
      updates.reviewComment ?? existing.reviewComment ?? null,
      updates.promotedDecisionId ?? existing.promotedDecisionId ?? null,
      now,
      id
    );

    return this.findById(id)!;
  }

  public countByProject(projectId: string): number {
    const stmt = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM research_proposals WHERE project_id = ?'
    );
    const row = stmt.get(projectId) as { cnt: number };
    return row.cnt;
  }

  private mapRow(row: Record<string, unknown>): ResearchProposal {
    return {
      id: String(row['id']),
      projectId: String(row['project_id']),
      taskId: row['task_id'] ? String(row['task_id']) : undefined,
      title: String(row['title']),
      question: String(row['question']),
      sources: this.parseJson<string[]>(row['sources'], []),
      findings: String(row['findings'] ?? ''),
      proposedChanges: String(row['proposed_changes'] ?? ''),
      confidence: (row['confidence'] as ProposalConfidence) ?? 'medium',
      openQuestions: this.parseJson<string[]>(row['open_questions'], []),
      status: (row['status'] as ProposalStatus) ?? 'draft',
      reviewedBy: row['reviewed_by'] ? String(row['reviewed_by']) : undefined,
      reviewComment: row['review_comment'] ? String(row['review_comment']) : undefined,
      promotedDecisionId: row['promoted_decision_id']
        ? String(row['promoted_decision_id'])
        : undefined,
      createdAt: Number(row['created_at']),
      updatedAt: Number(row['updated_at']),
    };
  }
}
