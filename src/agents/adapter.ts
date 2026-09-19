import { ContextPack } from '../core/types.js';

export interface AgentPromptPayload {
  systemPrompt: string;
  userPrompt: string;
}

export interface IAgentAdapter {
  readonly agentName: string;
  formatContextEnvelope(context: ContextPack): AgentPromptPayload;
}

export abstract class BaseAgentAdapter implements IAgentAdapter {
  abstract readonly agentName: string;

  public formatContextEnvelope(context: ContextPack): AgentPromptPayload {
    const systemPrompt = [
      `You are an AI coding agent operating under AI PROJECT OS.`,
      `=== CONSTITUTION & IMMUTABLE RULES ===`,
      ...context.constitutionRules,
      `=== ARCHITECTURE GUIDELINES ===`,
      ...context.architectureRules,
    ].join('\n\n');

    const userPrompt = [
      `Active Task: [${context.taskId}] ${context.taskTitle}`,
      context.recentHandoff
        ? `\n=== PREVIOUS AGENT HANDOFF ===\nFrom: ${context.recentHandoff.agentIdentity}\nObjective: ${context.recentHandoff.objective}\nCompleted: ${context.recentHandoff.completedWork}\nBlockers: ${context.recentHandoff.blockers ?? 'None'}\nNext Action: ${context.recentHandoff.nextAction}`
        : '',
      context.relevantDecisions.length > 0
        ? `\n=== RELEVANT ARCHITECTURAL DECISIONS ===\n` +
          context.relevantDecisions.map((d) => `* ${d.title}: ${d.content.slice(0, 200)}...`).join('\n')
        : '',
      `\nPlease execute this task. When finished or before context limit, produce a handoff report.`,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      systemPrompt,
      userPrompt,
    };
  }
}

export class ClaudeAdapter extends BaseAgentAdapter {
  readonly agentName = 'ClaudeCode';
}

export class AntigravityAdapter extends BaseAgentAdapter {
  readonly agentName = 'Antigravity';
}

export class GeminiAdapter extends BaseAgentAdapter {
  readonly agentName = 'GeminiCLI';
}

export class OpenAIAdapter extends BaseAgentAdapter {
  readonly agentName = 'OpenAICodex';
}
