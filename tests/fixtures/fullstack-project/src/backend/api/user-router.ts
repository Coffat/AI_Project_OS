import { UserModel } from '../models/user.js';
import { TokenManager } from '../auth/token-manager.js';

export class UserRouter {
  constructor(
    private readonly userModel: UserModel,
    private readonly tokenManager: TokenManager
  ) {}

  public async getProfile(authHeader?: string): Promise<{ success: boolean; profile?: unknown; error?: string }> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Unauthorized' };
    }

    const token = authHeader.substring(7);
    const session = this.tokenManager.verifySessionToken(token);
    if (!session) {
      return { success: false, error: 'Invalid token' };
    }

    return {
      success: true,
      profile: {
        id: session.userId,
        email: session.email,
        provider: session.provider,
      },
    };
  }
}
