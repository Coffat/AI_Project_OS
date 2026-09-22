import {
  TaskStatus,
  TaskPriority,
  DecisionStatus,
  ObsidianFrontmatter,
} from '../core/types.js';

export interface ParsedTaskMarkdown {
  id: string;
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedAgent?: string;
  goal?: string;
  description?: string;
  steps: { stepOrder: number; title: string; completed: boolean }[];
  rawFrontmatter: ObsidianFrontmatter;
}

export interface ParsedDecisionMarkdown {
  id: string;
  title?: string;
  status?: DecisionStatus;
  scope?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  rawFrontmatter: ObsidianFrontmatter;
}

export class ObsidianParser {
  /**
   * Splits a markdown file into frontmatter and body.
   */
  public static parseFrontmatter(markdown: string): {
    frontmatter: ObsidianFrontmatter;
    body: string;
  } {
    const trimmed = markdown.trimStart();
    if (!trimmed.startsWith('---')) {
      return { frontmatter: {}, body: markdown };
    }

    const endIndex = trimmed.indexOf('\n---', 3);
    if (endIndex === -1) {
      return { frontmatter: {}, body: markdown };
    }

    const frontmatterRaw = trimmed.slice(3, endIndex).trim();
    const body = trimmed.slice(endIndex + 4).trim();

    const frontmatter: ObsidianFrontmatter = {};
    const lines = frontmatterRaw.split('\n');

    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // Parse arrays like [tag1, tag2]
      if (value.startsWith('[') && value.endsWith(']')) {
        const items = value
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        frontmatter[key] = items;
      } else {
        // Strip outer quotes if any
        value = value.replace(/^["']|["']$/g, '');
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  }

  /**
   * Parses a task note (e.g. TASKS/TASK-042.md) into structured data for SQLite synchronization.
   */
  public static parseTask(markdown: string, fallbackId: string): ParsedTaskMarkdown {
    const { frontmatter, body } = this.parseFrontmatter(markdown);
    const id = (frontmatter.id as string) || fallbackId;
    const title = frontmatter.title as string | undefined;

    let status: TaskStatus | undefined;
    if (frontmatter.status) {
      const s = String(frontmatter.status).toLowerCase();
      const validStatuses: TaskStatus[] = [
        'planned',
        'in_progress',
        'blocked',
        'handoff',
        'resumed',
        'testing',
        'done',
      ];
      if (validStatuses.includes(s as TaskStatus)) {
        status = s as TaskStatus;
      }
    }

    let priority: TaskPriority | undefined;
    if (frontmatter.priority) {
      const p = String(frontmatter.priority).toLowerCase();
      const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
      if (validPriorities.includes(p as TaskPriority)) {
        priority = p as TaskPriority;
      }
    }

    const assignedAgent = frontmatter.assigned_agent
      ? String(frontmatter.assigned_agent)
      : undefined;

    // Parse Goal section
    const goalMatch = body.match(/## 🎯 Goal & Objective\s*\n([\s\S]*?)(?=\n##|$)/);
    const goal = goalMatch && goalMatch[1] ? goalMatch[1].trim() : undefined;

    // Parse Steps checklist: - [ ] or - [x]
    const steps: { stepOrder: number; title: string; completed: boolean }[] = [];
    const stepRegex = /-\s*\[([ xX])\]\s*(?:\*\*Step\s*(\d+)\*\*:\s*)?([^\n]+)/g;
    let stepMatch: RegExpExecArray | null;
    let fallbackOrder = 1;

    while ((stepMatch = stepRegex.exec(body)) !== null) {
      if (!stepMatch[1] || !stepMatch[3]) continue;
      const completed = stepMatch[1].toLowerCase() === 'x';
      const order = stepMatch[2] ? parseInt(stepMatch[2], 10) : fallbackOrder;
      const stepTitle = (stepMatch[3].trim().split(' — ')[0] ?? '').trim();

      steps.push({
        stepOrder: order,
        title: stepTitle,
        completed,
      });
      fallbackOrder++;
    }

    return {
      id,
      title,
      status,
      priority,
      assignedAgent,
      goal,
      description: goal,
      steps,
      rawFrontmatter: frontmatter,
    };
  }

  /**
   * Parses an ADR note (e.g. DECISIONS/DECISION-012.md) into structured data.
   */
  public static parseDecision(markdown: string, fallbackId: string): ParsedDecisionMarkdown {
    const { frontmatter, body } = this.parseFrontmatter(markdown);
    const id = (frontmatter.id as string) || fallbackId;
    const title = frontmatter.title as string | undefined;
    const scope = frontmatter.scope ? String(frontmatter.scope) : undefined;

    let status: DecisionStatus | undefined;
    if (frontmatter.status) {
      const s = String(frontmatter.status).toLowerCase();
      const validStatuses: DecisionStatus[] = ['proposed', 'accepted', 'rejected', 'superseded'];
      if (validStatuses.includes(s as DecisionStatus)) {
        status = s as DecisionStatus;
      }
    }

    const contextMatch = body.match(/## 📋 Context & Problem Statement\s*\n([\s\S]*?)(?=\n##|$)/);
    const context = contextMatch && contextMatch[1] ? contextMatch[1].trim() : undefined;

    const decisionMatch = body.match(/## 🎯 Decision\s*\n([\s\S]*?)(?=\n##|$)/);
    const decisionText = decisionMatch && decisionMatch[1] ? decisionMatch[1].trim() : undefined;

    const consequencesMatch = body.match(/## ⚖️ Consequences & Tradeoffs\s*\n([\s\S]*?)(?=\n##|$)/);
    const consequences = consequencesMatch && consequencesMatch[1] ? consequencesMatch[1].trim() : undefined;

    return {
      id,
      title,
      status,
      scope,
      context,
      decision: decisionText,
      consequences,
      rawFrontmatter: frontmatter,
    };
  }
}
