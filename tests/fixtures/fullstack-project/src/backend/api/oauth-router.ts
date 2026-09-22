import { OAuthService } from '../auth/oauth-service.js';
import { TokenManager } from '../auth/token-manager.js';
import { UserModel } from '../models/user.js';

export interface OAuthCallbackRequest {
  provider: string;
  query: {
    code?: string;
    state?: string;
    error?: string;
  };
  sessionState?: string;
}

export interface OAuthCallbackResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: {
    success: boolean;
    token?: string;
    userId?: string;
    error?: string;
  };
}

export class OAuthRouter {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly tokenManager: TokenManager,
    private readonly userModel: UserModel
  ) {}

  /**
   * Initial skeleton for OAuth callback handling.
   * Target implementation will validate state, exchange code, and return session token.
   */
  public async handleCallback(req: OAuthCallbackRequest): Promise<OAuthCallbackResponse> {
    if (req.query.error) {
      return {
        statusCode: 400,
        headers: {},
        body: { success: false, error: req.query.error },
      };
    }

    // TODO: Implement state parameter validation against CSRF (SEC-001)
    // TODO: Implement code exchange and user persistence (ADR-001, ADR-002)
    return {
      statusCode: 501,
      headers: {},
      body: { success: false, error: 'OAuth callback handling not implemented yet' },
    };
  }
}
