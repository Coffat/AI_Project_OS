import { ContextPack, Task, GetContextResult, ContextOptions } from '../core/types.js';
import { ITaskEngine } from '../tasks/task-engine.js';
import { IMemoryEngine } from '../memory/memory-engine.js';
import { IHandoffEngine } from '../handoff/handoff-engine.js';
import { ContextService } from './context-service.js';

export interface IContextEngine {
  buildTaskContext(task: Task, tokenBudget?: number): Promise<ContextPack>;
  getContext?(taskId: string, budget?: number, options?: ContextOptions): Promise<GetContextResult>;
}

export class ContextEngine implements IContextEngine {
  constructor(
    private readonly taskEngine: ITaskEngine,
    private readonly memoryEngine: IMemoryEngine,
    private readonly handoffEngine: IHandoffEngine,
    private readonly contextService?: ContextService
  ) {}

  public async getContext(
    taskId: string,
    budget = 8000,
    options: ContextOptions = {}
  ): Promise<GetContextResult> {
    if (this.contextService) {
      return this.contextService.getContext(taskId, budget, options);
    }
    const task = await this.taskEngine.getTask(taskId);
    const pack = await this.buildTaskContext(task, budget);
    return {
      context: `# TASK CONTEXT: [${task.id}] ${task.title}\n\nObjective: ${task.description ?? task.title}`,
      token_estimate: pack.estimatedTokens,
      included_entities: [{ id: task.id, type: 'task', tokens: pack.estimatedTokens, score: 1000 }],
      excluded_entities: [],
      reasoning_metadata: {
        tokenBudget: budget,
        totalCandidates: 1,
        includedCount: 1,
        excludedCount: 0,
        budgetUtilizationPercent: Math.round((pack.estimatedTokens / budget) * 100),
        rankingStrategy: 'direct task relation',
      },
      pack,
    };
  }

  public async buildTaskContext(task: Task, tokenBudget = 8000): Promise<ContextPack> {
    if (this.contextService) {
      return this.contextService.buildContextPack(task, tokenBudget);
    }

    // 1. Fetch constitution & architecture rules from canonical memory
    const constitutionMemories = await this.memoryEngine.searchMemory('constitution', 'CONSTITUTION');
    const architectureMemories = await this.memoryEngine.searchMemory('architecture', 'ARCHITECTURE');

    const constitutionRules = constitutionMemories.map((m) => m.content.slice(0, 300));
    const architectureRules = architectureMemories.map((m) => m.content.slice(0, 300));

    // 2. Fetch relevant decisions using task title words
    const keywords = task.title.split(' ').filter((w) => w.length > 3);
    const relevantDecisions = [];
    for (const kw of keywords) {
      const decs = await this.memoryEngine.searchMemory(kw, 'DECISION');
      relevantDecisions.push(...decs);
    }

    // 3. Fetch latest handoff for continuity
    const recentHandoff = (await this.handoffEngine.getLatestHandoff(task.id)) ?? undefined;

    // 4. Resolve parent task context if available
    let contextualTitle = task.title;
    if (task.parentTaskId) {
      try {
        const parent = await this.taskEngine.getTask(task.parentTaskId);
        contextualTitle = `[Parent: ${parent.title}] ${task.title}`;
      } catch {
        // Parent task might not exist or be deleted
      }
    }

    // Estimate tokens (4 chars ~ 1 token)
    const estimatedTokens = Math.ceil(
      (constitutionRules.join(' ').length +
        architectureRules.join(' ').length +
        (task.description?.length ?? 0) +
        contextualTitle.length +
        (recentHandoff?.completedWork.length ?? 0)) / 4
    );

    return {
      taskId: task.id,
      taskTitle: contextualTitle,
      task,
      objective: task.description ?? task.title,
      current_state: {
        status: task.status,
        phase: task.currentStep,
        currentStep: task.currentStep ?? task.status,
        blockers: recentHandoff?.blockers ? [recentHandoff.blockers] : [],
      },

      relevant_files: [],
      relevant_symbols: [],
      relevant_decisions: relevantDecisions.map((d) => ({
        id: d.id,
        title: d.id,
        status: 'Accepted',
        summary: d.content,
      })),
      relevant_constraints: constitutionRules.map((c, i) => ({
        id: `c-${i}`,
        title: 'Constraint',
        rule: c,
      })),
      relevant_tests: [],
      relevant_handoff: recentHandoff ?? null,
      next_action: recentHandoff?.nextAction ?? 'Proceed with task implementation',
      constitutionRules,
      architectureRules,
      relevantDecisions: relevantDecisions.slice(0, 5),
      relevantSymbols: [],
      recentHandoff,
      tokenBudget,
      estimatedTokens,
    };
  }
}
