import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProviderAccountManager } from '../../src/providers/provider-account-manager.js';

describe('ProviderAccountManager (Cockpit Anti-Ban Vault)', () => {
  let tempDir: string;
  let manager: ProviderAccountManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-test-'));
    const mockIdeDir = path.join(tempDir, 'mock-ides');
    fs.mkdirSync(mockIdeDir, { recursive: true });
    manager = new ProviderAccountManager({
      baseDir: tempDir,
      ideDataPathResolver: (provider) => path.join(mockIdeDir, provider),
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('generates unique persistent hardware fingerprints', () => {
    const fp1 = manager.generateFingerprint();
    const fp2 = manager.generateFingerprint();

    expect(fp1.machineId).toHaveLength(64);
    expect(fp2.machineId).toHaveLength(64);
    expect(fp1.machineId).not.toBe(fp2.machineId);
    expect(fp1.sqmId).toMatch(/^\{[A-F0-9-]+\}$/);
  });

  it('creates and lists accounts manually', () => {
    const acc = manager.addAccountManual({
      provider: 'cursor',
      name: 'Cursor Pro Work',
      accountLabel: 'work-team',
      email: 'work@example.com',
    });

    expect(acc.id).toBeDefined();
    expect(acc.provider).toBe('cursor');
    expect(acc.name).toBe('Cursor Pro Work');
    expect(acc.accountLabel).toBe('work-team');
    expect(acc.isActive).toBe(true);
    expect(acc.fingerprint.machineId).toBeDefined();

    const list = manager.listAccounts();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(acc.id);
  });

  it('captures account and assigns active status', () => {
    const acc = manager.captureCurrentAccount({
      provider: 'antigravity',
      name: 'Antigravity Main',
      accountLabel: 'pro-tier',
    });

    expect(acc.provider).toBe('antigravity');
    expect(acc.isActive).toBe(true);

    const active = manager.getActiveAccount('antigravity');
    expect(active?.id).toBe(acc.id);
  });

  it('switches accounts safely and preserves individual fingerprints', () => {
    const acc1 = manager.addAccountManual({
      provider: 'cursor',
      name: 'Account 1',
      accountLabel: 'tier-1',
    });
    const acc2 = manager.addAccountManual({
      provider: 'cursor',
      name: 'Account 2',
      accountLabel: 'tier-2',
    });

    expect(manager.getActiveAccount('cursor')?.id).toBe(acc1.id);

    const switchResult = manager.switchAccount(acc2.id, true);
    expect(switchResult.success).toBe(true);
    expect(switchResult.activeAccountId).toBe(acc2.id);

    const activeAfter = manager.getActiveAccount('cursor');
    expect(activeAfter?.id).toBe(acc2.id);
    expect(activeAfter?.fingerprint.machineId).toBe(acc2.fingerprint.machineId);
    expect(activeAfter?.fingerprint.machineId).not.toBe(acc1.fingerprint.machineId);
  });

  it('enforces 3-minute cooldown on quota refresh to prevent bot flagging', () => {
    const acc = manager.addAccountManual({
      provider: 'windsurf',
      name: 'Windsurf Account',
    });

    // First check has a recent lastCheckedAt
    expect(() => manager.refreshQuota(acc.id)).toThrow(/Quota refresh cooldown active/);
  });

  it('deletes account and its profile folder cleanly', () => {
    const acc = manager.addAccountManual({
      provider: 'copilot',
      name: 'Copilot Test',
    });

    expect(manager.listAccounts('copilot')).toHaveLength(1);

    const deleted = manager.deleteAccount(acc.id);
    expect(deleted).toBe(true);
    expect(manager.listAccounts('copilot')).toHaveLength(0);
  });

  it('initiates OAuth session with valid client ID and completes callback', async () => {
    const session = manager.startOAuthLogin({
      provider: 'antigravity',
      name: 'Google Antigravity Work',
      openBrowser: false,
    });

    expect(session.state).toBeDefined();
    expect(session.status).toBe('pending');
    expect(session.loginUrl).toContain('mock-antigravity-client-id');
    expect(session.loginUrl).toContain('http%3A%2F%2Flocalhost%3A51121%2Foauth-callback');

    const acc = await manager.completeOAuthCallback(session.state, 'test_code_123', 'vut210225@gmail.com');
    expect(acc.email).toBe('vut210225@gmail.com');
    expect(acc.provider).toBe('antigravity');
    expect(acc.fingerprint.machineId).toBeDefined();

    const storedSession = manager.getOAuthSession(session.state);
    expect(storedSession?.status).toBe('completed');
    expect(storedSession?.account?.id).toBe(acc.id);
  });
});
