import * as fs from 'node:fs';
import * as path from 'node:path';
import { ExecutionSessionRecord } from '../core/types.js';
import { ValidationError } from '../core/errors.js';
import { SessionService, SessionServiceDependencies } from './session-service.js';
import {
  EndSessionOptions,
  EndSessionResult,
  ResumeSessionOptions,
  SessionStatusView,
  StartSessionOptions,
  StartSessionResult,
} from './types.js';

export class SessionManager {
  private readonly sessionService: SessionService;
  private readonly projectRoot: string;
  private readonly sessionPointerPath: string;

  constructor(
    deps: SessionServiceDependencies,
    projectRoot: string = process.cwd()
  ) {
    this.projectRoot = deps.projectRoot ?? projectRoot;
    this.sessionService = new SessionService(deps);
    this.sessionPointerPath = path.join(this.projectRoot, '.ai', 'sessions', 'CURRENT_SESSION.json');
  }

  public get service(): SessionService {
    return this.sessionService;
  }

  /**
   * Starts a new execution session and updates workspace pointer.
   */
  public async startSession(
    taskId: string,
    options?: StartSessionOptions
  ): Promise<StartSessionResult> {
    const result = await this.sessionService.startSession(taskId, options);
    this.persistCurrentSession(result.session);
    return result;
  }

  /**
   * Ends an active session, persists handoff, and updates pointer.
   */
  public async endSession(
    options: EndSessionOptions,
    sessionId?: string
  ): Promise<EndSessionResult> {
    const resolvedId = sessionId ?? this.readCurrentSessionId();
    if (!resolvedId) {
      throw new ValidationError('No active session found to end');
    }

    const result = await this.sessionService.endSession(resolvedId, options);
    this.persistCurrentSession(result.session);
    return result;
  }

  /**
   * Resumes a task in a fresh session and updates workspace pointer.
   */
  public async resumeSession(
    taskId: string,
    options?: ResumeSessionOptions
  ): Promise<StartSessionResult> {
    const result = await this.sessionService.resumeSession(taskId, options);
    this.persistCurrentSession(result.session);
    return result;
  }

  /**
   * Pauses an active session.
   */
  public async pauseSession(sessionId?: string): Promise<ExecutionSessionRecord> {
    const resolvedId = sessionId ?? this.readCurrentSessionId();
    if (!resolvedId) {
      throw new ValidationError('No active session found to pause');
    }

    const result = await this.sessionService.pauseSession(resolvedId);
    this.persistCurrentSession(result);
    return result;
  }

  /**
   * Retrieves status of current active session.
   */
  public async getStatus(sessionId?: string): Promise<SessionStatusView> {
    const resolvedId = sessionId ?? this.readCurrentSessionId();
    return this.sessionService.getSessionStatus(resolvedId);
  }

  public getCurrentSession(): { sessionId: string; taskId?: string; updatedAt: number } | null {
    try {
      if (!fs.existsSync(this.sessionPointerPath)) return null;
      const content = fs.readFileSync(this.sessionPointerPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private readCurrentSessionId(): string | undefined {
    const ptr = this.getCurrentSession();
    return ptr?.sessionId;
  }

  private persistCurrentSession(session: ExecutionSessionRecord): void {
    try {
      const dir = path.dirname(this.sessionPointerPath);
      fs.mkdirSync(dir, { recursive: true });

      const data = {
        sessionId: session.id,
        taskId: session.taskId,
        provider: session.provider,
        agent: session.agent,
        accountLabel: session.accountLabel,
        status: session.status,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        updatedAt: Date.now(),
      };

      fs.writeFileSync(this.sessionPointerPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Non-fatal if pointer file cannot be written
    }
  }
}
