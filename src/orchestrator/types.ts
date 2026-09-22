import {
  Task,
  TaskPriority,
  HandoffRecord,
  HandoffGitState,
  ContextPack,
  ExecutionSessionRecord,
  HandoffSnapshotData,
  MemoryCompilationResult,
  TaskValidationResult,
} from '../core/types.js';
import { AgentAdapter, AgentPromptPayload } from '../agents/types.js';
import { SessionContinuityReport } from '../sessions/types.js';

export interface TaskExecutionPackage {
  task: Task;
  session: ExecutionSessionRecord;
  context: ContextPack;
  gitState: HandoffGitState;
  continuity?: SessionContinuityReport;
  recommendedNextAction: string;
  promptPayload?: AgentPromptPayload;
}

export interface TaskContinuationPackage {
  task: Task;
  session: ExecutionSessionRecord;
  handoff: HandoffRecord;
  context: ContextPack;
  continuity: SessionContinuityReport;
  nextAction: string;
  promptPayload?: AgentPromptPayload;
}

export interface StartOrchestratorTaskParams {
  taskId?: string;
  projectId?: string;
  title?: string;
  goal?: string;
  priority?: TaskPriority;
  provider?: string;
  agent?: string;
  accountLabel?: string;
  tokenBudget?: number;
  adapter?: AgentAdapter;
  metadata?: Record<string, unknown>;
}

export interface PrepareContextOptions {
  tokenBudget?: number;
}

export interface StartAgentSessionOptions {
  provider?: string;
  accountLabel?: string;
  tokenBudget?: number;
}

export interface AgentSessionPackage {
  session: ExecutionSessionRecord;
  task: Task;
  context: ContextPack;
  promptPayload: AgentPromptPayload;
}

export interface RecordProgressParams {
  taskId: string;
  stepId?: string;
  stepOrder?: number;
  completeStep?: boolean;
  addStep?: { title: string; description?: string; stepOrder?: number };
  decision?: { title: string; rationale: string; alternatives?: string[]; status?: 'proposed' | 'accepted' };
  blocker?: string;
  agentIdentity?: string;
}

export interface ProgressRecordResult {
  task: Task;
  completedStepId?: string;
  addedStepId?: string;
  recordedDecisionId?: string;
  recordedBlocker?: string;
}

export interface ValidateOrchestratorTaskOptions {
  skipLint?: boolean;
  skipTypecheck?: boolean;
  skipBuild?: boolean;
  skipArchitectureGuard?: boolean;
  strictGuard?: boolean;
  testCommand?: string;
  typecheckCommand?: string;
  lintCommand?: string;
  agentIdentity?: string;
  autoCompleteOnPass?: boolean;
}

export interface HandoffTaskParams {
  taskId: string;
  sessionId?: string;
  objective?: string;
  completedWork: string;
  nextAction: string;
  blockers?: string;
  modifiedFiles?: string[];
  decisions?: string[];
  tests?: string[];
  currentFile?: string;
  status?: 'handoff' | 'paused';
}

export interface HandoffTaskResult {
  handoff: HandoffRecord;
  snapshot: HandoffSnapshotData;
  session: ExecutionSessionRecord;
  task: Task;
  memoryResult?: MemoryCompilationResult;
  nextAction: string;
}

export interface ResumeOrchestratorTaskParams {
  taskId: string;
  provider?: string;
  agent?: string;
  accountLabel?: string;
  tokenBudget?: number;
  handoffId?: string;
  adapter?: AgentAdapter;
}

export interface CompleteTaskParams {
  taskId: string;
  sessionId?: string;
  finalNotes?: string;
  skipValidation?: boolean;
  validationOptions?: ValidateOrchestratorTaskOptions;
}

export interface CompleteTaskResult {
  task: Task;
  session: ExecutionSessionRecord;
  validation?: TaskValidationResult;
  memoryResult?: MemoryCompilationResult;
  gitDiffSummary?: string;
}
