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

export type Project = ProjectInfo;

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

// --- Incremental Memory Layers & Events (Phase 5) ---
export type MemoryLayer =
  | 'project'
  | 'architecture'
  | 'decision'
  | 'constraint'
  | 'task'
  | 'research'
  | 'handoff';

export type MemoryEventType =
  | 'FILE_MODIFIED'
  | 'FILE_ADDED'
  | 'FILE_DELETED'
  | 'FILE_RENAMED'
  | 'SYMBOL_ADDED'
  | 'SYMBOL_REMOVED'
  | 'SYMBOL_MODIFIED'
  | 'DEPENDENCY_CHANGED'
  | 'DECISION_CREATED'
  | 'DECISION_UPDATED'
  | 'CONSTRAINT_CHANGED'
  | 'TASK_COMPLETED'
  | 'LESSON_RECORDED'
  | 'HANDOFF_SUBMITTED';

export interface MemoryEvent {
  eventId: string;
  type: MemoryEventType;
  timestamp: number;
  source: string;
  entity: string;
  before: unknown;
  after: unknown;
  metadata?: Record<string, unknown>;
}

export interface SemanticExtractionRequest {
  id: string;
  projectId: string;
  reason: string;
  diffSummary: string;
  suggestedTargetLayer: MemoryLayer;
  entityIdentifier?: string;
  status: 'pending' | 'completed' | 'skipped';
  createdAt: number;
}

export interface MemoryDiffResult {
  events: MemoryEvent[];
  affectedFiles: string[];
  affectedSymbols: string[];
  affectedLayers: MemoryLayer[];
  semanticExtractionRequired: boolean;
  semanticReasons: string[];
}

export interface MemoryValidationReport {
  isValid: boolean;
  totalDocuments: number;
  totalChunks: number;
  canonicalFilesChecked: Array<{ path: string; exists: boolean; validMarkdown: boolean }>;
  duplicateKeys: string[];
  desynchronizedFiles: string[];
  details: string[];
}

export interface MemoryCompilationResult {
  projectId: string;
  durationMs: number;
  changedFiles: GitChangedFiles;
  eventsGenerated: number;
  layersUpdated: MemoryLayer[];
  canonicalFilesUpdated: string[];
  semanticRequestsCreated: number;
  validation: MemoryValidationReport;
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
export type ValidationType =
  | 'acceptance'
  | 'schema'
  | 'security'
  | 'test'
  | 'lint'
  | 'typecheck'
  | 'build'
  | 'git_diff'
  | 'memory_update'
  | 'architecture_guard'
  | 'pipeline';

export type ValidationRunStatus = 'passed' | 'failed' | 'stale' | 'skipped' | 'warning';

export interface ValidationRunRecord {
  id: string;
  projectId: string;
  taskId?: string;
  validatorType: ValidationType;
  status: ValidationRunStatus;
  command?: string;
  exitCode?: number;
  startedAt?: number;
  finishedAt?: number;
  affectedFiles?: string[];
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

// --- Context Pack & Phase 6 Context Engine ---

export interface RelevantFileItem {
  path: string;
  relevanceScore: number;
  reason: string;
  snippet?: string;
  isModified?: boolean;
  isDependency?: boolean;
  sizeBytes?: number;
}

export interface RelevantSymbolItem {
  name: string;
  kind: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
  docstring?: string;
  snippet?: string;
  relevanceScore?: number;
}

export interface RelevantDecisionItem {
  id: string;
  title: string;
  status: string;
  summary?: string;
  rationale?: string;
  filePath?: string;
  relevanceScore?: number;
}

export interface RelevantConstraintItem {
  id: string;
  title: string;
  rule: string;
  category?: string;
  severity?: string;
  relevanceScore?: number;
}

export interface RelevantTestItem {
  filePath: string;
  targetFile?: string;
  testNames?: string[];
  relevanceScore?: number;
}

export interface RelevantArchitectureItem {
  subsystem?: string;
  summary: string;
  rules?: string[];
  relevanceScore?: number;
}

export interface ContextEntityReference {
  id: string;
  type: 'task' | 'file' | 'symbol' | 'decision' | 'constraint' | 'test' | 'architecture' | 'handoff' | 'general';
  tokens: number;
  score: number;
  reason?: string;
}

export type ContextLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export interface ExcludedContextItem {
  id: string;
  type: string;
  level?: ContextLevel;
  reason: string;
  tokens?: number;
  coveredBy?: string;
}

export interface ContextExclusionReference extends ContextEntityReference {
  dropReason: string;
}

export interface ContextReasoningMetadata {
  tokenBudget: number;
  totalCandidates: number;
  includedCount: number;
  excludedCount: number;
  budgetUtilizationPercent: number;
  rankingStrategy: string;
  scoreBreakdown?: Record<string, number>;
  compressionApplied?: boolean;
  // Phase 17 Token Optimization Engine Fields
  totalProjectEstimatedTokens?: number;
  selectedContextTokens?: number;
  compressionRatio?: number;
  compressionPercentage?: string;
  compressionFactor?: string;
  loadedLevels?: ContextLevel[];
  deduplicationSavingsTokens?: number;
}

export interface ContextPack {
  // Primary Phase 6 Structure
  task?: Task;
  objective?: string;
  current_state?: {
    status: string;
    phase?: string;
    currentStep?: string;
    blockers?: string[];
  };
  relevant_files?: RelevantFileItem[];
  relevant_symbols?: RelevantSymbolItem[];
  relevant_decisions?: RelevantDecisionItem[];
  relevant_constraints?: RelevantConstraintItem[];
  relevant_tests?: RelevantTestItem[];
  relevant_handoff?: HandoffRecord | null;
  relevant_architecture?: RelevantArchitectureItem[];
  next_action?: string;

