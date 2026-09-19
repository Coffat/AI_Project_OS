import type { DatabaseSync } from 'node:sqlite';
import { TaskService } from './task-service.js';
import { TaskSnapshot } from '../core/types.js';

export interface CliTaskOptions {
  projectId: string;
  title: string;
  goal?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  assignedAgent?: string;
}

export class TaskCliAPI {
  private taskService: TaskService;

  constructor(db: DatabaseSync) {
    this.taskService = new TaskService(db);
  }

  public async createTask(options: CliTaskOptions): Promise<string> {
    const task = await this.taskService.createTask({
      projectId: options.projectId,
      title: options.title,
      goal: options.goal,
      description: options.description,
      priority: options.priority,
      assignedAgent: options.assignedAgent,
    });

    return [
      `=== TASK CREATED ===`,
      `ID:          ${task.id}`,
      `Title:       ${task.title}`,
      `Goal:        ${task.goal}`,
      `Status:      ${task.status}`,
      `Priority:    ${task.priority}`,
      `Project ID:  ${task.projectId}`,
      `Created At:  ${new Date(task.createdAt).toISOString()}`,
    ].join('\n');
  }

  public async inspectTask(taskId: string): Promise<string> {
    const aggregate = await this.taskService.getTask(taskId);
    const snapshot = await this.taskService.getTaskSnapshot(taskId);

    return this.formatInspectionReport(aggregate, snapshot);
  }

  public formatInspectionReport(aggregate: Awaited<ReturnType<TaskService['getTask']>>, snapshot: TaskSnapshot): string {
    const t = aggregate.task;
    const lines: string[] = [
      `================================================================================`,
      `                          AI PROJECT OS — TASK INSPECTOR                        `,
      `================================================================================`,
      `Task ID:        ${t.id}`,
      `Title:          ${t.title}`,
      `Goal:           ${snapshot.goal}`,
      `Status:         ${t.status.toUpperCase()}`,
      `Priority:       ${t.priority.toUpperCase()}`,
      `Assigned Agent: ${t.assignedAgent ?? 'None'}`,
      `Current Step:   ${snapshot.currentStep ?? 'None'}`,
      `Started At:     ${t.startedAt ? new Date(t.startedAt).toISOString() : 'Not started yet'}`,
      `Completed At:   ${t.completedAt ? new Date(t.completedAt).toISOString() : 'N/A'}`,
      `Updated At:     ${new Date(t.updatedAt).toISOString()}`,
      ``,
      `----------------------------- STEPS PROGRESS -----------------------------------`,
    ];

    if (aggregate.steps.length === 0) {
      lines.push(`(No steps defined)`);
    } else {
      for (const s of aggregate.steps) {
        const check = s.status === 'completed' ? '[x]' : s.status === 'in_progress' ? '[>]' : '[ ]';
        lines.push(`${check} Step ${s.stepOrder}: ${s.title} (${s.status})${s.resultSummary ? ` -> ${s.resultSummary}` : ''}`);
      }
    }

    lines.push(
      ``,
      `----------------------------- ATTACHED CONTEXT ---------------------------------`,
      `Files (${aggregate.files.length}):`,
      aggregate.files.length > 0 ? aggregate.files.map((f) => `  - ${f.filePath} (${f.relationType})`).join('\n') : '  (None)',
      `Symbols (${aggregate.symbols.length}):`,
      aggregate.symbols.length > 0 ? aggregate.symbols.map((s) => `  - ${s.symbolName}`).join('\n') : '  (None)',
      `Decisions (${aggregate.decisions.length}):`,
      aggregate.decisions.length > 0 ? aggregate.decisions.map((d) => `  - ${d.title} [${d.status}]`).join('\n') : '  (None)',
      `Active Blockers (${aggregate.blockers.filter((b) => !b.resolved).length}):`,
      aggregate.blockers.filter((b) => !b.resolved).length > 0
        ? aggregate.blockers.filter((b) => !b.resolved).map((b) => `  - [!] ${b.reason}`).join('\n')
        : '  (No active blockers)',
      ``,
      `----------------------------- AGENT SNAPSHOT -----------------------------------`,
      `Completed Steps:  ${snapshot.completedSteps.join(', ') || 'None'}`,
      `Remaining Steps:  ${snapshot.remainingSteps.join(', ') || 'None'}`,
      `Next Action:      ${snapshot.nextAction}`,
      `Snapshot Time:    ${new Date(snapshot.timestamp).toISOString()}`,
      `================================================================================`
    );

    return lines.join('\n');
  }
}
