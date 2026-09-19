import { add } from '../math.js';
import { IUserService, UserModel } from '../models/user.js';

/**
 * Service implementation for managing users.
 */
export class UserService implements IUserService {
  public getUser(id: string): { id: string; name: string } {
    return { id, name: `User_${id}` };
  }

  public calculateUserScore(a: number, b: number): number {
    return add(a, b);
  }

  public getModelName(): string {
    return UserModel.tableName;
  }
}
