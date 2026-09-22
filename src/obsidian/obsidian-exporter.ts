import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Project,
  Task,
  TaskStep,
  TaskBlocker,
  DecisionRecord,
  ConstraintRecord,
  ObsidianFrontmatter,
} from '../core/types.js';
import { ObsidianLinker } from './obsidian-linker.js';

export class ObsidianExporter {
  /**
   * Helper to format clean Dataview-compatible YAML frontmatter.
   */
  public static renderFrontmatter(data: ObsidianFrontmatter): string {
    const lines = ['---'];
    for (const [key, val] of Object.entries(data)) {
      if (val === undefined || val === null) continue;
      if (Array.isArray(val)) {
        lines.push(`${key}: [${val.map((v) => JSON.stringify(v)).join(', ')}]`);
      } else if (typeof val === 'string') {
        lines.push(`${key}: ${JSON.stringify(val)}`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    }
    lines.push('---');
    return lines.join('\n');
  }

  /**
   * Renders PROJECT.md content as a Markdown string
   */
  public renderProject(project: Project): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      id: project.id,
      title: project.name,
      type: 'project',
      tags: ['project', 'canonical', 'root'],
      created_at: new Date(project.createdAt).toISOString(),
      updated_at: new Date(project.updatedAt).toISOString(),
    });

