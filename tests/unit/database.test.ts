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

  it('should initialize schema in-memory successfully', () => {
    client = new SQLiteDatabaseClient(':memory:');
    client.initializeSchema();

    // Verify tables exist
    const tables = client.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('projects');
    expect(tableNames).toContain('tasks');
    expect(tableNames).toContain('task_checkpoints');
    expect(tableNames).toContain('handoffs');
    expect(tableNames).toContain('project_memory');
    expect(tableNames).toContain('graph_nodes');
    expect(tableNames).toContain('graph_edges');
    expect(tableNames).toContain('fts_project_memory');
    expect(tableNames).toContain('fts_code_symbols');
  });

  it('should enforce foreign key constraints', () => {
    client = new SQLiteDatabaseClient(':memory:');
    client.initializeSchema();

    // Inserting a task with non-existent project_id should fail
    expect(() => {
      client!.db.prepare(`
        INSERT INTO tasks (id, project_id, title, status, priority, created_at, updated_at)
        VALUES ('t1', 'non_existent_project', 'Sample', 'BACKLOG', 'MEDIUM', 1000, 1000)
      `).run();
    }).toThrow();
  });
});
