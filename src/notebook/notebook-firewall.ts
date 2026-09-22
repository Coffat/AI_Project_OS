/**
 * NotebookLM Context Firewall
 *
 * Multi-layer strict validation that prevents sensitive or irrelevant
 * files from being exported to the NotebookLM knowledge pack.
 *
 * Violations abort immediately with FirewallViolationError.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { FirewallViolationError } from '../core/errors.js';

// ---------------------------------------------------------------------------
// Blocked path patterns
// ---------------------------------------------------------------------------

/** Glob-style prefix patterns that block entire subtrees */
const BLOCKED_PATH_PREFIXES: string[] = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.git/',
  'logs/',
  'tmp/',
  '.cache/',
  '.ai/handoff/',
  '.ai/state/',
  '.ai/tasks/',
];

/** Extensions that indicate source code — never in NotebookLM */
const BLOCKED_EXTENSIONS: Set<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.java', '.cs', '.rb', '.php', '.swift', '.kt',
  '.sh', '.bash', '.zsh', '.fish',
]);

/** Exact basenames that are always blocked */
const BLOCKED_BASENAMES: Set<string> = new Set([
  '.gitignore',
  '.DS_Store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
]);

/** Pattern fragments that indicate secrets */
const BLOCKED_FRAGMENTS: RegExp[] = [
  /^\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.cer$/i,
  /\.crt$/i,
  /\.log$/i,
  /\.(tmp|temp|bak|swp)$/i,
];

/** Maximum file size (bytes) allowed into the knowledge pack */
const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB

// ---------------------------------------------------------------------------
// FirewallResult
// ---------------------------------------------------------------------------

export interface FirewallResult {
  allowed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// NotebookFirewall
// ---------------------------------------------------------------------------

export class NotebookFirewall {
  /**
   * Validates a file path + optional size.
   * Throws FirewallViolationError if the file is blocked.
   * Returns silently if allowed.
   */
  public validate(filePath: string, sizeBytes?: number): void {
    const result = this.check(filePath, sizeBytes);
    if (!result.allowed) {
      throw new FirewallViolationError(result.reason ?? 'Blocked by firewall', filePath);
    }
  }

  /**
   * Same as validate() but returns a result instead of throwing.
   * Useful for bulk pre-filtering.
   */
  public check(filePath: string, sizeBytes?: number): FirewallResult {
    // Normalise: use forward slashes, strip leading ./
    const normalised = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const basename = path.basename(normalised);
    const ext = path.extname(normalised).toLowerCase();

    // 1. Blocked basenames
    if (BLOCKED_BASENAMES.has(basename)) {
      return { allowed: false, reason: `Blocked basename: ${basename}` };
    }

    // 2. Blocked extensions (source code)
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return {
        allowed: false,
        reason: `Source code extension blocked: ${ext}`,
      };
    }

    // 3. Blocked path prefixes (subtrees)
    for (const prefix of BLOCKED_PATH_PREFIXES) {
      if (normalised.startsWith(prefix) || normalised.includes('/' + prefix)) {
        return { allowed: false, reason: `Blocked path prefix: ${prefix}` };
      }
    }

    // 4. Blocked name fragments (env files, secrets, logs)
    for (const pattern of BLOCKED_FRAGMENTS) {
      if (pattern.test(basename)) {
        return { allowed: false, reason: `Blocked filename pattern: ${pattern}` };
      }
    }

    // 5. File size
    if (sizeBytes !== undefined && sizeBytes > MAX_FILE_SIZE_BYTES) {
      return {
        allowed: false,
        reason: `File exceeds 500 KB limit (${sizeBytes} bytes)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Validates an absolute path by also reading its actual size from disk.
   */
  public validateFile(absolutePath: string): void {
    const relative = path.basename(absolutePath); // used for basename checks
    // Run basic path check first (relative part)
    this.validate(absolutePath);

    // Check size from disk
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        throw new FirewallViolationError(
          `File exceeds 500 KB limit (${stat.size} bytes)`,
          relative
        );
      }
    } catch (err) {
      if (err instanceof FirewallViolationError) throw err;
      // If we can't stat, let it pass (file may not exist yet)
    }
  }

  /**
   * Filter a list of paths, returning only allowed ones.
   * Does NOT throw — use for bulk pre-filtering.
   */
  public filterAllowed(paths: string[]): string[] {
    return paths.filter((p) => this.check(p).allowed);
  }

  public get maxFileSizeBytes(): number {
    return MAX_FILE_SIZE_BYTES;
  }
}
