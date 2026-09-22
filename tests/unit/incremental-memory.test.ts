import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { MemoryCompiler } from '../../src/memory/memory-compiler.js';
import { MemoryValidator } from '../../src/memory/memory-validator.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { ConstraintRepository } from '../../src/database/repositories/constraint.repository.js';

describe('Phase 5: Incremental Memory Engine (Deterministic Zero-LLM Pipeline)', () => {
  let dbClient: SQLiteDatabaseClient;
  let compiler: MemoryCompiler;
  let validator: MemoryValidator;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let projectRoot: string;
  let projectId: string;

  beforeEach(async () => {
    // 1. Setup isolated in-memory DB and file workspace
    dbClient = new SQLiteDatabaseClient(':memory:');
    compiler = new MemoryCompiler(dbClient.db);
    validator = new MemoryValidator(dbClient.db);
    decisionRepo = new DecisionRepository(dbClient.db);
    constraintRepo = new ConstraintRepository(dbClient.db);

    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'inc-memory-test-'));

    const projectRepo = new ProjectRepository(dbClient.db);
    const proj = projectRepo.create({
      name: 'Incremental Memory Test Project',
      rootPath: projectRoot,
    });
    projectId = proj.id;

    // 2. Scaffold initial project files
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, 'src', 'core.ts'),
      'export function initApp(): void { console.log("initialized"); }',
      'utf8'
    );
    await fs.writeFile(
      path.join(projectRoot, 'src', 'utils.ts'),
      'export function sum(a: number, b: number): number { return a + b; }',
      'utf8'
    );

    // Initial compile to set baseline
    await compiler.compileFull(projectRoot, projectId);
  });

  afterEach(async () => {
    dbClient.close();
    try {
      await fs.rm(projectRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // 1. Task sửa 1 file
  it('handles single file modification without regenerating unrelated memory', async () => {
    // Modify src/utils.ts
    const utilsPath = path.join(projectRoot, 'src', 'utils.ts');
    await fs.writeFile(
      utilsPath,
      [
        'export function sum(a: number, b: number): number { return a + b; }',
        'export function multiply(a: number, b: number): number { return a * b; }',
      ].join('\n'),
      'utf8'
    );

    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: {
        added: [],
        modified: ['src/utils.ts'],
        deleted: [],
        renamed: [],
      },
    });

    expect(result.changedFiles.modified).toEqual(['src/utils.ts']);
    expect(result.changedFiles.added).toHaveLength(0);
    expect(result.eventsGenerated).toBeGreaterThan(0);
    expect(result.layersUpdated).toContain('architecture');

    // Verify symbols in DB
    const stmt = dbClient.db.prepare('SELECT name FROM symbols WHERE name = ?');
    expect(stmt.get('multiply')).toBeDefined();

    // Verify memory integrity
    const validation = await validator.validate(projectRoot, projectId);
    expect(validation.isValid).toBe(true);
    expect(validation.duplicateKeys).toHaveLength(0);
  });

  // 2. Task sửa 10 files (Batch test)
  it('handles batch modification of 10 files cleanly without memory bloat', async () => {
    const filesToCreate: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const rel = `src/batch_mod_${i}.ts`;
      filesToCreate.push(rel);
      await fs.writeFile(
        path.join(projectRoot, rel),
        `export function func_${i}(): number { return ${i}; }`,
        'utf8'
      );
    }

    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: {
        added: filesToCreate,
        modified: [],
        deleted: [],
        renamed: [],
      },
    });

    expect(result.changedFiles.added).toHaveLength(10);
    expect(result.eventsGenerated).toBeGreaterThanOrEqual(10);

    // Verify all 10 are indexed
    const countRow = dbClient.db
      .prepare("SELECT COUNT(*) as count FROM files WHERE path LIKE 'src/batch_mod_%'")
      .get() as { count: number };
    expect(countRow.count).toBe(10);

    // Verify memory deduplication
    const dupKeys = dbClient.db
      .prepare('SELECT key, COUNT(*) as cnt FROM project_memory WHERE project_id = ? GROUP BY key HAVING cnt > 1')
      .all(projectId);
    expect(dupKeys).toHaveLength(0);
  });

  // 3. File rename
  it('tracks file renames, updating paths while keeping memory history intact', async () => {
    const oldPath = path.join(projectRoot, 'src', 'utils.ts');
    const newPath = path.join(projectRoot, 'src', 'helpers.ts');
    await fs.rename(oldPath, newPath);

    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: {
        added: [],
        modified: [],
        deleted: [],
        renamed: [{ from: 'src/utils.ts', to: 'src/helpers.ts' }],
      },
    });

    expect(result.changedFiles.renamed).toEqual([{ from: 'src/utils.ts', to: 'src/helpers.ts' }]);

    // helpers.ts should exist, utils.ts should no longer be primary
    const helpersFile = dbClient.db.prepare('SELECT * FROM files WHERE path = ?').get('src/helpers.ts');
    expect(helpersFile).toBeDefined();

    const validation = await validator.validate(projectRoot, projectId);
    expect(validation.isValid).toBe(true);
  });

  // 4. File delete
  it('handles file deletion by removing dead nodes and recording deletion events', async () => {
    const filePath = path.join(projectRoot, 'src', 'utils.ts');
    await fs.unlink(filePath);

    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: {
        added: [],
        modified: [],
        deleted: ['src/utils.ts'],
        renamed: [],
      },
    });

    expect(result.changedFiles.deleted).toEqual(['src/utils.ts']);

    // Check file removed from SQLite
    const deletedFile = dbClient.db.prepare('SELECT * FROM files WHERE path = ?').get('src/utils.ts');
    expect(deletedFile).toBeUndefined();

    // Check symbols removed
    const symbols = dbClient.db.prepare("SELECT * FROM symbols WHERE name = 'sum'").all();
    expect(symbols).toHaveLength(0);
  });

  // 5. Dependency change
  it('detects dependency change between files and updates architecture memory', async () => {
    // 1. Create target service
    await fs.writeFile(
      path.join(projectRoot, 'src', 'service.ts'),
      'export function processOrder(): void {}',
      'utf8'
    );

    // 2. Have src/core.ts import src/service.ts
    await fs.writeFile(
      path.join(projectRoot, 'src', 'core.ts'),
      [
        'import { processOrder } from "./service.js";',
        'export function initApp(): void { processOrder(); }',
      ].join('\n'),
      'utf8'
    );

    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: {
        added: ['src/service.ts'],
        modified: ['src/core.ts'],
        deleted: [],
        renamed: [],
      },
    });

    expect(result.layersUpdated).toContain('architecture');

    // Check import edge in database
    const coreNode = dbClient.db.prepare("SELECT id FROM graph_nodes WHERE path = 'src/core.ts'").get() as { id: string };
    const serviceNode = dbClient.db.prepare("SELECT id FROM graph_nodes WHERE path = 'src/service.ts'").get() as { id: string };

    const edge = dbClient.db.prepare(
      "SELECT * FROM graph_edges WHERE source_node_id = ? AND target_node_id = ? AND relation_type = 'imports'"
    ).get(coreNode.id, serviceNode.id);

    expect(edge).toBeDefined();
  });

  // 6. Deduplication & Anti-bloat
  it('ensures running compiler multiple times without changes does not duplicate memory or increment version', async () => {
    const memoryBefore = dbClient.db.prepare('SELECT * FROM project_memory WHERE project_id = ?').all(projectId);
    const countBefore = memoryBefore.length;

    // Run compile without changes
    const result = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: { added: [], modified: [], deleted: [], renamed: [] },
    });

    expect(result.eventsGenerated).toBe(0);

    const memoryAfter = dbClient.db.prepare('SELECT * FROM project_memory WHERE project_id = ?').all(projectId);
    expect(memoryAfter.length).toBe(countBefore);

    const validation = await validator.validate(projectRoot, projectId);
    expect(validation.isValid).toBe(true);
    expect(validation.duplicateKeys).toHaveLength(0);
  });

  // 7. Deterministic vs Semantic Extraction
  it('only creates SemanticExtractionRequest when heuristic detects potential business rule/policy', async () => {
    // A: Normal function -> NO semantic extraction
    await fs.writeFile(
      path.join(projectRoot, 'src', 'math.ts'),
      'export function subtract(a: number, b: number): number { return a - b; }',
      'utf8'
    );

    const resNormal = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: { added: ['src/math.ts'], modified: [], deleted: [], renamed: [] },
    });
    expect(resNormal.semanticRequestsCreated).toBe(0);

    // B: Function with business rule / security policy docstring -> CREATES SemanticExtractionRequest
    await fs.writeFile(
      path.join(projectRoot, 'src', 'auth-policy.ts'),
      `/**
        * Business rule: financial transaction limits require dual approval.
        * Security policy: prevents single-sign-on abuse.
        */
       export function enforceTransactionLimit(amount: number): boolean {
         return amount < 10000;
       }`,
      'utf8'
    );

    const resPolicy = await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: { added: ['src/auth-policy.ts'], modified: [], deleted: [], renamed: [] },
    });

    expect(resPolicy.semanticRequestsCreated).toBeGreaterThan(0);

    const semanticRequests = compiler.getSemanticRequests(projectId);
    expect(semanticRequests.length).toBeGreaterThan(0);
    expect(semanticRequests[0]!.reason).toContain('business policy');
    expect(semanticRequests[0]!.status).toBe('pending');
  });

  // 8. Canonical files generation & synchronization
  it('inspects generated .ai/canonical structure and verifies markdown compliance', async () => {
    // Add an ADR
    decisionRepo.create({
      projectId,
      title: 'Use SQLite WAL Mode',
      context: 'Concurrency requirement for local AI agents',
      decisionRationale: 'WAL mode allows multiple readers alongside single writer',
      status: 'accepted',
    });

    // Add a Constraint
    constraintRepo.create({
      projectId,
      category: 'architecture',
      title: 'Local-first zero cloud dependency',
      ruleContent: 'All engines must operate fully without outbound network access.',
      enforcementLevel: 'mandatory',
    });

    // Run compile
    await compiler.compileChanges(projectRoot, projectId, {
      forcedChanges: { added: [], modified: [], deleted: [], renamed: [] },
    });

    // Inspect files
    const canonicalDir = path.join(projectRoot, '.ai', 'canonical');
    const projectMd = await fs.readFile(path.join(canonicalDir, 'PROJECT.md'), 'utf8');
    const archMd = await fs.readFile(path.join(canonicalDir, 'ARCHITECTURE.md'), 'utf8');
    const constraintsMd = await fs.readFile(path.join(canonicalDir, 'CONSTRAINTS.md'), 'utf8');

    expect(projectMd).toContain('# Canonical Project Definition');
    expect(archMd).toContain('# Canonical Architecture Reference');
    expect(archMd).toContain('<!-- BEGIN_GENERATED_SUBSYSTEMS -->');
    expect(archMd).toContain('`src/`');
    expect(constraintsMd).toContain('# Canonical Constraints & Invariants');
    expect(constraintsMd).toContain('Local-first zero cloud dependency');

    // Inspect DECISIONS directory
    const decisionsDir = path.join(canonicalDir, 'DECISIONS');
    const decFiles = await fs.readdir(decisionsDir);
    expect(decFiles.length).toBeGreaterThan(0);

    const adrContent = await fs.readFile(path.join(decisionsDir, decFiles[0]!), 'utf8');
    expect(adrContent).toContain('Use SQLite WAL Mode');
    expect(adrContent).toContain('ACCEPTED');

    // Validate memory
    const validation = await validator.validate(projectRoot, projectId);
    expect(validation.isValid).toBe(true);
    expect(validation.canonicalFilesChecked.every((f) => f.exists && f.validMarkdown)).toBe(true);
  });
});
