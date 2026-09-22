import _ from 'underscore';
import { User } from './user-service.js';

export class UserManager {
  private users: Map<string, User> = new Map();

  public getUserById(id: string): User | undefined {
    return this.users.get(id);
  }

  public createUser(user: User): User {
    this.users.set(user.id, user);
    return user;
  }

  public updateUser(id: string, updates: Partial<User>): User | undefined {
    const existing = this.users.get(id);
    if (!existing) return undefined;
    const updated = _.extend({}, existing, updates);
    this.users.set(id, updated);
    return updated;
  }
}
