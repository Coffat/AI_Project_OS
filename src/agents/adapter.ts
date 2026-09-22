import { randomUUID } from 'node:crypto';
import { ContextPack, HandoffRecord } from '../core/types.js';
import {
  AgentAdapter,
  AgentAdapterState,
  AgentAdapterStatus,
  AgentIdentity,
  AgentPromptPayload,
  AgentProvider,
  ResumeTaskParams,
  SaveHandoffParams,
  SendContextParams,
  StartTaskParams,
} from './types.js';

export { AgentPromptPayload } from './types.js';

/**
 * Backward compatibility interface for previous phases
 */
export interface IAgentAdapter {
  readonly agentName: string;
  formatContextEnvelope(context: ContextPack): AgentPromptPayload;
}

export type HandoffHandler = (
  params: SaveHandoffParams,
  identity: AgentIdentity
) => Promise<HandoffRecord>;

export interface BaseAgentAdapterOptions {
  identity?: Partial<AgentIdentity>;
  handoffHandler?: HandoffHandler;
  metadata?: Record<string, unknown>;
}

export abstract class BaseAgentAdapter implements AgentAdapter, IAgentAdapter {
  public abstract readonly provider: AgentProvider;
  public abstract readonly agentName: string;

  protected _identity: AgentIdentity | null = null;
  protected _status: AgentAdapterStatus = 'idle';
  protected _currentTaskId?: string;
  protected _startedAt?: number;
  protected _lastActivityAt?: number;
  protected _metadata: Record<string, unknown> = {};
  protected _handoffHandler?: HandoffHandler;
  protected _lastReceivedContext?: ContextPack;

  constructor(options?: BaseAgentAdapterOptions) {
    if (options?.handoffHandler) {
      this._handoffHandler = options.handoffHandler;
    }
    if (options?.metadata) {
      this._metadata = { ...options.metadata };
    }
    if (options?.identity) {
      this._identity = {
        provider: options.identity.provider ?? 'antigravity',
        agentName: options.identity.agentName ?? 'Agent',
        sessionId: options.identity.sessionId ?? randomUUID(),
        accountLabel: options.identity.accountLabel,
      };
    }
  }

  public get identity(): AgentIdentity {
    if (!this._identity) {
      this._identity = {
        provider: this.provider,
        agentName: this.agentName,
        sessionId: randomUUID(),
        accountLabel: 'default',
      };
    }
    return this._identity;
  }

  public setHandoffHandler(handler: HandoffHandler): void {
    this._handoffHandler = handler;
  }

  public formatContextEnvelope(context: ContextPack): AgentPromptPayload {
    const systemPrompt = [
      `You are an AI coding agent (${this.identity.agentName}) operating under AI PROJECT OS.`,
      `Provider: ${this.identity.provider} | Session: ${this.identity.sessionId}`,
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
          context.relevantDecisions
            .map((d) => `* ${d.title}: ${d.content.slice(0, 200)}...`)
            .join('\n')
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

  public async start(params: StartTaskParams): Promise<AgentAdapterState> {
    this._status = 'running';
    this._currentTaskId = params.taskId;
    this._startedAt = Date.now();
    this._lastActivityAt = Date.now();

    if (params.initialContext) {
      this._lastReceivedContext = params.initialContext;
    }

    return this.getStatus();
  }

  public async getStatus(): Promise<AgentAdapterState> {
    return {
      identity: this.identity,
      status: this._status,
      currentTaskId: this._currentTaskId,
      startedAt: this._startedAt,
      lastActivityAt: this._lastActivityAt,
      metadata: { ...this._metadata },
    };
  }

  public async sendContext(
    params: SendContextParams
  ): Promise<AgentPromptPayload | void> {
    this._lastReceivedContext = params.context;
    this._lastActivityAt = Date.now();
    return this.formatContextEnvelope(params.context);
  }

  public async saveHandoff(params: SaveHandoffParams): Promise<HandoffRecord> {
    this._lastActivityAt = Date.now();

    if (this._handoffHandler) {
      return this._handoffHandler(params, this.identity);
    }

    // Default standalone fallback if not connected through lifecycle manager
    const now = Date.now();
    const record: HandoffRecord = {
      id: randomUUID(),
      taskId: params.taskId,
      projectId: 'standalone-project',
      objective: params.objective,
      completedWork: params.completedWork,
      currentFile: params.currentFile,
      modifiedFiles: params.modifiedFiles ?? [],
      decisions: params.decisions ?? [],
      blockers: params.blockers,
      tests: params.tests ?? [],
      nextAction: params.nextAction,
      gitState: {},
      agentIdentity: this.identity.agentName,
      createdAt: now,
    };

    return record;
  }

  public async resumeTask(params: ResumeTaskParams): Promise<AgentAdapterState> {
    this._status = 'running';
    this._currentTaskId = params.taskId;
    this._lastReceivedContext = params.context;
    this._lastActivityAt = Date.now();

    return this.getStatus();
  }

  public async stop(): Promise<AgentAdapterState> {
    this._status = 'stopped';
    this._lastActivityAt = Date.now();
    return this.getStatus();
  }
}

/**
 * AntigravityAdapter
 *
 * Implements the concrete integration boundary for Antigravity agents.
 * Strict ethical boundary:
 * - Does NOT reverse engineer private session internals.
 * - Does NOT copy cookies or authorization tokens.
 * - Does NOT rotate accounts to circumvent quotas.
 * - Agent identity is strictly metadata.
 */
export class AntigravityAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'antigravity';
  public readonly agentName = 'Antigravity';

  constructor(options?: BaseAgentAdapterOptions) {
    super({
      ...options,
      identity: {
        provider: 'antigravity',
        agentName: 'Antigravity',
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'primary',
      },
    });
  }
}

/**
 * ClaudeAdapter
 * Standard adapter implementation for Anthropic Claude / Claude Code.
 */
export class ClaudeAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'claude';
  public readonly agentName = 'ClaudeCode';

