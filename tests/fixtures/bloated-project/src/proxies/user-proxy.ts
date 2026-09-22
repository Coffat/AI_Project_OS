import { UserService, User } from '../services/user-service.js';

export class UserProxy {
  private service: UserService = new UserService();

  public getUserById(id: string): User | undefined {
    return this.service.getUserById(id);
  }
}
