import { describe, it, expect, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';

describe('Database Module', () => {
  let client: SQLiteDatabaseClient | null = null;

  afterEach(() => {
    if (client) {
      client.close();
      client = null;
    }
  });

  it('should run migrations and initialize all 17 tables in-memory', () => {
    client = new SQLiteDatabaseClient(':memory:');

    // Verify all 17 tables + _migrations exist
    const tables = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    const expectedTables = [
      '_migrations',
      'projects',
      'tasks',
      'task_steps',
      'task_checkpoints',
      'handoffs',
      'decisions',
      'constraints',
      'memory_documents',
      'memory_chunks',
      'files',
      'symbols',
      'graph_nodes',
      'graph_edges',
      'events',
      'research_documents',
      'proposals',
      'validation_runs',
      'agent_sessions',
      'fts_memory_chunks',
      'fts_symbols',
    ];

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  it('should enforce foreign key constraints', () => {
    client = new SQLiteDatabaseClient(':memory:');

    // Inserting a task with non-existent project_id should fail
    expect(() => {
      client!.db.prepare(`
        INSERT INTO tasks (id, project_id, title, status, priority, created_at, updated_at)
        VALUES ('t1', 'non_existent_project', 'Sample', 'planned', 'medium', 1000, 1000)
      `).run();
    }).toThrow();
  });
});
