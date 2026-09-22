import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ArchitectureGuard, DEFAULT_BOUNDARY_RULES } from '../../src/guard/architecture-guard.js';

describe('Phase 16: Architecture Guard & Anti-Bloat', () => {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/bloated-project');
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    // Initialize required minimal tables for graph/decision
    db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        name TEXT,
        label TEXT NOT NULL,
        path TEXT,
        line_start INTEGER,
        line_end INTEGER,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_node_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('detects circular dependencies across source files', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const sourceFiles = [
      'src/circular/circle-a.ts',
      'src/circular/circle-b.ts',
      'src/services/user-service.ts',
    ];

    const violations = guard.checkCircularDependency(fixtureRoot, sourceFiles);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const circular = violations.find((v) => v.category === 'circular_dependency');
    expect(circular).toBeDefined();
    expect(circular?.severity).toBe('error');
    expect(circular?.message).toContain('Circular dependency detected');
    expect(circular?.message).toContain('circle-a.ts');
    expect(circular?.message).toContain('circle-b.ts');
  });

  it('detects architecture boundary violations', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const sourceFiles = [
      'src/models/user.ts',
      'src/api/user-router.ts',
    ];

    const violations = guard.checkArchitectureBoundaryViolations(
      sourceFiles,
      DEFAULT_BOUNDARY_RULES
    );

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const boundary = violations.find((v) => v.category === 'architecture_boundary_violation');
    expect(boundary).toBeDefined();
    expect(boundary?.severity).toBe('error');
    expect(boundary?.file).toBe('src/models/user.ts');
    expect(boundary?.message).toContain('Models must not depend on API/Controllers');
  });

  it('detects competing duplicate dependencies and unused dependencies in package.json', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const sourceFiles = [
      'src/services/user-service.ts', // imports lodash
      'src/services/user-manager.ts', // imports underscore
    ];

    const violations = guard.checkDependencies(fixtureRoot, sourceFiles);

    // 1. Competing duplicate packages: lodash and underscore
    const duplicateDep = violations.find((v) => v.category === 'dependency_duplication');
    expect(duplicateDep).toBeDefined();
    expect(duplicateDep?.severity).toBe('approval_required');
    expect(duplicateDep?.message).toContain('Multiple competing packages in category \'utility\'');
    expect(duplicateDep?.message).toContain('lodash');
    expect(duplicateDep?.message).toContain('underscore');

    // 2. Unused dependency: moment
    const unusedDep = violations.find((v) => v.category === 'unused_dependency');
    expect(unusedDep).toBeDefined();
    expect(unusedDep?.severity).toBe('warning');
    expect(unusedDep?.message).toContain('moment');
  });

  it('detects duplicate service functionality between classes', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const modifiedFiles = ['src/services/user-manager.ts'];
    const allSourceFiles = [
      'src/services/user-service.ts',
      'src/services/user-manager.ts',
    ];

    const violations = guard.checkCodeAbstractionsAndDuplication(
      modifiedFiles,
      allSourceFiles
    );

    const dup = violations.find((v) => v.category === 'duplicate_functionality');
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe('error');
    expect(dup?.symbol).toBe('UserManager');
    expect(dup?.message).toContain('duplicate existing class \'UserService\'');
  });

  it('detects unnecessary trivial passthrough abstractions', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const modifiedFiles = ['src/proxies/user-proxy.ts'];
    const allSourceFiles = [
      'src/services/user-service.ts',
      'src/proxies/user-proxy.ts',
    ];

    const violations = guard.checkCodeAbstractionsAndDuplication(
      modifiedFiles,
      allSourceFiles
    );

    const trivial = violations.find((v) => v.category === 'unnecessary_abstraction');
    expect(trivial).toBeDefined();
    expect(trivial?.severity).toBe('approval_required');
    expect(trivial?.symbol).toBe('UserProxy');
    expect(trivial?.message).toContain('trivial pass-through abstraction');
  });

  it('flags unexpected file modifications outside declared task scope', () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const modifiedFiles = [
      'src/services/user-service.ts',
      'src/unrelated/secret.ts',
    ];
    const declaredScope = ['src/services/user-service.ts'];

    const violations = guard.checkUnrelatedFileModifications(
      modifiedFiles,
      declaredScope
    );

    expect(violations.length).toBe(1);
    expect(violations[0]!.category).toBe('unrelated_file_modifications');
    expect(violations[0]!.severity).toBe('approval_required');
    expect(violations[0]!.file).toBe('src/unrelated/secret.ts');
  });

  it('discovers pre-implementation context (abstractions, services, utilities, dependencies)', async () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const preContext = await guard.getPreImplementationContext(['user']);

    expect(preContext.existingServices.length).toBeGreaterThan(0);
    expect(preContext.existingServices.some((s) => s.name === 'UserService')).toBe(true);

    expect(preContext.existingAbstractions.length).toBeGreaterThan(0);
    expect(preContext.existingAbstractions.some((a) => a.name === 'User')).toBe(true);

    expect(preContext.existingDependencies.length).toBeGreaterThan(0);
    expect(preContext.existingDependencies.some((d) => d.name === 'lodash')).toBe(true);
    expect(preContext.existingDependencies.some((d) => d.name === 'underscore')).toBe(true);
  });

  it('generates a full evaluation report with correct severity aggregation and blocked status', async () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);

    // Mock git changes by checking all files
    const report = await guard.evaluate({
      declaredScopeFiles: ['src/services/user-service.ts'],
      strictMode: false,
    });

    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.summary.approvalRequired).toBeGreaterThan(0);
    expect(report.summary.warnings).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
    expect(report.blocked).toBe(true); // blocked due to errors
  });

  it('respects approved violations without blocking', async () => {
    const guard = new ArchitectureGuard(fixtureRoot, db);
    const initialReport = await guard.evaluate();

    const errorRuleIds = initialReport.violations.map((v) => v.ruleId);
    const approvedReport = await guard.evaluate({
      approvedViolations: errorRuleIds,
    });

    expect(approvedReport.violations.length).toBe(0);
    expect(approvedReport.summary.total).toBe(0);
    expect(approvedReport.passed).toBe(true);
    expect(approvedReport.blocked).toBe(false);
  });
});
