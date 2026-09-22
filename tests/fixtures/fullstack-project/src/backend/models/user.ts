import { DatabaseClient } from '../database/db-client.js';

export interface User {
  id: string;
  email: string;
  name: string;
  provider: string;
  providerUserId: string;
  createdAt: number;
  updatedAt: number;
}

export class UserModel {
  constructor(private readonly db: DatabaseClient) {}

  public async findByProviderId(provider: string, providerUserId: string): Promise<User | null> {
    const rows = await this.db.query<User>(
      'SELECT * FROM users WHERE provider = ? AND provider_user_id = ? LIMIT 1',
      [provider, providerUserId]
    );
    return rows[0] ?? null;
  }

  public async createFromOAuth(profile: {
    email: string;
    name: string;
    provider: string;
    providerUserId: string;
  }): Promise<User> {
    const now = Date.now();
    const newUser: User = {
      id: `usr_${Math.random().toString(36).substring(2, 9)}`,
      email: profile.email,
      name: profile.name,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.query(
      'INSERT INTO users (id, email, name, provider, provider_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        newUser.id,
        newUser.email,
        newUser.name,
        newUser.provider,
        newUser.providerUserId,
        newUser.createdAt,
        newUser.updatedAt,
      ]
    );

    return newUser;
  }
}
