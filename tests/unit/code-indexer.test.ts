import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { CodeIndexer } from '../../src/code-intelligence/code-indexer.js';
import { GraphRepository } from '../../src/database/repositories/graph.repository.js';

describe('CodeIndexer', () => {
  let dbClient: SQLiteDatabaseClient;
  let codeIndexer: CodeIndexer;
  let graphRepo: GraphRepository;
  const fixturePath = path.resolve(__dirname, '../fixtures/sample-project');
  const projectId = 'sample-project-id';

  beforeEach(() => {
    dbClient = new SQLiteDatabaseClient(':memory:');
    codeIndexer = new CodeIndexer(dbClient.db);
    graphRepo = new GraphRepository(dbClient.db);

    dbClient.db.prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, 'Sample Project', fixturePath, Date.now(), Date.now());
  });

  it('indexes all files in fixture project with symbols and graph edges', async () => {
    const result = await codeIndexer.indexProject(fixturePath, projectId);

    expect(result.filesIndexed).toBeGreaterThanOrEqual(7);
    expect(result.symbolsIndexed).toBeGreaterThanOrEqual(8);
    expect(result.edgesCreated).toBeGreaterThanOrEqual(10);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify files table
    const files = graphRepo.listFiles(projectId);
    expect(files.some((f) => f.path === 'src/math.ts')).toBe(true);
    expect(files.some((f) => f.path === 'src/services/user-service.ts')).toBe(true);

    // Verify symbols in database
    const addSymbols = graphRepo.searchSymbolsFTS('add');
    expect(addSymbols.length).toBeGreaterThan(0);
    expect(addSymbols[0]?.name).toBe('add');

    // Verify graph edges
    const mathNodes = graphRepo.findNodesByPath(projectId, 'src/math.ts');
    const mathFileNode = mathNodes.find((n) => n.entityType === 'file');
    expect(mathFileNode).toBeDefined();

    const containsEdges = graphRepo.findEdgesBySource(mathFileNode!.id, 'contains');
    expect(containsEdges.length).toBeGreaterThan(0);
  });

  it('handles incremental indexing and file deletions cleanly', async () => {
    // 1. Initial index
    await codeIndexer.indexProject(fixturePath, projectId);

    // 2. Perform incremental delete on a file
    graphRepo.deleteFileGraph(projectId, 'src/math.ts');

    const fileAfterDelete = graphRepo.findFileByPath(projectId, 'src/math.ts');
    expect(fileAfterDelete).toBeNull();

    const nodesAfterDelete = graphRepo.findNodesByPath(projectId, 'src/math.ts');
    expect(nodesAfterDelete).toHaveLength(0);

    // 3. Perform incremental reindex
    const reindexResult = await codeIndexer.indexChanged(fixturePath, projectId);
    expect(reindexResult.durationMs).toBeGreaterThanOrEqual(0);

    // After reindexing, math.ts should be restored
    const fileRestored = graphRepo.findFileByPath(projectId, 'src/math.ts');
    expect(fileRestored).not.toBeNull();
  });
});
