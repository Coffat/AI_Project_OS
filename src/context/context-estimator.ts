import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CompressionMetrics {
  totalProjectTokens: number;
  selectedContextTokens: number;
  compressionRatio: number; // e.g. 0.982 = 98.2% reduction
  compressionPercentage: string; // "98.2%"
  compressionFactor: string; // "55.6x"
}

export interface ProjectEstimateOptions {
  ignorePatterns?: string[];
  maxFilesToScan?: number;
  maxFileSizeBytes?: number;
  fallbackTokens?: number;
}

export class ContextEstimator {
  private static readonly DEFAULT_CHARS_PER_TOKEN = 3.8;

  private static readonly DEFAULT_IGNORES = [
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.ai/sessions',
    '.next',
    '.cache',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ];

  private static readonly TEXT_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.json',
    '.md',
    '.txt',
    '.py',
    '.rs',
    '.go',
    '.sql',
    '.yaml',
    '.yml',
    '.html',
    '.css',
    '.c',
    '.cpp',
    '.h',
    '.toml',
    '.sh',
    '.zsh',
  ]);

  /**
   * Fast, deterministic token estimation for code, JSON, and markdown prose.
   * Standard average: ~3.8 characters per token for mixed technical text.
   */
  public estimateTokens(text: string | null | undefined): number {
    if (!text || text.length === 0) return 0;
    // Fast estimation: 3.8 chars per token
    return Math.ceil(text.length / ContextEstimator.DEFAULT_CHARS_PER_TOKEN);
  }

  /**
   * Scans a project directory to estimate the total token volume across all source & doc files.
   * Runs deterministically and bounds I/O with file size & count limits.
   */
  public async estimateProjectTokens(
    projectRoot: string,
    options: ProjectEstimateOptions = {}
  ): Promise<number> {
    const ignores = new Set([...ContextEstimator.DEFAULT_IGNORES, ...(options.ignorePatterns ?? [])]);
    const maxFiles = options.maxFilesToScan ?? 2000;
    const maxFileSize = options.maxFileSizeBytes ?? 1024 * 1024; // 1MB per file
    const fallbackTokens = options.fallbackTokens ?? 50000;

    if (!fs.existsSync(projectRoot)) {
      return fallbackTokens;
    }

    let totalChars = 0;
    let scannedFiles = 0;

    const walk = (dir: string): void => {
      if (scannedFiles >= maxFiles) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (scannedFiles >= maxFiles) break;

        const name = entry.name;
        if (ignores.has(name) || name.startsWith('.')) {
          // Special exception: allow .ai/canonical
          if (name === '.ai' && entry.isDirectory()) {
            // permit descending into .ai/canonical
            const canonicalPath = path.join(dir, '.ai', 'canonical');
            if (fs.existsSync(canonicalPath)) {
              walk(canonicalPath);
            }
          }
          continue;
        }

        const fullPath = path.join(dir, name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(name).toLowerCase();
          if (ContextEstimator.TEXT_EXTENSIONS.has(ext)) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size <= maxFileSize) {
                totalChars += stat.size;
                scannedFiles++;
              }
            } catch {
              // skip unreadable file
            }
          }
        }
      }
    };

    try {
      walk(projectRoot);
    } catch {
      return fallbackTokens;
    }

    if (totalChars === 0) {
      return fallbackTokens;
    }

    return Math.ceil(totalChars / ContextEstimator.DEFAULT_CHARS_PER_TOKEN);
  }

  /**
   * Computes compression ratio, percentage, and reduction factor.
   * E.g., 500,000 total tokens vs 9,000 selected context tokens yields:
   * ratio: 0.982, percentage: "98.2%", factor: "55.6x"
   */
  public calculateCompressionMetrics(
    totalProjectTokens: number,
    selectedContextTokens: number
  ): CompressionMetrics {
    const total = Math.max(1, totalProjectTokens);
    const selected = Math.max(0, selectedContextTokens);

    const saved = Math.max(0, total - selected);
    const ratio = Number((saved / total).toFixed(4));
    const percentage = `${(ratio * 100).toFixed(1)}%`;
    const factorNum = selected > 0 ? (total / selected).toFixed(1) : `${total}x`;
    const compressionFactor = `${factorNum}x`;

    return {
      totalProjectTokens: total,
      selectedContextTokens: selected,
      compressionRatio: ratio,
      compressionPercentage: percentage,
      compressionFactor,
    };
  }
}
