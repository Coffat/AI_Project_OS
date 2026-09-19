import { ContextPack, Task } from '../core/types.js';
import { ITaskEngine } from '../tasks/task-engine.js';
import { IMemoryEngine } from '../memory/memory-engine.js';
import { IHandoffEngine } from '../handoff/handoff-engine.js';

export interface IContextEngine {
  buildTaskContext(task: Task, tokenBudget?: number): Promise<ContextPack>;
}

export class ContextEngine implements IContextEngine {
  constructor(
    private readonly taskEngine: ITaskEngine,
    private readonly memoryEngine: IMemoryEngine,
    private readonly handoffEngine: IHandoffEngine
  ) {}

  public async buildTaskContext(task: Task, tokenBudget = 8000): Promise<ContextPack> {
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
