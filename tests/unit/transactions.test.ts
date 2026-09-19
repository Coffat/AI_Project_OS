import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';

describe('Transaction Management', () => {
  let client: SQLiteDatabaseClient;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
  });

  afterEach(() => {
    client.close();
  });

  it('should commit all operations when withTransaction succeeds', () => {
    client.withTransaction(() => {
      client.db
        .prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-tx-1', 'Tx Project', '/tx/path', Date.now(), Date.now());

      client.db
        .prepare('INSERT INTO tasks (id, project_id, title, status, priority, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('task-tx-1', 'proj-tx-1', 'Tx Task', 'planned', 'medium', 1, Date.now(), Date.now());
    });

    const project = client.db.prepare('SELECT * FROM projects WHERE id = ?').get('proj-tx-1');
    const task = client.db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-tx-1');

    expect(project).toBeDefined();
    expect(task).toBeDefined();
  });

  it('should rollback all operations when an exception occurs inside withTransaction', () => {
    expect(() => {
      client.withTransaction(() => {
        client.db
          .prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run('proj-rollback', 'Rollback Project', '/rollback/path', Date.now(), Date.now());

        // Deliberately throw an error mid-transaction
        throw new Error('Simulated failure');
      });
    }).toThrow('Simulated failure');

    // Verify project was rolled back and does not exist
    const project = client.db.prepare('SELECT * FROM projects WHERE id = ?').get('proj-rollback');
    expect(project).toBeUndefined();
  });

  it('should handle nested withTransaction without double-committing or throwing', () => {
    client.withTransaction(() => {
      client.db
        .prepare('INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('proj-nested', 'Nested Project', '/nested/path', Date.now(), Date.now());

      // Inner transaction
      client.withTransaction(() => {
        client.db
          .prepare('INSERT INTO tasks (id, project_id, title, status, priority, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('task-nested', 'proj-nested', 'Nested Task', 'planned', 'medium', 1, Date.now(), Date.now());
      });
    });

    const task = client.db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-nested');
    expect(task).toBeDefined();
  });
});
