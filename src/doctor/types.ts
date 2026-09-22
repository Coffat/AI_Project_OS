import { MemoryValidationReport, GraphIntegrityReport } from '../core/types.js';

export type DiagnosticSeverity = 'healthy' | 'warning' | 'corrupted';

export interface DiagnosticCheckItem {
  name: string;
  category: 'database' | 'filesystem' | 'memory' | 'graph' | 'session' | 'index' | 'validation';
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: unknown;
  remedy?: string;
}

export interface DoctorDiagnosisReport {
  timestamp: number;
  projectRoot: string;
  projectId?: string;
  overallStatus: DiagnosticSeverity;
  checks: DiagnosticCheckItem[];
  summary: {
    passed: number;
    warnings: number;
    errors: number;
  };
  recommendations: string[];
}

export interface DoctorRepairReport {
  timestamp: number;
  projectRoot: string;
  projectId?: string;
  repairedItems: string[];
  warnings: string[];
  success: boolean;
}

export interface RebuildGraphResult {
  projectId: string;
  nodesCreated: number;
  edgesCreated: number;
  durationMs: number;
}

export interface DoctorValidationResult {
  timestamp: number;
  valid: boolean;
  databaseValid: boolean;
  memoryReport: MemoryValidationReport;
  graphReport: GraphIntegrityReport;
  issues: string[];
}

export interface BackupManifest {
  version: string;
  timestamp: number;
  createdAt: string;
  projectId?: string;
  projectName?: string;
  databaseIncluded: boolean;
  files: Array<{
    relativePath: string;
    sizeBytes: number;
    sha256: string;
  }>;
}

export interface BackupResult {
  backupDir: string;
  manifest: BackupManifest;
  durationMs: number;
  success: boolean;
}

export interface RestoreResult {
  restoredFrom: string;
  preRestoreBackupDir?: string;
  timestamp: number;
  filesRestored: number;
  databaseIntegrity: 'ok' | 'failed';
  success: boolean;
}
