import { describe, it, expect, beforeEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { DependencyAnalyzer } from '../../src/code-intelligence/dependency-analyzer.js';
import { GraphRepository } from '../../src/database/repositories/graph.repository.js';
import { ASTAnalyzer } from '../../src/code-intelligence/ast-analyzer.js';

describe('DependencyAnalyzer', () => {
  let dbClient: SQLiteDatabaseClient;
  let dependencyAnalyzer: DependencyAnalyzer;
  let graphRepo: GraphRepository;
  const astAnalyzer = new ASTAnalyzer();
  const projectId = 'test-dep-proj';

  beforeEach(() => {
    dbClient = new SQLiteDatabaseClient(':memory:');
    dependencyAnalyzer = new DependencyAnalyzer(dbClient.db);
    graphRepo = new GraphRepository(dbClient.db);

    dbClient.db.prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, 'Dep Test Project', '/tmp/dep-test', Date.now(), Date.now());
  });

  it('resolves relative import specifiers to project files', () => {
    const knownFiles = ['src/math.ts', 'src/services/user.ts', 'src/index.ts'];

    const res1 = dependencyAnalyzer.resolveModuleSpecifier({
      importingFilePath: 'src/services/user.ts',
      sourceModule: '../math.js',
      knownFiles,
    });
    expect(res1.isExternal).toBe(false);
    expect(res1.resolvedPath).toBe('src/math.ts');

    const res2 = dependencyAnalyzer.resolveModuleSpecifier({
      importingFilePath: 'src/services/user.ts',
      sourceModule: 'vitest',
      knownFiles,
    });
    expect(res2.isExternal).toBe(true);
    expect(res2.moduleName).toBe('vitest');
  });

  it('creates contains, exports, and imports edges correctly', () => {
    const mathCode = `
export function add(a: number, b: number) { return a + b; }
`;
    const userCode = `
import { add } from './math.js';
export function calc() { return add(1, 2); }
`;
    // Setup math file and node
    const mathFile = graphRepo.upsertFile({
      projectId,
      path: 'src/math.ts',
      sizeBytes: 100,
      lastModifiedAt: Date.now(),
      contentHash: 'hash-math',
    });
    const mathNode = graphRepo.addNode({
      projectId,
      entityType: 'file',
      entityId: mathFile.id,
      label: 'math.ts',
      path: 'src/math.ts',
    });
    const mathAnalysis = astAnalyzer.analyze('src/math.ts', mathCode);
    const mathSymNode = graphRepo.addNode({
      projectId,
      entityType: 'symbol',
      entityId: 'sym-add-1',
      label: 'add',
      name: 'add',
      path: 'src/math.ts',
      lineStart: 2,
      lineEnd: 2,
    });

    dependencyAnalyzer.linkFileDependencies(
      projectId,
      mathNode,
      mathAnalysis,
      [mathSymNode],
      ['src/math.ts', 'src/user.ts']
    );

    // Setup user file and node
    const userFile = graphRepo.upsertFile({
      projectId,
      path: 'src/user.ts',
      sizeBytes: 120,
      lastModifiedAt: Date.now(),
      contentHash: 'hash-user',
    });
    const userNode = graphRepo.addNode({
      projectId,
      entityType: 'file',
      entityId: userFile.id,
      label: 'user.ts',
      path: 'src/user.ts',
    });
    const userAnalysis = astAnalyzer.analyze('src/user.ts', userCode);
    const userSymNode = graphRepo.addNode({
      projectId,
      entityType: 'symbol',
      entityId: 'sym-calc-1',
      label: 'calc',
      name: 'calc',
      path: 'src/user.ts',
      lineStart: 3,
      lineEnd: 3,
    });

    const userEdges = dependencyAnalyzer.linkFileDependencies(
      projectId,
      userNode,
      userAnalysis,
      [userSymNode],
      ['src/math.ts', 'src/user.ts']
    );

    expect(userEdges.some((e) => e.relationType === 'contains')).toBe(true);
    expect(userEdges.some((e) => e.relationType === 'imports' && e.targetNodeId === mathNode.id)).toBe(true);
    expect(userEdges.some((e) => e.relationType === 'calls' && e.targetNodeId === mathSymNode.id)).toBe(true);
  });
});