  // Phase 16: Anti-Bloat Pre-Implementation Guidance
  existing_abstractions?: Array<{ name: string; kind: string; filePath: string; signature?: string; description?: string }>;
  existing_services?: Array<{ name: string; filePath: string; methods: string[] }>;
  existing_utilities?: Array<{ name: string; filePath: string; functions: string[] }>;
  existing_dependencies?: Array<{ name: string; version: string; isDev: boolean; category?: string; description?: string }>;

  // Phase 17: Token Optimization Level & Metrics
  loadedLevels?: ContextLevel[];

  // Backward compatibility fields
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

export interface GetContextResult {
  context: string;
  token_estimate: number;
  included_entities: ContextEntityReference[];
  excluded_entities: ContextExclusionReference[];
  reasoning_metadata: ContextReasoningMetadata;
  pack: ContextPack;
  // Phase 17 Token Optimization Engine Reports
  total_project_tokens?: number;
  selected_context_tokens?: number;
  compression_ratio?: number;
  loaded_levels?: ContextLevel[];
  excluded_context?: ExcludedContextItem[];
}

export interface ContextOptions {
  projectId?: string;
  budget?: number;
  includeGeneralInfo?: boolean;
  maxGraphDepth?: number;
  allowCompression?: boolean;
  maxLevel?: ContextLevel;
  enableDeduplication?: boolean;
  enableSemanticFallback?: boolean;
}

// --- Phase 7: Handoff Engine ---

export interface HandoffValidationState {
  status: 'passed' | 'failed' | 'pending' | 'stale';
  timestamp?: number;
  lastTestedCommit?: string;
  testSuite?: string;
  details?: string;
}

export interface HandoffGitState {
  branch?: string;
  commitHash?: string;
  isDirty?: boolean;
  diffSummary?: string;
  modifiedFiles?: string[];
  stagedFiles?: string[];
  untrackedFiles?: string[];
}

export interface HandoffSnapshotData {
  task_id: string;
  status: string;
  goal: string;
  current_step: string;
  completed: string[];
  remaining: string[];
  modified_files: string[];
  modified_symbols?: string[];
  decisions: string[];
  blockers: string[];
  errors?: string[];
  tests: string[];
  validation?: HandoffValidationState;
  git: HandoffGitState;
  next_action: string;
  created_at: number;
  agent_identity: string;
}

export type HandoffConsistencyWarningCode =
  | 'FILE_NOT_MODIFIED_IN_GIT'
  | 'TESTS_STALE_CODE_CHANGED'
  | 'GIT_STATE_MISMATCH'
  | 'STEP_MISMATCH'
  | 'GENERAL_WARNING';

export interface HandoffConsistencyWarning {
  code: HandoffConsistencyWarningCode;
  message: string;
  severity: 'warning' | 'error' | 'info';
  file?: string;
}

export interface HandoffConsistencyReport {
  isConsistent: boolean;
  validationStale: boolean;
  gitMismatch: boolean;
  warnings: HandoffConsistencyWarning[];
  checkedAt: number;
}

export interface TaskResumePack {
  task: Task;
  objective: string;
  current_state: string;
  current_step: string;
  completed_steps: string[];
  remaining_steps: string[];
  modified_files: string[];
  blockers: string[];
  relevant_decisions: RelevantDecisionItem[];
  relevant_context: GetContextResult;
  next_action: string;
  consistency: HandoffConsistencyReport;
  snapshot: HandoffSnapshotData;
}

export interface CreateHandoffOptions {
  taskId: string;
  projectId?: string;
  agentIdentity: string;
  completedWork?: string;
  nextAction?: string;
  currentStep?: string;
  currentFile?: string;
  blockers?: string[];
  errors?: string[];
  tests?: string[];
  validation?: HandoffValidationState;
}

export interface ResumeTaskOptions {
  projectId?: string;
  agentIdentity?: string;
  contextBudget?: number;
  skipConsistencyCheck?: boolean;
}

// --- Phase 8: Validation Engine ---

export type ValidationStepType =
  | 'tests'
  | 'lint'
  | 'typecheck'
  | 'build'
  | 'git_diff'
  | 'memory_update'
  | 'architecture_guard';

export interface CommandRunResult {
  command: string;
  started_at: number;
  finished_at: number;
  exit_code: number;
  stdout: string;
  stderr: string;
}

export interface ValidationStepResult {
  step: ValidationStepType;
  command: string;
  started_at: number;
  finished_at: number;
  exit_code: number;
  status: ValidationRunStatus;
  stdout: string;
  stderr: string;
  affected_files: string[];
  error?: string;
}

export interface TaskValidationBlocker {
  command: string;
  error: string;
  affected_files: string[];
  last_attempt: number;
  next_hypothesis: string;
}

export interface TaskValidationResult {
  task_id: string;
  success: boolean;
  status: 'passed' | 'failed' | 'stale';
  runs: ValidationStepResult[];
  blocker?: TaskValidationBlocker;
  stale_detected?: boolean;
  stale_reason?: string;
  completed_at: number;
}

export interface ValidationRunOptions {
  taskId?: string;
  projectId?: string;
  command?: string;
  affectedFiles?: string[];
  agentIdentity?: string;
}

export interface ValidateTaskOptions {
  projectId?: string;
  agentIdentity?: string;
  skipBuild?: boolean;
  skipLint?: boolean;
  skipTypecheck?: boolean;
  skipArchitectureGuard?: boolean;
  strictGuard?: boolean;
  testCommand?: string;
  lintCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  autoCompleteOnPass?: boolean;
  updateMemoryOnPass?: boolean;
}

// --- Phase 9: Obsidian Integration ---

export type ObsidianEntityType =
  | 'project'
  | 'architecture'
  | 'constraint'
  | 'decision'
  | 'task'
  | 'research'
  | 'index';

export type ObsidianSyncSource = 'sqlite_to_markdown' | 'markdown_to_sqlite';

export interface ObsidianSyncRecord {
  id: string;
  projectId: string;
  entityType: ObsidianEntityType;
  entityId: string;
  filePath: string;
  lastSyncedHash: string;
  lastSyncedMtime: number;
  lastSyncedAt: number;
  syncSource: ObsidianSyncSource;
  createdAt: number;
  updatedAt: number;
}

export interface ObsidianFrontmatter {
  id?: string;
  title?: string;
  type?: ObsidianEntityType;
  status?: string;
  priority?: string;
  assigned_agent?: string;
  tags?: string[];
  created_at?: string | number;
  updated_at?: string | number;
  [key: string]: unknown;
}

export interface ObsidianConflictRecord {
  filePath: string;
  entityType: ObsidianEntityType;
  entityId: string;
  sqliteHash: string;
  markdownHash: string;
  ledgerHash: string;
  conflictFilePath: string;
  detectedAt: number;
  message: string;
}

export interface ObsidianSyncOptions {
  projectId?: string;
  dryRun?: boolean;
  force?: boolean;
  direction?: 'bidirectional' | 'export_only' | 'import_only';
}

export interface ObsidianSyncResult {
  projectId: string;
  syncedFilesCount: number;
  exportedFiles: string[];
  importedFiles: string[];
  unchangedFiles: string[];
  conflicts: ObsidianConflictRecord[];
  warnings: string[];
  timestamp: number;
}

// --- PHASE 10: NOTEBOOKLM KNOWLEDGE BRIDGE TYPES ---

export type NotebookSourceCategory =
  | 'canonical_project'
  | 'architecture'
  | 'decision'
  | 'constraint'
  | 'research'
  | 'specification';

export interface NotebookSourceEntry {
  id: string;
  title: string;
  relativePath: string;
  category: NotebookSourceCategory;
  sha256: string;
  wordCount: number;
  tokenEstimate: number;
  abstract?: string;
}

export interface NotebookManifest {
  projectId: string;
  generatedAt: number;
  version: string;
  totalSources: number;
  totalWords: number;
  totalTokens: number;
  sources: NotebookSourceEntry[];
  excludedPatterns: string[];
  firewallVerified: boolean;
}

export interface NotebookExportOptions {
  projectId?: string;
  outDir?: string;
  selectedDecisions?: string[];
  includeResearch?: boolean;
  includeSpecs?: boolean;
}

export interface NotebookExportResult {
  projectId: string;
  outDir: string;
  exportedFiles: string[];
  manifest: NotebookManifest;
  warnings: string[];
  timestamp: number;
}

export type ProposalConfidence = 'low' | 'medium' | 'high' | 'experimental';

export interface ResearchProposal {
  id: string;
  projectId: string;
  taskId?: string;
  title: string;
  question: string;
  sources: string[];
  findings: string;
  proposedChanges: string;
  confidence: ProposalConfidence;
  openQuestions?: string[];
  status: ProposalStatus;
  reviewedBy?: string;
  reviewComment?: string;
  promotedDecisionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ParsedProposalMarkdown {
  id: string;
  title: string;
  question: string;
  sources: string[];
  findings: string;
  proposedChanges: string;
  confidence: ProposalConfidence;
  openQuestions: string[];
}

// --- Phase 13: Execution Sessions ---
export type ExecutionSessionStatus = 'active' | 'paused' | 'ended' | 'handoff';

export interface ExecutionSessionRecord {
  id: string; // session_id
  projectId: string;
  taskId?: string;
  provider: string;
  agent: string;
  accountLabel?: string;
  startedAt: number;
  endedAt?: number;
  status: ExecutionSessionStatus;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

// --- Phase 16: Architecture Guard & Anti-Bloat ---
export type {
  GuardSeverity,
  ViolationCategory,
  ArchitectureViolation,
  ArchitectureGuardSummary,
  ArchitectureGuardReport,
  ArchitectureBoundaryRule,
  DiscoveredAbstraction,
  DiscoveredService,
  DiscoveredUtility,
  DiscoveredDependency,
  PreImplementationContext,
  GuardEvaluationOptions,
} from '../guard/types.js';
