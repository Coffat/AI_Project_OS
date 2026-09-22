export type GuardSeverity = 'warning' | 'approval_required' | 'error';

export type ViolationCategory =
  | 'duplicate_functionality'
  | 'dependency_duplication'
  | 'unused_dependency'
  | 'unnecessary_abstraction'
  | 'unrelated_file_modifications'
  | 'architecture_boundary_violation'
  | 'circular_dependency';

export interface ArchitectureViolation {
  ruleId: string;
  category: ViolationCategory;
  severity: GuardSeverity;
  message: string;
  file?: string;
  symbol?: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

export interface ArchitectureGuardSummary {
  warnings: number;
  approvalRequired: number;
  errors: number;
  total: number;
}

export interface ArchitectureGuardReport {
  passed: boolean;
  blocked: boolean;
  summary: ArchitectureGuardSummary;
  violations: ArchitectureViolation[];
  checkedAt: number;
}

export interface ArchitectureBoundaryRule {
  id: string;
  name: string;
  sourcePattern: string | RegExp;
  forbiddenImportPatterns: (string | RegExp)[];
  severity: GuardSeverity;
  message: string;
}

export interface DiscoveredAbstraction {
  name: string;
  kind: string;
  filePath: string;
  signature?: string;
  description?: string;
}

export interface DiscoveredService {
  name: string;
  filePath: string;
  methods: string[];
}

export interface DiscoveredUtility {
  name: string;
  filePath: string;
  functions: string[];
}

export interface DiscoveredDependency {
  name: string;
  version: string;
  isDev: boolean;
  category?: string;
  description?: string;
}

export interface PreImplementationContext {
  existingAbstractions: DiscoveredAbstraction[];
  existingServices: DiscoveredService[];
  existingUtilities: DiscoveredUtility[];
  existingDependencies: DiscoveredDependency[];
  relatedFiles: string[];
}

export interface GuardEvaluationOptions {
  projectId?: string;
  taskId?: string;
  declaredScopeFiles?: string[];
  approvedViolations?: string[]; // ruleIds or hashes marked approved by user/supervisor
  strictMode?: boolean; // if true, approval_required also blocks
  boundaryRules?: ArchitectureBoundaryRule[];
}