  constructor(options?: BaseAgentAdapterOptions) {
    super({
      ...options,
      identity: {
        provider: 'claude',
        agentName: 'ClaudeCode',
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'anthropic-tier',
      },
    });
  }
}

/**
 * GeminiAdapter
 * Standard adapter implementation for Google Gemini CLI / AI Studio.
 */
export class GeminiAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'gemini';
  public readonly agentName = 'GeminiCLI';

  constructor(options?: BaseAgentAdapterOptions) {
    super({
      ...options,
      identity: {
        provider: 'gemini',
        agentName: 'GeminiCLI',
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'workspace-google',
      },
    });
  }
}

/**
 * OpenAIAdapter
 * Standard adapter implementation for OpenAI ChatGPT / Codex.
 */
export class OpenAIAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'openai';
  public readonly agentName = 'OpenAICodex';

  constructor(options?: BaseAgentAdapterOptions) {
    super({
      ...options,
      identity: {
        provider: 'openai',
        agentName: 'OpenAICodex',
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'openai-dev',
      },
    });
  }
}

/**
 * LocalModelAdapter
 * Provider adapter for offline/self-hosted local models (Ollama, vLLM, Llama.cpp).
 */
export class LocalModelAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'local';
  public readonly agentName = 'LocalLLM';

  constructor(
    endpoint: string = 'http://localhost:11434',
    options?: BaseAgentAdapterOptions
  ) {
    super({
      ...options,
      identity: {
        provider: 'local',
        agentName: 'LocalLLM',
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'localhost',
      },
      metadata: {
        endpoint,
        ...options?.metadata,
      },
    });
  }
}

/**
 * MockAgentAdapter
 * Dedicated test adapter for simulating agent interactions, verifying received
 * context envelopes, step completions, and recording lifecycle transitions.
 */
export class MockAgentAdapter extends BaseAgentAdapter {
  public readonly provider: AgentProvider = 'mock';
  public readonly agentName: string;

  public receivedEnvelopes: AgentPromptPayload[] = [];
  public executedSteps: string[] = [];

  constructor(
    name: string = 'MockAgent',
    options?: BaseAgentAdapterOptions
  ) {
    super({
      ...options,
      identity: {
        provider: 'mock',
        agentName: name,
        sessionId: options?.identity?.sessionId ?? randomUUID(),
        accountLabel: options?.identity?.accountLabel ?? 'test-suite',
      },
    });
    this.agentName = name;
  }

  public override async sendContext(
    params: SendContextParams
  ): Promise<AgentPromptPayload> {
    const payload = this.formatContextEnvelope(params.context);
    this.receivedEnvelopes.push(payload);
    this._lastReceivedContext = params.context;
    this._lastActivityAt = Date.now();
    return payload;
  }

  public simulateStepExecution(stepTitle: string): void {
    this.executedSteps.push(stepTitle);
    this._lastActivityAt = Date.now();
  }
}
