/**
 * Database table representation for users.
 */
export const UserModel = sqliteTable('users', {
  id: 'TEXT PRIMARY KEY',
  name: 'TEXT',
  email: 'TEXT',
});

function sqliteTable(tableName: string, _schema: Record<string, string>) {
  return { tableName };
}

/**
 * Service interface for user operations.
 */
export interface IUserService {
  getUser(id: string): { id: string; name: string };
  calculateUserScore(a: number, b: number): number;
}
