import type { DatabaseSync } from 'node:sqlite';

export abstract class BaseRepository {
  constructor(protected readonly db: DatabaseSync) {}

  protected serializeJson<T>(value: T | undefined | null, fallback = '{}'): string {
    if (value === undefined || value === null) return fallback;
    return JSON.stringify(value);
  }

  protected parseJson<T>(value: unknown, fallback: T): T {
    if (!value || typeof value !== 'string') return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
