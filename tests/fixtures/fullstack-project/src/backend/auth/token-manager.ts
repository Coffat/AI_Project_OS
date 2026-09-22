export interface SessionTokenPayload {
  userId: string;
  email: string;
  provider: string;
}

export class TokenManager {
  private readonly secretKey: string;

  constructor(secretKey: string = process.env['JWT_SECRET'] ?? 'default-dev-secret') {
    this.secretKey = secretKey;
  }

  public generateSessionToken(payload: SessionTokenPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = Buffer.from(`sig_${payload.userId}_${this.secretKey.length}`).toString('base64url');
    return `jwt.${encoded}.${signature}`;
  }

  public verifySessionToken(token: string): SessionTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || parts[0] !== 'jwt') return null;
      const raw = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
      return JSON.parse(raw) as SessionTokenPayload;
    } catch {
      return null;
    }
  }
}
