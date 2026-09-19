import { DatabaseSync } from 'node:sqlite';
import { DatabaseError } from '../core/errors.js';
import { Migrator } from './migration/migrator.js';

export interface DatabaseClientOptions {
  databasePath?: string;
  autoMigrate?: boolean;
  migrationsDir?: string;
}

export interface IDatabaseClient {
  readonly db: DatabaseSync;
  withTransaction<T>(work: () => T): T;
  initializeSchema(): void;
  close(): void;
}

export class SQLiteDatabaseClient implements IDatabaseClient {
  public readonly db: DatabaseSync;
  private readonly migrator: Migrator;
  private inTransaction = false;

  constructor(options?: DatabaseClientOptions | string) {
    const dbPath = typeof options === 'string' ? options : options?.databasePath ?? ':memory:';
    const autoMigrate = typeof options === 'string' ? true : options?.autoMigrate ?? true;
    const migrationsDir = typeof options === 'object' ? options?.migrationsDir : undefined;

    try {
      this.db = new DatabaseSync(dbPath);
      this.db.exec('PRAGMA foreign_keys = ON;');
      if (dbPath !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }

      this.migrator = new Migrator(this.db, migrationsDir);

      if (autoMigrate) {
        this.initializeSchema();
      }
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError(`Failed to open SQLite database at ${dbPath}`, error);
    }
  }

  public initializeSchema(): void {
    try {
      this.migrator.runMigrations();
    } catch (error) {
      throw new DatabaseError('Failed to run schema migrations', error);
    }
  }

  public withTransaction<T>(work: () => T): T {
    // If already inside an outer transaction, execute directly (nested execution)
    if (this.inTransaction) {
      return work();
    }

    this.db.exec('BEGIN TRANSACTION;');
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec('COMMIT;');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK;');
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  public getMigrator(): Migrator {
    return this.migrator;
  }

  public close(): void {
    try {
      this.db.close();
    } catch (error) {
      throw new DatabaseError('Failed to close database', error);
    }
  }
}