    return [
      frontmatter,
      '',
      `# ${project.name}`,
      '',
      `**Project ID**: \`${project.id}\`  `,
      `**Root Path**: \`${project.rootPath}\`  `,
      `**Created**: ${new Date(project.createdAt).toISOString()}  `,
      `**Last Updated**: ${new Date(project.updatedAt).toISOString()}  `,
      '',
      '## 🧭 Navigation Hub',
      `- Hub Overview: [[INDEX]]`,
      `- Architecture Blueprint: [[ARCHITECTURE]]`,
      `- System Constraints: [[CONSTRAINTS]]`,
      `- Architectural Decisions: [[DECISIONS]]`,
      `- Engineering Tasks: [[TASKS]]`,
      `- Research Documents: [[RESEARCH]]`,
      '',
      '## 🎯 Project Overview',
      'This is the canonical human-readable knowledge vault maintained by CofAIOS.',
      'All AI coding agents, background tasks, and human contributors coordinate through this vault.',
      '',
    ].join('\n');
  }

  /**
   * Exports or updates PROJECT.md
   */
  public async exportProject(project: Project, canonicalDir: string): Promise<string> {
    const filePath = path.join(canonicalDir, 'PROJECT.md');
    const content = this.renderProject(project);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders ARCHITECTURE.md content as a Markdown string
   */
  public renderArchitecture(
    project: Project,
    decisions: DecisionRecord[] = []
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: `${project.name} Architecture`,
      type: 'architecture',
      tags: ['architecture', 'system-design', 'blueprint'],
      updated_at: new Date(project.updatedAt).toISOString(),
    });

    const decisionLinks = decisions.map((d) => `- [[${d.id}]] — ${d.title} (*${d.status}*)`);

    return [
      frontmatter,
      '',
      `# ${project.name} Architecture`,
      '',
      '## 🏛 System Blueprints',
      'The system adheres to modular, bounded-context design principles.',
      'Runtime state is managed in SQLite; knowledge continuity is anchored in canonical Markdown.',
      '',
      '## 📜 Governing Constraints',
      'All architectural changes must strictly satisfy rules defined in [[CONSTRAINTS]].',
      '',
      '## 📌 Architectural Decision Records (ADRs)',
      decisionLinks.length > 0 ? decisionLinks.join('\n') : '*(No architectural decisions recorded yet)*',
      '',
      '## 🔗 Related Views',
      '- Return to [[INDEX]] | Return to [[PROJECT]]',
      '',
    ].join('\n');
  }

  /**
   * Exports or updates ARCHITECTURE.md
   */
  public async exportArchitecture(
    project: Project,
    canonicalDir: string,
    decisions: DecisionRecord[] = []
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'ARCHITECTURE.md');
    const content = this.renderArchitecture(project, decisions);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders CONSTRAINTS.md content as a Markdown string
   */
  public renderConstraints(
    project: Project,
    constraints: ConstraintRecord[]
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: `${project.name} Constraints`,
      type: 'constraint',
      tags: ['constraints', 'governance', 'quality-gates'],
      updated_at: new Date(project.updatedAt).toISOString(),
    });

    const renderRule = (c: ConstraintRecord) => [
      `### ${c.id}: ${c.title}`,
      `**Category**: \`${c.category}\` | **Enforcement**: \`${c.enforcementLevel}\``,
      '',
      c.ruleContent,
      '',
    ].join('\n');

    return [
      frontmatter,
      '',
      `# ${project.name} Constraints & Invariants`,
      '',
      'These constraints are non-negotiable architectural rules enforced across all agent workflows.',
      '',
      '## 🛡 Active Constraints',
      constraints.length > 0 ? constraints.map(renderRule).join('\n') : '*(No active constraints)*',
      '',
      '## 🔗 Navigation',
      '- Return to [[INDEX]] | [[ARCHITECTURE]] | [[DECISIONS]]',
      '',
    ].join('\n');
  }

  /**
   * Exports or updates CONSTRAINTS.md
   */
  public async exportConstraints(
    project: Project,
    constraints: ConstraintRecord[],
    canonicalDir: string
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'CONSTRAINTS.md');
    const content = this.renderConstraints(project, constraints);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders individual DECISION-XXX.md content as a Markdown string
   */
  public renderDecision(
    decision: DecisionRecord,
    relatedTasks: Task[] = []
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      id: decision.id,
      title: decision.title,
      type: 'decision',
      status: decision.status,
      source_file: decision.sourceFile,
      tags: ['decision', 'adr', decision.status.toLowerCase()],
      created_at: new Date(decision.createdAt).toISOString(),
      updated_at: new Date(decision.updatedAt).toISOString(),
    });

    const taskLinks = relatedTasks.map((t) => `- [[${t.id}]] — ${t.title}`);

    return [
      frontmatter,
      '',
      `# ${decision.id}: ${decision.title}`,
      '',
      `**Status**: \`${decision.status.toUpperCase()}\`  `,
      `**Source File**: \`${decision.sourceFile || 'architecture'}\`  `,
      `**Recorded Date**: ${new Date(decision.createdAt).toISOString().slice(0, 10)}  `,
      '',
      '## 📋 Context & Problem Statement',
      decision.context || '*(No context documented)*',
      '',
      '## 🎯 Decision',
      decision.decisionRationale || '*(Decision pending)*',
      '',
      '## ⚖️ Consequences & Tradeoffs',
      decision.consequences || '*(No consequences documented)*',
      '',
      '## 🔗 Related Tasks & Knowledge',
      `- Overview Hub: [[DECISIONS]] | Architecture: [[ARCHITECTURE]] | Constraints: [[CONSTRAINTS]]`,
      taskLinks.length > 0 ? taskLinks.join('\n') : '- *(No attached tasks)*',
      '',
    ].join('\n');
  }

  /**
   * Exports individual DECISION-XXX.md files under .ai/canonical/DECISIONS/
   */
  public async exportDecision(
    decision: DecisionRecord,
    canonicalDir: string,
    relatedTasks: Task[] = []
  ): Promise<string> {
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    const filePath = path.join(decisionsDir, `${decision.id}.md`);
    const content = this.renderDecision(decision, relatedTasks);
    await fs.mkdir(decisionsDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders individual TASK-XXX.md content as a Markdown string
   */
  public renderTask(
    task: Task,
    steps: TaskStep[],
    blockers: TaskBlocker[],
    relatedDecisions: DecisionRecord[] = []
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      id: task.id,
      title: task.title,
      type: 'task',
      status: task.status,
      priority: task.priority,
      assigned_agent: task.assignedAgent,
      tags: ['task', task.status.toLowerCase(), task.priority.toLowerCase()],
      created_at: new Date(task.createdAt).toISOString(),
      updated_at: new Date(task.updatedAt).toISOString(),
    });

    // Format steps checklist
    const sortedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const stepsChecklist = sortedSteps.map((s) => {
      const checkbox = s.status === 'completed' ? '[x]' : '[ ]';
      return `- ${checkbox} **Step ${s.stepOrder}**: ${s.title}${s.resultSummary ? ` — *${s.resultSummary}*` : ''}`;
    });

    // Format blockers
    const activeBlockers = blockers.filter((b) => !b.resolved);
    const blockerList = activeBlockers.map((b) => `- ⚠️ ${b.reason.split('\n')[0]}`);

    // Format decision wikilinks
    const decisionLinks = relatedDecisions.map((d) => `- [[${d.id}]] — ${d.title}`);

    return [
      frontmatter,
      '',
      `# ${task.id}: ${task.title}`,
      '',
      `**Status**: \`${task.status.toUpperCase()}\` | **Priority**: \`${task.priority.toUpperCase()}\` | **Assigned**: \`${task.assignedAgent || 'Unassigned'}\`  `,
      `**Current Step**: ${task.currentStep || '*(None)*'}  `,
      `**Parent Task**: ${task.parentTaskId ? ObsidianLinker.toWikilink(task.parentTaskId) : '*(Root task)*'}  `,
      '',
      '## 🎯 Goal & Objective',
      task.goal || task.description || '*(No goal provided)*',
      '',
      task.description && task.description !== task.goal ? `### Description\n${task.description}\n` : '',
      '## 🪜 Execution Plan & Steps',
      stepsChecklist.length > 0 ? stepsChecklist.join('\n') : '- [ ] *(No discrete steps defined yet)*',
      '',
      activeBlockers.length > 0 ? ['## 🚨 Active Blockers', ...blockerList, ''].join('\n') : '',
      '## 🔗 Related Decisions & Constraints',
      `- Constraints: [[CONSTRAINTS]]`,
      decisionLinks.length > 0 ? decisionLinks.join('\n') : '- *(No governing decisions attached)*',
      '',
      '## 🔗 Navigation',
      '- Return to [[INDEX]] | Return to [[TASKS]]',
      '',
    ].join('\n');
  }

  /**
   * Exports individual TASK-XXX.md files under .ai/canonical/TASKS/
   */
  public async exportTask(
    task: Task,
    steps: TaskStep[],
    blockers: TaskBlocker[],
    canonicalDir: string,
    relatedDecisions: DecisionRecord[] = []
  ): Promise<string> {
    const tasksDir = path.join(canonicalDir, 'TASKS');
    const filePath = path.join(tasksDir, `${task.id}.md`);
    const content = this.renderTask(task, steps, blockers, relatedDecisions);
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }
}
