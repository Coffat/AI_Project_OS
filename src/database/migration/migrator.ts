import type { DatabaseSync } from 'node:sqlite';
import { DatabaseError } from '../../core/errors.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Migration {
  name: string;
  sql: string;
}

export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: number;
}

export class Migrator {
  private migrationsDir: string;

  constructor(private readonly db: DatabaseSync, migrationsDir?: string) {
    if (migrationsDir) {
      this.migrationsDir = migrationsDir;
    } else {
      const candidate1 = path.resolve(__dirname, '../migrations');
      const candidate2 = path.resolve(__dirname, '../../../../src/database/migrations');
      const candidate3 = path.resolve(process.cwd(), 'src/database/migrations');
      if (fs.existsSync(candidate1)) {
        this.migrationsDir = candidate1;
      } else if (fs.existsSync(candidate2)) {
        this.migrationsDir = candidate2;
      } else if (fs.existsSync(candidate3)) {
        this.migrationsDir = candidate3;
      } else {
        this.migrationsDir = candidate1;
      }
    }
  }

  public initMigrationTable(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at INTEGER NOT NULL
        );
      `);
    } catch (error) {
      throw new DatabaseError('Failed to initialize _migrations table', error);
    }
  }

  public getAppliedMigrations(): string[] {
    this.initMigrationTable();
    try {
      const stmt = this.db.prepare('SELECT name FROM _migrations ORDER BY applied_at ASC');
      const rows = stmt.all() as Array<{ name: string }>;
      return rows.map((r) => r.name);
    } catch (error) {
      throw new DatabaseError('Failed to query applied migrations', error);
    }
  }

  public loadPendingMigrations(): Migration[] {
    this.initMigrationTable();
    const applied = new Set(this.getAppliedMigrations());
    const migrations: Migration[] = [];

    if (!fs.existsSync(this.migrationsDir)) {
      return migrations;
    }

    const files = fs.readdirSync(this.migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (!applied.has(file)) {
        const fullPath = path.join(this.migrationsDir, file);
        const sql = fs.readFileSync(fullPath, 'utf8');
        migrations.push({ name: file, sql });
      }
    }

    return migrations;
  }

  public runMigrations(): { applied: string[] } {
    this.initMigrationTable();
    const pending = this.loadPendingMigrations();
    const applied: string[] = [];

    for (const migration of pending) {
      this.applyMigration(migration);
      applied.push(migration.name);
    }

    return { applied };
  }

  public applyMigration(migration: Migration): void {
    const insertStmt = this.db.prepare(
      'INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)'
    );

    this.db.exec('BEGIN TRANSACTION;');
    try {
      this.db.exec(migration.sql);
      const migrationId = `mig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      insertStmt.run(migrationId, migration.name, Date.now());
      this.db.exec('COMMIT;');
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw new DatabaseError(`Migration failed on ${migration.name}: ${(error as Error).message}`, error);
    }
  }
}
