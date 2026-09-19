import type { DatabaseSync } from 'node:sqlite';
import { HandoffRecord } from '../core/types.js';
import { globalEventBus } from '../core/events.js';
import { HandoffRepository, CreateHandoffParams } from '../database/repositories/handoff.repository.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type CreateHandoffDTO = CreateHandoffParams;

export interface IHandoffEngine {
  recordHandoff(dto: CreateHandoffDTO): Promise<HandoffRecord>;
  getLatestHandoff(taskId: string): Promise<HandoffRecord | null>;
  generateMarkdownHandoff(report: HandoffRecord): string;
  persistHandoffToDisk(projectRoot: string, report: HandoffRecord): Promise<string>;
}

export class HandoffEngine implements IHandoffEngine {
  private readonly repo: HandoffRepository;

  constructor(db: DatabaseSync) {
    this.repo = new HandoffRepository(db);
  }

  public async recordHandoff(dto: CreateHandoffDTO): Promise<HandoffRecord> {
    const report = this.repo.create(dto);
    await globalEventBus.publish('handoff:recorded', report);
    return report;
  }

  public async getLatestHandoff(taskId: string): Promise<HandoffRecord | null> {
    return this.repo.findLatestByTaskId(taskId);
  }

  public generateMarkdownHandoff(report: HandoffRecord): string {
    const dateStr = new Date(report.createdAt).toISOString();
    return `# Handoff Report: Task ${report.taskId}

- **Handoff ID**: ${report.id}
- **Timestamp**: ${dateStr}
- **From Agent**: ${report.agentIdentity}

## 1. Mục tiêu (Objective)
${report.objective}

## 2. Công việc đã hoàn thành (Completed Work)
${report.completedWork}

## 3. Vị trí hiện tại (Current Location)
- **Current Step**: ${report.currentStep ?? '_Chưa xác định_'}
- **Current File**: ${report.currentFile ?? '_Chưa xác định_'}

## 4. Tệp tin đã chỉnh sửa (Modified Files)
${report.modifiedFiles.length > 0 ? report.modifiedFiles.map((f) => `- \`${f}\``).join('\n') : '_Không có_'}

## 5. Quyết định đã đưa ra (Decisions)
${report.decisions.length > 0 ? report.decisions.map((d) => `- ${d}`).join('\n') : '_Không có_'}

## 6. Vấn đề nghẽn & Lỗi (Blockers & Errors)
- **Blockers**: ${report.blockers ?? '_Không có_'}
- **Errors**: ${report.errors ?? '_Không có_'}

## 7. Các bài test kiểm tra (Tests)
${report.tests.length > 0 ? report.tests.map((t) => `- \`${t}\``).join('\n') : '_Chưa có_'}

## 8. Hành động tiếp theo (Next Action)
${report.nextAction}

---
*Báo cáo này được tự động tạo bởi AI PROJECT OS Handoff Engine.*
`;
  }

  public async persistHandoffToDisk(projectRoot: string, report: HandoffRecord): Promise<string> {
    const handoffDir = path.join(projectRoot, '.ai', 'handoff');
    await fs.mkdir(handoffDir, { recursive: true });

    const filename = `${new Date(report.createdAt).toISOString().replace(/[:.]/g, '-')}_${report.taskId}.md`;
    const targetPath = path.join(handoffDir, filename);

    const content = this.generateMarkdownHandoff(report);
    await fs.writeFile(targetPath, content, 'utf8');

    return targetPath;
  }
}
