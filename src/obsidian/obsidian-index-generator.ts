import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  Project,
  Task,
  DecisionRecord,
  ConstraintRecord,
} from '../core/types.js';
import { ObsidianExporter } from './obsidian-exporter.js';

export class ObsidianIndexGenerator {
  /**
   * Generates the central INDEX.md hub
   */
  /**
   * Renders the root INDEX.md content as a Markdown string
   */
  public renderIndex(
    project: Project,
    tasks: Task[],
    decisions: DecisionRecord[],
    constraints: ConstraintRecord[]
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: `${project.name} Knowledge Hub`,
      type: 'index',
      tags: ['index', 'hub', 'moc', 'overview'],
      updated_at: new Date(project.updatedAt).toISOString(),
    });

    const activeTasks = tasks.filter((t) => t.status !== 'done');
    const completedTasks = tasks.filter((t) => t.status === 'done');

    return [
      frontmatter,
      '',
      `# 🪐 ${project.name} — Obsidian Knowledge Graph`,
      '',
      '> Welcome to the human knowledge interface for **CofAIOS**.',
      '> This vault reflects the live project memory, architecture decisions, and task execution state.',
      '',
      '## 🧭 Core Navigation',
      '| Section | Purpose | Primary Entrypoint |',
      '| :--- | :--- | :--- |',
      '| 📁 **Project** | Identity, root paths, and metadata | [[PROJECT]] |',
      '| 🏛 **Architecture** | System blueprints and structural decisions | [[ARCHITECTURE]] |',
      '| 🛡 **Constraints** | Invariants, security rules, and performance budgets | [[CONSTRAINTS]] |',
      '| 📌 **Decisions** | Architectural Decision Records (ADRs) | [[DECISIONS]] |',
      '| 🛠 **Tasks** | Engineering sprints, active steps, and blockers | [[TASKS]] |',
      '| 🔬 **Research** | Spikes, benchmark results, and exploration notes | [[RESEARCH]] |',
      '',
      '## 📊 Live Metrics',
      `- **Total Tasks**: ${tasks.length} (⚡ \`${activeTasks.length}\` Active, ✅ \`${completedTasks.length}\` Done)`,
      `- **Architecture Decisions**: ${decisions.length} recorded ADRs`,
      `- **System Constraints**: ${constraints.length} invariants monitored`,
      '',
      '## ⚡ Active Tasks Snapshot',
      activeTasks.length > 0
        ? [
            '| Task | Title | Status | Priority | Agent |',
            '| :--- | :--- | :--- | :--- | :--- |',
            ...activeTasks.map(
              (t) =>
                `| [[${t.id}]] | ${t.title} | \`${t.status}\` | \`${t.priority}\` | \`${t.assignedAgent || 'Unassigned'}\` |`
            ),
          ].join('\n')
        : '*(No active tasks currently in progress)*',
      '',
      '## 📌 Recent Architectural Decisions',
      decisions.length > 0
        ? [
            '| ADR | Title | Status | Source / Category |',
            '| :--- | :--- | :--- | :--- |',
            ...decisions.slice(0, 5).map(
              (d) => `| [[${d.id}]] | ${d.title} | \`${d.status}\` | \`${d.sourceFile || 'architecture'}\` |`
            ),
          ].join('\n')
        : '*(No decisions recorded yet)*',
      '',
      '---',
      '*Vault synchronized deterministically by CofAIOS Obsidian Engine.*',
      '',
    ].join('\n');
  }

  /**
   * Generates the root INDEX.md (Map of Content / MOC) for Obsidian
   */
  public async generateIndex(
    project: Project,
    tasks: Task[],
    decisions: DecisionRecord[],
    constraints: ConstraintRecord[],
    canonicalDir: string
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'INDEX.md');
    const content = this.renderIndex(project, tasks, decisions, constraints);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders the TASKS.md aggregation hub content as a Markdown string
   */
  public renderTasksHub(tasks: Task[], updatedAt = 0): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: 'Engineering Tasks Hub',
      type: 'task',
      tags: ['tasks', 'hub', 'kanban'],
      updated_at: new Date(updatedAt).toISOString(),
    });

    const renderTaskRow = (t: Task) =>
      `| [[${t.id}]] | ${t.title} | \`${t.status}\` | \`${t.priority}\` | \`${t.assignedAgent || '-'}\` | ${t.currentStep || '-'} |`;

    const inProgress = tasks.filter((t) => t.status === 'in_progress' || t.status === 'testing' || t.status === 'resumed');
    const blocked = tasks.filter((t) => t.status === 'blocked');
    const backlog = tasks.filter((t) => t.status === 'planned' || t.status === 'handoff');
    const done = tasks.filter((t) => t.status === 'done');

    const tableHeader = [
      '| Task Link | Title | Status | Priority | Assigned Agent | Current Step |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
    ];

    return [
      frontmatter,
      '',
      '# 🛠 Engineering Tasks Hub',
      '',
      'Overview of all tasks managed across AI agents and human sessions.',
      '',
      '## ⚡ Active In-Progress & Testing',
      inProgress.length > 0
        ? [...tableHeader, ...inProgress.map(renderTaskRow)].join('\n')
        : '*(No active tasks)*',
      '',
      blocked.length > 0
        ? [
            '## 🚨 Blocked Tasks',
            ...tableHeader,
            ...blocked.map(renderTaskRow),
            '',
          ].join('\n')
        : '',
      '## 📋 Backlog & Planned',
      backlog.length > 0
        ? [...tableHeader, ...backlog.map(renderTaskRow)].join('\n')
        : '*(Backlog is clear)*',
      '',
      '## ✅ Completed Tasks',
      done.length > 0
        ? [...tableHeader, ...done.map(renderTaskRow)].join('\n')
        : '*(No completed tasks yet)*',
      '',
      '## 🔗 Navigation',
      '- Return to [[INDEX]] | Return to [[PROJECT]]',
      '',
    ].join('\n');
  }

  /**
   * Generates the TASKS.md aggregation hub
   */
  public async generateTasksHub(
    tasks: Task[],
    canonicalDir: string,
    updatedAt = 0
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'TASKS.md');
    const content = this.renderTasksHub(tasks, updatedAt);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders the DECISIONS.md aggregation hub content as a Markdown string
   */
  public renderDecisionsHub(decisions: DecisionRecord[], updatedAt = 0): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: 'Architectural Decisions (ADRs) Hub',
      type: 'decision',
      tags: ['decisions', 'hub', 'adr'],
      updated_at: new Date(updatedAt).toISOString(),
    });

    return [
      frontmatter,
      '',
      '# 📌 Architectural Decision Records (ADRs)',
      '',
      'Permanent record of significant design, architecture, and technology decisions.',
      '',
      '| ADR Link | Title | Status | Source / Category | Created |',
      '| :--- | :--- | :--- | :--- | :--- |',
      ...(decisions.length > 0
        ? decisions.map(
            (d) =>
              `| [[${d.id}]] | ${d.title} | \`${d.status}\` | \`${d.sourceFile || 'architecture'}\` | ${new Date(d.createdAt).toISOString().slice(0, 10)} |`
          )
        : ['| *(None)* | No architectural decisions recorded | - | - | - |']),
      '',
      '## 🔗 Navigation',
      '- Return to [[INDEX]] | Architecture: [[ARCHITECTURE]] | Rules: [[CONSTRAINTS]]',
      '',
    ].join('\n');
  }

  /**
   * Generates the DECISIONS.md aggregation hub
   */
  public async generateDecisionsHub(
    decisions: DecisionRecord[],
    canonicalDir: string,
    updatedAt = 0
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'DECISIONS.md');
    const content = this.renderDecisionsHub(decisions, updatedAt);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * Renders the RESEARCH.md aggregation hub content as a Markdown string
   */
  public renderResearchHub(
    researchFiles: { id: string; title: string; path: string }[] = [],
    updatedAt = 0
  ): string {
    const frontmatter = ObsidianExporter.renderFrontmatter({
      title: 'Research & Exploration Hub',
      type: 'research',
      tags: ['research', 'hub', 'spikes'],
      updated_at: new Date(updatedAt).toISOString(),
    });

    return [
      frontmatter,
      '',
      '# 🔬 Research & Exploration Hub',
      '',
      'Repository for spikes, technology evaluations, benchmarks, and deep-dive discoveries.',
      '',
      '| Note Link | Topic / Title | Reference |',
      '| :--- | :--- | :--- |',
      ...(researchFiles.length > 0
        ? researchFiles.map((r) => `| [[${r.id}]] | ${r.title} | \`${r.path}\` |`)
        : ['| *(None)* | No standalone research notes recorded | - |']),
      '',
      '## 🔗 Navigation',
      '- Return to [[INDEX]] | Tasks: [[TASKS]]',
      '',
    ].join('\n');
  }

  /**
   * Generates the RESEARCH.md aggregation hub
   */
  public async generateResearchHub(
    canonicalDir: string,
    researchFiles: { id: string; title: string; path: string }[] = [],
    updatedAt = 0
  ): Promise<string> {
    const filePath = path.join(canonicalDir, 'RESEARCH.md');
    const content = this.renderResearchHub(researchFiles, updatedAt);
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }
}
