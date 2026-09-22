import { ContextPack, HandoffRecord } from '../core/types.js';

export type HandoffEntity = HandoffRecord;

export type AgentProvider =
  | 'antigravity'
  | 'claude'
  | 'gemini'
  | 'openai'
  | 'local'
  | 'mock';

export type AgentAdapterStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'error';

/**
 * Agent identity metadata.
 * AI Project OS is provider-agnostic and explicitly does not manage,
 * reverse engineer, or manipulate private authentication tokens, cookies, or quotas.
 */
export interface AgentIdentity {
  provider: AgentProvider;
  agentName: string;
  sessionId: string;
  accountLabel?: string;
}

export interface AgentAdapterState {
  identity: AgentIdentity;
  status: AgentAdapterStatus;
  currentTaskId?: string;
  startedAt?: number;
  lastActivityAt?: number;
  metadata?: Record<string, unknown>;
}

export interface StartTaskParams {
  taskId: string;
  initialContext?: ContextPack;
}

export interface SendContextParams {
  taskId: string;
  context: ContextPack;
  incremental?: boolean;
}

export interface SaveHandoffParams {
  taskId: string;
  objective: string;
  completedWork: string;
  nextAction: string;
  blockers?: string;
  modifiedFiles?: string[];
  decisions?: string[];
  tests?: string[];
  currentFile?: string;
  cursorPosition?: { line: number; column: number };
}

export interface ResumeTaskParams {
  taskId: string;
  handoffId?: string;
  context: ContextPack;
}

export interface AgentPromptPayload {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Common provider-agnostic AgentAdapter interface.
 */
export interface AgentAdapter {
  readonly identity: AgentIdentity;
  readonly agentName: string;

  start(params: StartTaskParams): Promise<AgentAdapterState>;
  getStatus(): Promise<AgentAdapterState>;
  sendContext(params: SendContextParams): Promise<AgentPromptPayload | void>;
  saveHandoff(params: SaveHandoffParams): Promise<HandoffEntity>;
  resumeTask(params: ResumeTaskParams): Promise<AgentAdapterState>;
  stop?(): Promise<AgentAdapterState>;
}
