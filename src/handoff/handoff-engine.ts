import type { DatabaseSync } from 'node:sqlite';
import { HandoffReport } from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import { globalEventBus } from '../core/events.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CreateHandoffDTO {
  taskId: string;
  fromAgent: string;
  statusSummary: string;
  blockers?: string;
  nextSteps: string;
  contextSnapshotJson?: string;
}

export interface IHandoffEngine {
  recordHandoff(dto: CreateHandoffDTO): Promise<HandoffReport>;
  getLatestHandoff(taskId: string): Promise<HandoffReport | null>;
  generateMarkdownHandoff(report: HandoffReport): string;
  persistHandoffToDisk(projectRoot: string, report: HandoffReport): Promise<string>;
}

export class HandoffEngine implements IHandoffEngine {
  constructor(private readonly db: DatabaseSync) {}

  public async recordHandoff(dto: CreateHandoffDTO): Promise<HandoffReport> {
    if (!dto.statusSummary || dto.statusSummary.trim() === '') {
      throw new ValidationError('Handoff status summary is required');
    }
    if (!dto.nextSteps || dto.nextSteps.trim() === '') {
      throw new ValidationError('Handoff next steps are required');
    }

    const report: HandoffReport = {
      id: randomUUID(),
      taskId: dto.taskId,
      fromAgent: dto.fromAgent,
      statusSummary: dto.statusSummary.trim(),
      blockers: dto.blockers?.trim(),
      nextSteps: dto.nextSteps.trim(),
      contextSnapshotJson: dto.contextSnapshotJson,
      createdAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO handoffs (id, task_id, from_agent, status_summary, blockers, next_steps, context_snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      report.id,
      report.taskId,
      report.fromAgent,
      report.statusSummary,
      report.blockers ?? null,
      report.nextSteps,
      report.contextSnapshotJson ?? null,
      report.createdAt
    );

    await globalEventBus.publish('handoff:recorded', report);
    return report;
  }

  public async getLatestHandoff(taskId: string): Promise<HandoffReport | null> {
    const stmt = this.db.prepare(
      'SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1'
    );
    const row = stmt.get(taskId) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: String(row['id']),
      taskId: String(row['task_id']),
      fromAgent: String(row['from_agent']),
      statusSummary: String(row['status_summary']),
      blockers: row['blockers'] ? String(row['blockers']) : undefined,
      nextSteps: String(row['next_steps']),
      contextSnapshotJson: row['context_snapshot_json'] ? String(row['context_snapshot_json']) : undefined,
      createdAt: Number(row['created_at']),
    };
  }

  public generateMarkdownHandoff(report: HandoffReport): string {
    const dateStr = new Date(report.createdAt).toISOString();
    return `# Handoff Report: Task ${report.taskId}

- **Handoff ID**: ${report.id}
- **Timestamp**: ${dateStr}
- **From Agent**: ${report.fromAgent}

## 1. Trạng thái hiện tại (Status Summary)
${report.statusSummary}

## 2. Vấn đề nghẽn / Rủi ro (Blockers)
${report.blockers && report.blockers.trim() !== '' ? report.blockers : '_Không có rào cản nào ghi nhận._'}

## 3. Các bước hành động tiếp theo (Next Steps)
${report.nextSteps}

---
*Báo cáo này được tự động tạo bởi AI PROJECT OS Handoff Engine.*
`;
  }

  public async persistHandoffToDisk(projectRoot: string, report: HandoffReport): Promise<string> {
    const handoffDir = path.join(projectRoot, '.ai', 'handoff');
    await fs.mkdir(handoffDir, { recursive: true });

    const filename = `${new Date(report.createdAt).toISOString().replace(/[:.]/g, '-')}_${report.taskId}.md`;
    const targetPath = path.join(handoffDir, filename);

    const content = this.generateMarkdownHandoff(report);
    await fs.writeFile(targetPath, content, 'utf8');

    return targetPath;
  }
}
