/**
 * MCP Security Validator
 *
 * Enforces security boundaries for AI coding agents connecting over MCP:
 *   - Project root boundary validation & path traversal prevention
 *   - Strict Task ID format validation
 *   - Sensitive file access rejection (.env, keys, secrets)
 *   - Safe command execution validation
 *   - Secret-scrubbed mutation audit logging
 */

import type { DatabaseSync } from 'node:sqlite';
import { EventRepository } from '../database/repositories/event.repository.js';
import { ValidationError } from '../core/errors.js';
import { SecurityGuard } from '../core/security-guard.js';

// Valid task ID format: e.g. TASK-001, task_001, UUID, alphanumeric with hyphens/underscores
const TASK_ID_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

export class MCPSecurityValidator {
  private readonly eventRepo?: EventRepository;

  constructor(
    private readonly projectRoot: string,
    db?: DatabaseSync
  ) {
    if (db) {
      this.eventRepo = new EventRepository(db);
    }
  }

  /**
   * Validates and sanitizes a file path relative to the project root.
   * Throws ValidationError if path traversal or escape is detected.
   */
  public sanitizePath(inputPath: string): string {
    return SecurityGuard.sanitizePath(this.projectRoot, inputPath);
  }

  /**
   * Validates task ID format.
   */
  public validateTaskId(taskId: string): string {
    if (!taskId || typeof taskId !== 'string') {
      throw new ValidationError('Task ID must be a non-empty string', 'taskId');
    }

    const trimmed = taskId.trim();
    if (!TASK_ID_REGEX.test(trimmed)) {
      throw new ValidationError(
        `Invalid task ID format: '${taskId}'. Must be 3-64 alphanumeric characters, dashes, or underscores.`,
        'taskId'
      );
    }

    return trimmed;
  }

  /**
   * Validates an agent-submitted shell command for safety against command injection.
   */
  public validateCommand(command: string): string {
    return SecurityGuard.validateCommand(command);
  }

  /**
   * Checks if a target file or pattern is a secret / sensitive file.
   */
  public checkSecretAccess(filePath: string): void {
    // Calling sanitizePath performs the boundary and sensitive file pattern checks
    SecurityGuard.sanitizePath(this.projectRoot, filePath);
  }

  /**
   * Records an audit event in the database for mutating MCP tool operations,
   * automatically scrubbing sensitive credentials.
   */
  public logMutation(
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    projectId = 'default'
  ): void {
    if (!this.eventRepo) return;

    try {
      const cleanParams = SecurityGuard.sanitizePayload(params);
      const cleanResult = SecurityGuard.sanitizePayload(
        typeof result === 'object' && result !== null
          ? (result as Record<string, unknown>)
          : { value: result }
      );

      this.eventRepo.recordEvent({
        projectId,
        eventType: 'mcp_mutation',
        aggregateType: 'mcp_server',
        aggregateId: toolName,
        agentIdentity: 'mcp-server',
        payload: {
          tool: toolName,
          params: cleanParams,
          result: cleanResult,
          timestamp: Date.now(),
        },
      });
    } catch {
      // Non-fatal: audit log failure should not break the agent response
    }
  }
}
