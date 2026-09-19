import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { CodeIndexer } from '../../src/code-intelligence/code-indexer.js';
import { CodeQueryService } from '../../src/code-intelligence/code-query-service.js';
import { CodeCLI } from '../../src/code-intelligence/code-cli.js';

describe('CodeQueryService (Deterministic Zero-LLM Query Engine)', () => {
  let dbClient: SQLiteDatabaseClient;
  let codeIndexer: CodeIndexer;
  let queryService: CodeQueryService;
  let codeCli: CodeCLI;
  const fixturePath = path.resolve(__dirname, '../fixtures/sample-project');
  const projectId = 'sample-project-id';

  beforeEach(async () => {
    dbClient = new SQLiteDatabaseClient(':memory:');
    codeIndexer = new CodeIndexer(dbClient.db);
    queryService = new CodeQueryService(dbClient.db);
    codeCli = new CodeCLI(dbClient.db);

    dbClient.db.prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, 'Sample Project', fixturePath, Date.now(), Date.now());

    // Populate index
    await codeIndexer.indexProject(fixturePath, projectId);
  });

  // Query 1: "Function X nằm ở đâu?"
  it('answers "Function X nằm ở đâu?" with exact file and line numbers', () => {
    const locations = queryService.findSymbolLocation('add', projectId);
    expect(locations.length).toBeGreaterThan(0);

    const addFunc = locations[0];
    expect(addFunc?.symbolName).toBe('add');
    expect(addFunc?.kind).toBe('function');
    expect(addFunc?.filePath).toBe('src/math.ts');
    expect(addFunc?.lineStart).toBeGreaterThanOrEqual(1);
    expect(addFunc?.lineEnd).toBeGreaterThanOrEqual(addFunc!.lineStart);
    expect(addFunc?.docstring).toContain('Adds two numbers together');
  });

  // Query 2: "File nào import module Y?"
  it('answers "File nào import module Y?" with all importing files', () => {
    // Check who imports math.ts
    const importers = queryService.findModuleImporters('src/math.ts', projectId);
    expect(importers.length).toBeGreaterThan(0);

    const importingPaths = importers.map((i) => i.importingFilePath);
    // user-service.ts imports math.ts
    expect(importingPaths).toContain('src/services/user-service.ts');
    // math.test.ts also imports math.ts
    expect(importingPaths).toContain('tests/math.test.ts');
  });

  // Query 3: "Những module nào phụ thuộc X?"
  it('answers "Những module nào phụ thuộc X?" (Dependents & Dependencies)', () => {
    // What depends on math.ts?
    const dependents = queryService.findDependents('src/math.ts', projectId);
    const dependentNames = dependents.map((d) => d.path || d.name);
    expect(dependentNames).toContain('src/services/user-service.ts');

    // What does user-service.ts depend on?
    const dependencies = queryService.findDependencies('src/services/user-service.ts', projectId);
    const depPaths = dependencies.map((d) => d.path || d.name);
    expect(depPaths).toContain('src/math.ts');
  });

  // Query 4: "Test nào liên quan đến function X?"
  it('answers "Test nào liên quan đến function X?" using call & test graph edges', () => {
    const relatedTests = queryService.findRelatedTests('add', projectId);
    expect(relatedTests.length).toBeGreaterThan(0);

    const testFiles = relatedTests.map((t) => t.testFilePath);
    expect(testFiles.some((f) => f.includes('math.test.ts'))).toBe(true);
  });

  it('inspects a symbol comprehensively (callers, callees, implements, tests)', () => {
    const inspection = queryService.inspectSymbol('UserService', projectId);
    expect(inspection).not.toBeNull();
    expect(inspection?.symbol.symbolName).toBe('UserService');
    expect(inspection?.symbol.kind).toBe('class');
    expect(inspection?.symbol.filePath).toBe('src/services/user-service.ts');
    expect(inspection?.implementsInterfaces).toContain('IUserService');
  });

  it('inspects a file comprehensively (contained symbols, exports, imports, dependents)', () => {
    const fileInfo = queryService.inspectFile('src/math.ts', projectId);
    expect(fileInfo).not.toBeNull();
    expect(fileInfo?.filePath).toBe('src/math.ts');
    expect(fileInfo?.exports).toContain('add');
    expect(fileInfo?.exports).toContain('multiply');
    expect(fileInfo?.dependents).toContain('src/services/user-service.ts');
  });

  it('finds references to a symbol across the project', () => {
    const refs = queryService.findReferences('add', projectId);
    expect(refs.length).toBeGreaterThan(0);
    // Referenced in user-service.ts
    expect(refs.some((r) => r.referencingPath === 'src/services/user-service.ts')).toBe(true);
  });

  it('executes CLI commands cleanly', async () => {
    const inspectOutput = await codeCli.run(['inspect', 'symbol', 'add', `--project-id=${projectId}`]);
    expect(inspectOutput).toContain('SYMBOL INSPECTION: add');
    expect(inspectOutput).toContain('src/math.ts');

    const fileOutput = await codeCli.run(['inspect', 'file', 'src/math.ts', `--project-id=${projectId}`]);
    expect(fileOutput).toContain('FILE INSPECTION: src/math.ts');

    const refsOutput = await codeCli.run(['find', 'references', 'add', `--project-id=${projectId}`]);
    expect(refsOutput).toContain('References to "add"');

    const helpOutput = await codeCli.run([]);
    expect(helpOutput).toContain('Code Intelligence Engine CLI Commands');
  });
});
