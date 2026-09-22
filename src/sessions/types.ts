import {
  Task,
  HandoffRecord,
  HandoffGitState,
  ContextPack,
  ExecutionSessionRecord,
} from '../core/types.js';

export type ContinuityMismatchSeverity = 'warning' | 'error' | 'info';

export interface ContinuityMismatch {
  code:
    | 'GIT_BRANCH_MISMATCH'
    | 'GIT_COMMIT_MISMATCH'
    | 'MODIFIED_FILE_DISCREPANCY'
    | 'UNCOMMITTED_CHANGES_DETECTED'
    | 'ACTIVE_TASK_BLOCKER'
    | 'MISSING_PREVIOUS_HANDOFF'
    | 'STALE_VALIDATION';
  message: string;
  severity: ContinuityMismatchSeverity;
  details?: Record<string, unknown>;
}

export interface SessionContinuityReport {
  isConsistent: boolean;
  gitState: HandoffGitState;
  mismatches: ContinuityMismatch[];
  task: Task;
  latestHandoff?: HandoffRecord;
  recommendedNextAction: string;
  validationSummary?: {
    totalRuns: number;
    latestStatus?: string;
    failedValidators: string[];
  };
}

export interface StartSessionOptions {
  provider?: string;
  agent?: string;
  accountLabel?: string;
  tokenBudget?: number;
  metadata?: Record<string, unknown>;
}

export interface EndSessionOptions {
  objective?: string;
  completedWork: string;
  nextAction: string;
  blockers?: string;
  modifiedFiles?: string[];
  decisions?: string[];
  tests?: string[];
  currentFile?: string;
  status?: 'ended' | 'handoff' | 'paused';
}

export interface ResumeSessionOptions {
  provider?: string;
  agent?: string;
  accountLabel?: string;
  tokenBudget?: number;
  handoffId?: string;
}

export interface StartSessionResult {
  session: ExecutionSessionRecord;
  task: Task;
  context: ContextPack;
  continuity: SessionContinuityReport;
  nextAction: string;
}

export interface EndSessionResult {
  session: ExecutionSessionRecord;
  handoff: HandoffRecord;
  task: Task;
  nextAction: string;
}

export interface SessionStatusView {
  session: ExecutionSessionRecord;
  task?: Task;
  latestHandoff?: HandoffRecord;
  continuity?: SessionContinuityReport;
}
