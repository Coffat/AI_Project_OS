import {
  Task,
  HandoffReport,
  MemoryItem,
  GraphNode,
  DecisionRecord,
  ConstraintRecord,
  ExecutionSessionRecord,
} from '../core/types.js';

export interface UIHeaderState {
  project: {
    id: string;
    name: string;
    rootPath: string;
    description?: string;
  };
  git: {
    branch: string;
    commitHash: string;
    isDirty: boolean;
    modifiedCount: number;
    untrackedCount: number;
  };
  currentTask?: {
    id: string;
    title: string;
    status: string;
    priority: string;
  };
  currentAgent?: {
    name: string;
    provider: string;
  };
  currentSession?: {
    id: string;
    status: string;
    startedAt: number;
    accountLabel?: string;
  };
}

export interface UITaskStepItem {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  stepOrder: number;
}

export interface UITaskPanelState {
  task?: {
    id: string;
    projectId: string;
    title: string;
    goal?: string;
    description?: string;
    status: string;
    priority: string;
    assignedAgent?: string;
    createdAt: number;
    updatedAt: number;
  };
  currentStep?: string;
  progressPercentage: number;
  steps: UITaskStepItem[];
  blockers: string[];
  nextAction: string;
  allTasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
  }>;
}

export interface UIRelevantFileItem {
  path: string;
  relevance: number;
  reason: string;
  tokenCount: number;
}

export interface UIRelevantSymbolItem {
  name: string;
  kind: string;
  filePath: string;
  line: number;
  signature?: string;
}

export interface UIContextPanelState {
  contextBudget: number;
  tokensUsed: number;
  utilizationPercentage: number;
  relevantFiles: UIRelevantFileItem[];
  relevantSymbols: UIRelevantSymbolItem[];
  relevantDecisions: Array<{
    id: string;
    title: string;
    status: string;
    rationale: string;
  }>;
  relevantConstraints: Array<{
    id: string;
    title: string;
    type: string;
    severity: string;
    description: string;
  }>;
}

export interface UIMemoryPanelState {
  projectKnowledge: string;
  architecture: string;
  decisions: DecisionRecord[];
  constraints: ConstraintRecord[];
  research: Array<{
    id: string;
    title: string;
    status: string;
    question?: string;
    createdAt: number;
  }>;
}

export interface UIGraphNode {
  id: string;
  label: string;
  type: 'file' | 'symbol' | 'task' | 'decision' | 'constraint';
  metadata: Record<string, unknown>;
}

export interface UIGraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'imports' | 'calls' | 'implements' | 'depends_on' | 'defines';
  weight?: number;
}

export interface UIGraphPanelState {
  nodes: UIGraphNode[];
  edges: UIGraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    byType: Record<string, number>;
  };
}

export interface UIHandoffPanelState {
  currentHandoff?: {
    id: string;
    taskId: string;
    objective: string;
    completedWork: string;
    nextAction: string;
    blockers?: string;
    agentIdentity: string;
    createdAt: number;
    gitState?: {
      branch?: string;
      commitHash?: string;
      isDirty?: boolean;
    };
  };
  lastSession?: ExecutionSessionRecord;
  previousSessions: ExecutionSessionRecord[];
}

export interface UIValidationGateState {
  status: 'passed' | 'failed' | 'pending' | 'none';
  durationMs?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  lastRunAt?: number;
}

export interface UIValidationPanelState {
  tests: UIValidationGateState;
  lint: UIValidationGateState;
  typecheck: UIValidationGateState;
  build: UIValidationGateState;
  gitDiff: {
    modified: string[];
    added: string[];
    deleted: string[];
    summary: string;
  };
  overallStatus: 'passed' | 'failed' | 'pending' | 'none';
}

export interface UIAgentPanelState {
  currentProvider: string;
  agent: string;
  session?: string;
  accountLabel: string;
  sessions: Array<{
    id: string;
    provider: string;
    agent: string;
    accountLabel?: string;
    status: string;
    startedAt: number;
    endedAt?: number;
  }>;
}

export interface FullDashboardState {
  header: UIHeaderState;
  taskPanel: UITaskPanelState;
  contextPanel: UIContextPanelState;
  memoryPanel: UIMemoryPanelState;
  graphPanel: UIGraphPanelState;
  handoffPanel: UIHandoffPanelState;
  validationPanel: UIValidationPanelState;
  agentPanel: UIAgentPanelState;
}

export interface SaveHandoffInput {
  taskId: string;
  completedWork: string;
  nextAction: string;
  blockers?: string;
  currentFile?: string;
  decisions?: string[];
}

export interface ResumeTaskInput {
  taskId: string;
  provider?: string;
  agent?: string;
  accountLabel?: string;
}

export interface ValidateTaskInput {
  taskId: string;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
}

export interface RecordProgressInput {
  taskId: string;
  stepId?: string;
  addStep?: { title: string };
  completeStep?: boolean;
  blocker?: string;
}

// --- Provider & Account Cockpit Types ---
export type UIProviderType =
  | 'antigravity'
  | 'cursor'
  | 'windsurf'
  | 'copilot'
  | 'claude'
  | 'openai';

export interface UIFingerprint {
  machineId: string;
  macMachineId: string;
  sqmId: string;
  devDeviceId: string;
}

export interface UIQuotaInfo {
  totalCredits?: number;
  usedCredits?: number;
  remainingCredits?: number;
  planType: 'Free' | 'Pro' | 'Team' | 'Enterprise' | 'Custom';
  resetAt?: number;
  lastCheckedAt: number;
}

export interface UIProviderAccount {
  id: string;
  provider: UIProviderType;
  name: string;
  accountLabel: string;
  email?: string;
  isActive: boolean;
  fingerprint: UIFingerprint;
  quota?: UIQuotaInfo;
  notes?: string;
  configPath?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UICaptureAccountInput {
  provider: UIProviderType;
  name: string;
  accountLabel?: string;
  email?: string;
  notes?: string;
}

export interface UIAddAccountManualInput {
  provider: UIProviderType;
  name: string;
  accountLabel?: string;
  email?: string;
  notes?: string;
  rawConfigJson?: string;
}

export interface UISwitchAccountInput {
  accountId: string;
  forceClose?: boolean;
}

export interface UISwitchAccountResult {
  success: boolean;
  previousAccountId?: string;
  activeAccountId: string;
  provider: UIProviderType;
  processTerminated: boolean;
  message: string;
}

export interface UIProviderCockpitState {
  accounts: UIProviderAccount[];
  activeAccountsByProvider: Record<string, UIProviderAccount | undefined>;
  providers: Array<{
    id: UIProviderType;
    name: string;
    description: string;
    isInstalled: boolean;
    activeAccount?: UIProviderAccount;
    totalAccounts: number;
  }>;
}

// Backward compatibility
export interface UIDashboardState {
  currentProject: string;
  activeTasks: Task[];
  recentHandoffs: HandoffReport[];
  pinnedDecisions: MemoryItem[];
  graphOverview: {
    totalNodes: number;
    totalEdges: number;
    sampleNodes: GraphNode[];
  };
}

export interface IUIBridge {
  getDashboardState(): Promise<UIDashboardState>;
}

export interface UIProjectItem {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

export interface UIProjectsState {
  projects: UIProjectItem[];
  activeProjectId: string;
}

export interface CreateProjectInput {
  name?: string;
  rootPath: string;
  description?: string;
}

export interface SwitchProjectInput {
  projectId: string;
}

