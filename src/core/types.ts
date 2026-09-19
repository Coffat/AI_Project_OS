/**
 * AI PROJECT OS - Core Domain Types
 */

// --- Task Lifecycle ---
export type TaskStatus =
  | 'planned'
  | 'in_progress'
  | 'blocked'
  | 'handoff'
  | 'resumed'
  | 'testing'
  | 'done';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ProjectInfo {
  id: string;
  name: string;
  rootPath: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  goal?: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  currentStep?: string;
  assignedAgent?: string;
  parentTaskId?: string;
  version: number;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type TaskStepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

export interface TaskStep {
  id: string;
  taskId: string;
  stepOrder: number;
  title: string;
  status: TaskStepStatus;
  resultSummary?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskBlocker {
  id: string;
  taskId: string;
  reason: string;
  resolved: boolean;
  resolvedAt?: number;
  createdAt: number;
}

export interface TaskFileRelation {
  id: string;
  taskId: string;
  filePath: string;
  relationType: 'created' | 'modified' | 'referenced';
  createdAt: number;
}

export interface TaskSymbolRelation {
  id: string;
  taskId: string;
  symbolId?: string;
  symbolName: string;
  createdAt: number;
}

export interface TaskSnapshot {
  taskId: string;
  taskTitle: string;
  goal: string;
  status: TaskStatus;
  currentStep?: string;
  completedSteps: string[];
  remainingSteps: string[];
  files: string[];
  symbols?: string[];
  decisions: string[];
  blockers: string[];
  nextAction: string;
  timestamp: number;
}

export interface TaskCheckpoint {
  id: string;
  taskId: string;
  summary: string;
  gitCommitHash?: string;
  agentIdentity: string;
  createdAt: number;
}

// --- Handoff Model (14 core attributes) ---
export interface HandoffRecord {
  id: string;
  taskId: string;
  projectId: string;
  objective: string;
  completedWork: string;
  currentStep?: string;
  currentFile?: string;
  modifiedFiles: string[];
  decisions: string[];
  blockers?: string;
  errors?: string;
  tests: string[];
  nextAction: string;
  gitState: {
    commitHash?: string;
    branch?: string;
    isDirty?: boolean;
    untrackedFilesCount?: number;
  };
  agentIdentity: string;
  createdAt: number;
}

// Backward-compatibility alias
export type HandoffReport = HandoffRecord;

// --- Decisions & Constraints ---
export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | 'rejected';

export interface DecisionRecord {
  id: string;
  projectId: string;
  taskId?: string;
  title: string;
  context: string;
  decisionRationale: string;
  consequences?: string;
  status: DecisionStatus;
  sourceFile?: string;
  createdAt: number;
  updatedAt: number;
}

export type ConstraintCategory = 'architecture' | 'technology' | 'security' | 'performance' | 'policy';
export type ConstraintEnforcement = 'mandatory' | 'advisory';

export interface ConstraintRecord {
  id: string;
  projectId: string;
  category: ConstraintCategory;
  title: string;
  ruleContent: string;
  enforcementLevel: ConstraintEnforcement;
  sourceFile?: string;
  createdAt: number;
  updatedAt: number;
}

// --- Memory Documents & Chunks ---
export type MemoryDocType = 'canonical' | 'lesson' | 'research';

export interface MemoryDocument {
  id: string;
  projectId: string;
  docType: MemoryDocType;
  path: string;
  title: string;
  contentHash: string;
  rawContent: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  metadataJson?: string;
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

// --- Files & Code Intelligence ---
export interface FileEntity {
  id: string;
  projectId: string;
  path: string;
  language?: string;
  sizeBytes: number;
  lastModifiedAt: number;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'variable'
  | 'type'
  | 'model'
  | 'api'
  | 'test';

export interface SymbolEntity {
  id: string;
  fileId: string;
  projectId: string;
  name: string;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  docstring?: string;
  createdAt: number;
}

// --- Knowledge & Code Graph ---
export type GraphEntityType =
  | 'task'
  | 'file'
  | 'symbol'
  | 'module'
  | 'decision'
  | 'constraint'
  | 'memory'
  | 'research'
  | 'test'
  | 'validation';

export interface GraphNode {
  id: string;
  projectId: string;
  entityType: GraphEntityType;
  entityId: string;
  label: string;
  name?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  metadataJson?: string;
  createdAt: number;
}

export type GraphRelationType =
  | 'imports'
  | 'calls'
  | 'implements'
  | 'depends_on'
  | 'decides'
  | 'validates'
  | 'affects'
  | 'contains'
  | 'exports'
  | 'tests'
  | 'tested_by'
  | 'modifies'
  | 'constrained_by'
  | 'relates_to'
  | 'references'
  | 'dependency';

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: GraphRelationType;
  weight?: number;
  metadataJson?: string;
  createdAt: number;
}

export interface GraphTraversalOptions {
  direction?: 'OUT' | 'IN' | 'BOTH';
  maxDepth?: number;
  relationTypes?: GraphRelationType[];
  entityTypes?: GraphEntityType[];
  limit?: number;
}

export interface RankedGraphNode {
  node: GraphNode;
  score: number;
  distance: number;
  reasons: string[];
}

export interface GraphPathResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  distance: number;
  totalWeight: number;
}

export interface TaskGraphContext {
  taskNode: GraphNode;
  modifiedFiles: Array<{ node: GraphNode; path: string; score: number }>;
  dependencies: Array<{ node: GraphNode; relation: GraphRelationType; depth: number }>;
  decisions: Array<{ node: GraphNode; label: string; relation: GraphRelationType }>;
  constraints: Array<{ node: GraphNode; label: string; relation: GraphRelationType }>;
  symbols: Array<{ node: GraphNode; name: string }>;
  tests: Array<{ node: GraphNode; path: string }>;
  memories: Array<{ node: GraphNode; label: string }>;
  rankedRelated: RankedGraphNode[];
}

export interface DecisionGraphContext {
  decisionNode: GraphNode;
  constraints: Array<{ node: GraphNode; label: string }>;
  dependentTasks: Array<{ node: GraphNode; label: string }>;
  affectedFiles: Array<{ node: GraphNode; path: string }>;
  affectedSymbols: Array<{ node: GraphNode; name: string }>;
  relatedMemories: Array<{ node: GraphNode; label: string }>;
}

export interface FileGraphContext {
  fileNode: GraphNode;
  path: string;
  modifyingTasks: Array<{ node: GraphNode; label: string }>;
  relatedTests: Array<{ node: GraphNode; path: string }>;
  importedFiles: Array<{ node: GraphNode; path: string }>;
  importerFiles: Array<{ node: GraphNode; path: string }>;
  symbols: Array<{ node: GraphNode; name: string; kind?: string }>;
  relatedDecisions: Array<{ node: GraphNode; label: string }>;
}

export interface GraphIntegrityReport {
  isValid: boolean;
  totalNodes: number;
  totalEdges: number;
  danglingEdges: Array<{ edgeId: string; missingNodeId: string; reason: string }>;
  isolatedNodes: Array<{ nodeId: string; label: string; entityType: GraphEntityType }>;
  selfLoops: Array<{ edgeId: string; nodeId: string }>;
  details: string[];
}

// --- Code Intelligence Engine Domain Types ---
export interface ImportInfo {
  sourceModule: string;
  specifiers: Array<{ name: string; alias?: string; isTypeOnly?: boolean }>;
  isDefault: boolean;
  defaultAlias?: string;
  isNamespace: boolean;
  namespaceAlias?: string;
  lineStart: number;
  lineEnd: number;
}

export interface ExportInfo {
  name: string;
  exportedName: string;
  isDefault: boolean;
  kind: SymbolKind;
  lineStart: number;
  lineEnd: number;
}

export interface CallInfo {
  callerSymbolName?: string;
  calleeName: string;
  calleeModule?: string;
  lineStart: number;
  lineEnd: number;
}

export interface ImplementsInfo {
  className: string;
  interfaceName: string;
  lineStart: number;
  lineEnd: number;
}

export interface TestInfo {
  testName: string;
  suiteName?: string;
  calledSymbols: string[];
  lineStart: number;
  lineEnd: number;
}

export interface ApiInfo {
  httpMethod?: string;
  routePath?: string;
  handlerName: string;
  lineStart: number;
  lineEnd: number;
}

export interface DatabaseModelInfo {
  modelName: string;
  modelType: 'table' | 'entity' | 'schema';
  lineStart: number;
  lineEnd: number;
}

export interface AstAnalysisResult {
  filePath: string;
  language: string;
  symbols: Array<{
    name: string;
    kind: SymbolKind;
    lineStart: number;
    lineEnd: number;
    signature?: string;
    docstring?: string;
    parentSymbolName?: string;
  }>;
  imports: ImportInfo[];
  exports: ExportInfo[];
  calls: CallInfo[];
  implements: ImplementsInfo[];
  tests: TestInfo[];
  apis: ApiInfo[];
  models: DatabaseModelInfo[];
}

export interface GitChangedFiles {
  added: string[];
  modified: string[];
  deleted: string[];
  renamed: Array<{ from: string; to: string }>;
}

// --- Audit & Events ---
export interface AuditEvent {
  id: string;
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payloadJson?: string;
  agentIdentity: string;
  createdAt: number;
}

// --- Research & Proposals ---
export interface ResearchDocument {
  id: string;
  projectId: string;
  title: string;
  topic: string;
  findings: string;
  sourcesJson?: string;
  createdAt: number;
  updatedAt: number;
}

export type ProposalStatus = 'draft' | 'under_review' | 'approved' | 'rejected' | 'implemented';

export interface ProposalRecord {
  id: string;
  projectId: string;
  taskId?: string;
  title: string;
  description: string;
  status: ProposalStatus;
  diffPreview?: string;
  createdAt: number;
  updatedAt: number;
}

// --- Validation Runs ---
export type ValidationType = 'acceptance' | 'schema' | 'security' | 'test';
export type ValidationRunStatus = 'passed' | 'failed' | 'warning';

export interface ValidationRunRecord {
  id: string;
  projectId: string;
  taskId?: string;
  validatorType: ValidationType;
  status: ValidationRunStatus;
  resultsJson: string;
  runBy: string;
  createdAt: number;
}

// --- Agent Sessions ---
export type AgentSessionStatus = 'active' | 'idle' | 'closed' | 'disconnected';

export interface AgentSessionRecord {
  id: string;
  projectId: string;
  agentIdentity: string;
  agentType: string;
  sessionToken: string;
  startedAt: number;
  endedAt?: number;
  status: AgentSessionStatus;
}

// --- Context Pack ---
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
  recentHandoff?: HandoffRecord;
  tokenBudget: number;
  estimatedTokens: number;
}
