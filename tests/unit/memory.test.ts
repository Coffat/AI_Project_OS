import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { MemoryEngine } from '../../src/memory/memory-engine.js';

describe('MemoryEngine', () => {
  let client: SQLiteDatabaseClient;
  let memoryEngine: MemoryEngine;
  const projectId = 'p1';

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    client.initializeSchema();

    client.db.prepare(`
      INSERT INTO projects (id, name, root_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(projectId, 'Memory Test Project', '/mem/path', Date.now(), Date.now());

    memoryEngine = new MemoryEngine(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('should record lessons and search via FTS5 / key', async () => {
    const lesson = await memoryEngine.recordLesson(
      projectId,
      'Tree-sitter Parsing Strategy',
      'Always cache AST queries to avoid re-parsing large AST trees on every file save.',
      'task-ast-1'
    );

    expect(lesson.id).toBeDefined();
    expect(lesson.category).toBe('LESSON');

    const fetched = await memoryEngine.getMemoryByKey(projectId, lesson.key);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe('Tree-sitter Parsing Strategy');

    const searchResults = await memoryEngine.searchMemory('Tree-sitter');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.title).toBe('Tree-sitter Parsing Strategy');
  });
});
