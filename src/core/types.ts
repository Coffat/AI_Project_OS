/**
 * AI PROJECT OS - Core Domain Types
 */

export type TaskStatus = 'BACKLOG' | 'READY' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedAgent?: string;
  priority: TaskPriority;
  parentTaskId?: string;
  acceptanceCriteria?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  summary: string;
  gitCommitHash?: string;
  agentIdentity: string;
  createdAt: number;
}

export interface HandoffReport {
  id: string;
  taskId: string;
  fromAgent: string;
  statusSummary: string;
  blockers?: string;
  nextSteps: string;
  contextSnapshotJson?: string;
  createdAt: number;
}

export type MemoryCategory = 'CONSTITUTION' | 'ARCHITECTURE' | 'CONSTRAINT' | 'DECISION' | 'LESSON';

export interface MemoryItem {
  id: string;
  projectId: string;
  category: MemoryCategory;
  key: string;
  title: string;
  content: string;
  sourceFile: string;
  version: number;
  updatedAt: number;
}

export type GraphNodeType = 'FILE' | 'SYMBOL' | 'TASK' | 'DECISION' | 'MODULE';

export interface GraphNode {
  id: string;
  projectId: string;
  type: GraphNodeType;
  identifier: string;
  label: string;
  metadataJson?: string;
}

export type RelationType = 'IMPORTS' | 'CALLS' | 'IMPLEMENTS' | 'DEPENDS_ON' | 'DECIDED_BY' | 'AFFECTS';

export interface GraphEdge {
  sourceId: string;
  targetId: string;
  relationType: RelationType;
  weight?: number;
  metadataJson?: string;
}

export interface ContextPack {
  taskId: string;
  taskTitle: string;
  constitutionRules: string[];
  architectureRules: string[];
  relevantDecisions: MemoryItem[];
  relevantSymbols: Array<{
    name: string;
    filePath: string;
    kind: string;
    snippet?: string;
  }>;
  recentHandoff?: HandoffReport;
  tokenBudget: number;
  estimatedTokens: number;
}
