/**
 * SecurityGuard
 *
 * Centralized security policy enforcement for AI Project OS:
 *   - Project Root Path Sandboxing & Traversal Prevention
 *   - Shell Command Injection Defense & Binary Allowlisting
 *   - Secret Scrubbing & Sensitive Token Redaction
 *   - Prompt Injection Defense & DATA vs SYSTEM INSTRUCTIONS Separation
 *   - Git Reference Parameterization & Flag Injection Prevention
 */

import * as path from 'node:path';
import { ValidationError } from './errors.js';

export const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.cer$/i,
  /\.crt$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /id_ecdsa/i,
  /credentials\.json/i,
  /service-account.*\.json/i,
  /(?:^|[._-])secrets?(\.|$)/i,
  /\.secret/i,
  /passwd$/i,
  /shadow$/i,
];

export const FORBIDDEN_SHELL_PATTERNS: RegExp[] = [
  /;\s*$/, // trailing semicolon
  /;\s*[^;]/, // command chaining with ;
  /\|\|/, // logical OR chaining
  /&&/, // logical AND chaining
  /\|/, // pipe chaining
  /`/, // backtick command substitution
  /\$\(/, // $(command) substitution
  />>/, // output append redirection
  />/, // output redirection
  /</, // input redirection
  /\n/, // newline command chaining
  /\r/, // carriage return
  /\0/, // null byte
  /\b(eval|source)\b/, // dynamic evaluation
];

export const FORBIDDEN_COMMAND_BINARIES: Set<string> = new Set([
  'rm',
  'rmdir',
  'del',
  'format',
  'mkfs',
  'dd',
  'curl',
  'wget',
  'nc',
  'netcat',
  'ncat',
  'bash',
  'sh',
  'zsh',
  'ksh',
  'csh',
  'sudo',
  'su',
  'chmod',
  'chown',
  'kill',
  'pkill',
  'killall',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'telnet',
  'shutdown',
  'reboot',
]);

export const DEFAULT_ALLOWED_VALIDATION_BINARIES: Set<string> = new Set([
  'pnpm',
  'npm',
  'yarn',
  'npx',
  'node',
  'vitest',
  'jest',
  'pytest',
  'cargo',
  'go',
  'tsc',
  'eslint',
  'prettier',
  'git',
  'echo',
]);

const SECRET_PATTERNS: Array<{ regex: RegExp; placeholder: string }> = [
  // Private keys
  {
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    placeholder: '[REDACTED_PRIVATE_KEY]',
  },
  // AWS Access Keys
  {
    regex: /\b(AKIA[0-9A-Z]{16})\b/g,
    placeholder: '[REDACTED_AWS_KEY]',
  },
  // GitHub Personal Access Tokens
  {
    regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b/g,
    placeholder: '[REDACTED_GITHUB_TOKEN]',
  },
  // Anthropic API Keys
  {
    regex: /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g,
    placeholder: '[REDACTED_ANTHROPIC_KEY]',
  },
  // OpenAI API Keys
  {
    regex: /\b(sk-(?:proj-)?[a-zA-Z0-9_-]{20,})\b/g,
    placeholder: '[REDACTED_OPENAI_KEY]',
  },
  // Generic Bearer Tokens
  {
    regex: /(Bearer\s+)[a-zA-Z0-9._-]{25,}/gi,
    placeholder: '$1[REDACTED_BEARER_TOKEN]',
  },
  // Generic JSON Web Tokens
  {
    regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g,
    placeholder: '[REDACTED_JWT_TOKEN]',
  },
  // Secret/Password assignments in JSON/Config/Code (handles quoted or unquoted)
  {
    regex: /(["']?(?:password|passwd|secret|api_key|apiKey|auth_token|client_secret)["']?\s*[:=]\s*["']?)([^"'\s\r\n]{6,})(["']?)/gi,
    placeholder: '$1[REDACTED_SECRET]$3',
  },
];

// Valid Git ref name (letters, numbers, underscores, dots, hyphens, slashes) - never starting with '-'
const GIT_REF_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_./@~^+-]*$/;

export class SecurityGuard {
  /**
   * Validates and sanitizes a file path relative to projectRoot.
   * Enforces:
   *   - Strict root jail check (prevents sibling directory prefix bypass like /app/project-fake)
   *   - Rejection of null bytes and directory traversal attempts
   *   - Blockage of sensitive files (.env, keys, certificates, credentials)
   */
  public static sanitizePath(projectRoot: string, inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new ValidationError('File path must be a non-empty string', 'path_traversal');
    }

    if (inputPath.includes('\0')) {
      throw new ValidationError('Null bytes detected in path', 'path_traversal');
    }

    const rootResolved = path.resolve(projectRoot);
    const resolved = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(rootResolved, inputPath);

    // Strict boundary jail: must be identical or within rootResolved + path.sep
    const isInside =
      resolved === rootResolved ||
      resolved.startsWith(rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep);

    if (!isInside) {
      throw new ValidationError(
        `Path traversal detected: '${inputPath}' escapes project root`,
        'path_traversal'
      );
    }

    const rel = path.relative(rootResolved, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new ValidationError(
        `Path traversal detected: '${inputPath}' escapes project root`,
        'path_traversal'
      );
    }

    // Check sensitive file patterns
    const basename = path.basename(resolved);
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(basename)) {
        throw new ValidationError(
          `Access to sensitive file '${basename}' is prohibited`,
          'security_restriction'
        );
      }
    }

    return rel || '.';
  }

  /**
   * Validates a shell command string against command injection patterns and unauthorized binaries.
   */
  public static validateCommand(
    command: string,
    options: {
      allowedBinaries?: Set<string>;
      allowChaining?: boolean;
    } = {}
  ): string {
    if (!command || typeof command !== 'string') {
      throw new ValidationError('Command must be a non-empty string', 'command_injection');
    }

    const trimmed = command.trim();
    if (!trimmed) {
      throw new ValidationError('Command cannot be whitespace only', 'command_injection');
    }

    // Disallow null bytes
    if (trimmed.includes('\0')) {
      throw new ValidationError('Null bytes detected in command', 'command_injection');
    }

    // Check forbidden chaining/substitution metacharacters unless explicitly permitted
    if (!options.allowChaining) {
      for (const pattern of FORBIDDEN_SHELL_PATTERNS) {
        if (pattern.test(trimmed)) {
          throw new ValidationError(
            `Command contains forbidden shell metacharacter or chaining pattern: '${trimmed}'`,
            'command_injection'
          );
        }
      }
    }

    // Extract primary binary name (e.g. "pnpm test" -> "pnpm")
    const tokens = trimmed.split(/\s+/);
    const binaryCandidate = tokens[0] ?? '';
    const binaryBase = path.basename(binaryCandidate).toLowerCase();

    // Check explicitly forbidden binaries
    if (FORBIDDEN_COMMAND_BINARIES.has(binaryBase)) {
      throw new ValidationError(
        `Execution of prohibited command binary '${binaryBase}' is disallowed`,
        'command_injection'
      );
    }

    // If an allowlist is provided, verify against it
    const allowed = options.allowedBinaries ?? DEFAULT_ALLOWED_VALIDATION_BINARIES;
    if (allowed.size > 0 && !allowed.has(binaryBase)) {
      throw new ValidationError(
        `Command binary '${binaryBase}' is not in the allowed validation tool list`,
        'command_injection'
      );
    }

    return trimmed;
  }

  /**
   * Scrubs sensitive tokens, passwords, API keys, and private keys from strings or structured objects.
   */
  public static scrubSecrets(content: string): string {
    if (!content || typeof content !== 'string') {
      return content;
    }

    let result = content;
    for (const { regex, placeholder } of SECRET_PATTERNS) {
      result = result.replace(regex, placeholder);
    }
    return result;
  }

  /**
   * Recursively sanitizes JSON/payload objects to ensure no sensitive credentials are logged.
   */
  public static sanitizePayload<T>(payload: T): T {
    if (payload === null || payload === undefined) {
      return payload;
    }

    if (typeof payload === 'string') {
      return SecurityGuard.scrubSecrets(payload) as unknown as T;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => SecurityGuard.sanitizePayload(item)) as unknown as T;
    }

    if (typeof payload === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (/password|secret|token|apiKey|api_key|credentials/i.test(key) && typeof value === 'string') {
          sanitized[key] = '[REDACTED_CREDENTIAL]';
        } else {
          sanitized[key] = SecurityGuard.sanitizePayload(value);
        }
      }
      return sanitized as T;
    }

    return payload;
  }

  /**
   * Validates git ref string to prevent argument/option injection (e.g. --output=..., -e).
   */
  public static validateGitRef(ref: string, refName = 'git ref'): string {
    if (!ref || typeof ref !== 'string') {
      throw new ValidationError(`${refName} must be a non-empty string`, 'git_security');
    }

    const trimmed = ref.trim();
    if (trimmed.startsWith('-')) {
      throw new ValidationError(
        `Security violation: ${refName} '${trimmed}' cannot start with a hyphen (flag injection prevention)`,
        'git_security'
      );
    }

    if (!GIT_REF_REGEX.test(trimmed)) {
      throw new ValidationError(
        `Invalid ${refName} format: '${trimmed}' contains forbidden characters`,
        'git_security'
      );
    }

    return trimmed;
  }

  /**
   * Defangs prompt injection markers in repository files and markdown documents.
   * Replaces fake system tags and prompt overrides with neutral escaped text.
   */
  public static neutralizePromptInjection(text: string): string {
    if (!text || typeof text !== 'string') {
      return text;
    }

    return text
      .replace(/\[\s*SYSTEM\s+INSTRUCTION[^\]]*\]/gi, '[DATA_MARKER: SYSTEM_INSTRUCTION_OVERRIDE_DEFANGED]')
      .replace(/<\s*\/?\s*system\s*>/gi, '[DATA_MARKER: SYSTEM_TAG_DEFANGED]')
      .replace(/<\s*\/?\s*instruction\s*>/gi, '[DATA_MARKER: INSTRUCTION_TAG_DEFANGED]')
      .replace(/\b(?:SYSTEM\s+PROMPT|SYSTEM\s+INSTRUCTION):\s*/gi, '[DEFANGED_SYSTEM_PROMPT]: ')
      .replace(/\b(ignore\s+all\s+(?:previous|prior)\s+instructions)\b/gi, '[DEFANGED: $1]')
      .replace(/\b(disregard\s+(?:all\s+)?(?:previous|prior)\s+rules)\b/gi, '[DEFANGED: $1]');
  }

  /**
   * Wraps repository data, code snippets, or research text inside a strict, demarcated
   * `<untrusted_data>` envelope so LLMs clearly differentiate passive DATA from authoritative SYSTEM INSTRUCTIONS.
   */
  public static wrapUntrustedData(
    content: string,
    metadata: {
      type: 'repository_file' | 'symbol' | 'test' | 'research_proposal' | 'external_note' | 'git_diff';
      path?: string;
      identifier?: string;
    }
  ): string {
    const sanitizedContent = SecurityGuard.scrubSecrets(SecurityGuard.neutralizePromptInjection(content));
    const pathAttr = metadata.path ? ` path="${metadata.path}"` : '';
    const idAttr = metadata.identifier ? ` id="${metadata.identifier}"` : '';

    return [
      `<untrusted_data type="${metadata.type}"${pathAttr}${idAttr}>`,
      sanitizedContent,
      `</untrusted_data>`,
    ].join('\n');
  }
}
