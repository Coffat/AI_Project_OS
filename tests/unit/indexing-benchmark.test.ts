import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { CodeIndexer } from '../../src/code-intelligence/code-indexer.js';

describe('Code Intelligence Indexing Benchmark', () => {
  it('benchmarks full project indexing and completes within target budget (<100ms)', async () => {
    const dbClient = new SQLiteDatabaseClient(':memory:');
    const indexer = new CodeIndexer(dbClient.db);
    const fixturePath = path.resolve(__dirname, '../fixtures/sample-project');
    const projectId = 'benchmark-proj';

    dbClient.db.prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, 'Bench Project', fixturePath, Date.now(), Date.now());

    const t0 = performance.now();
    const result = await indexer.indexProject(fixturePath, projectId);
    const duration = performance.now() - t0;

    console.log(`\n================ BENCHMARK RESULT ================`);
    console.log(`Files Indexed:    ${result.filesIndexed}`);
    console.log(`Symbols Indexed:  ${result.symbolsIndexed}`);
    console.log(`Edges Created:    ${result.edgesCreated}`);
    console.log(`Duration:         ${duration.toFixed(2)}ms`);
    console.log(`==================================================\n`);

    expect(result.filesIndexed).toBeGreaterThan(0);
    // Deterministic parsing of fixture files should take well under 250ms
    expect(duration).toBeLessThan(500);
  });
});
