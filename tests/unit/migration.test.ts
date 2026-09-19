import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Migrator } from '../../src/database/migration/migrator.js';
import { DatabaseError } from '../../src/core/errors.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Migration System', () => {
  let db: DatabaseSync;
  let tempDir: string;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai_os_mig_test_'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize _migrations table', () => {
    const migrator = new Migrator(db, tempDir);
    migrator.initMigrationTable();

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it('should apply pending migrations sequentially and be idempotent', () => {
    // Create two migration files
    fs.writeFileSync(
      path.join(tempDir, '001_create_users.sql'),
      'CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);'
    );
    fs.writeFileSync(
      path.join(tempDir, '002_create_posts.sql'),
      'CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT, user_id TEXT, FOREIGN KEY(user_id) REFERENCES users(id));'
    );

    const migrator = new Migrator(db, tempDir);

    // First run
    const result1 = migrator.runMigrations();
    expect(result1.applied).toEqual(['001_create_users.sql', '002_create_posts.sql']);

    const applied = migrator.getAppliedMigrations();
    expect(applied).toEqual(['001_create_users.sql', '002_create_posts.sql']);

    // Second run (idempotent)
    const result2 = migrator.runMigrations();
    expect(result2.applied).toEqual([]);
  });

  it('should rollback transaction and not register migration if migration script fails', () => {
    fs.writeFileSync(
      path.join(tempDir, '001_valid.sql'),
      'CREATE TABLE valid_table (id TEXT PRIMARY KEY);'
    );
    fs.writeFileSync(
      path.join(tempDir, '002_invalid.sql'),
      'CREATE TABLE invalid_table (id TEXT PRIMARY KEY); SYNTAX_ERROR_TRIGGER;'
    );

    const migrator = new Migrator(db, tempDir);

    expect(() => {
      migrator.runMigrations();
    }).toThrow(DatabaseError);

    // First migration was committed
    const applied = migrator.getAppliedMigrations();
    expect(applied).toEqual(['001_valid.sql']);

    // Second migration failed and was rolled back
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invalid_table'")
      .all();
    expect(tables).toHaveLength(0);
  });
});
