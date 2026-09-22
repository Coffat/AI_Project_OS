export interface OAuthProfile {
  id: string;
  email: string;
  name: string;
  provider: string;
}

export class OAuthService {
  constructor(
    private readonly clientId: string = 'client_id_dev',
    private readonly clientSecret: string = 'client_secret_dev'
  ) {}

  public getAuthorizationUrl(provider: string, state: string): string {
    return `https://auth.${provider}.com/oauth/authorize?client_id=${this.clientId}&state=${state}&response_type=code`;
  }

  public async exchangeCodeForProfile(
    provider: string,
    code: string
  ): Promise<OAuthProfile> {
    // Simulated token & profile exchange with OAuth provider
    if (!code || code === 'invalid_code') {
      throw new Error('Invalid OAuth authorization code');
    }

    return {
      id: `oauth_${provider}_${Math.random().toString(36).substring(2, 7)}`,
      email: `user_${provider}@example.com`,
      name: `OAuth User (${provider})`,
      provider,
    };
  }
}
