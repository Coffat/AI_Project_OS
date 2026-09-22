/**
 * NotebookManifest builder
 *
 * Discovers canonical knowledge files eligible for NotebookLM export,
 * runs them through the firewall, and builds a NotebookManifest.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  NotebookManifest,
  NotebookSourceEntry,
  NotebookSourceCategory,
  NotebookExportOptions,
} from '../core/types.js';
import { NotebookFirewall } from './notebook-firewall.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Rough token estimate: 4 characters ≈ 1 token */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function firstParagraph(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  return lines[0]?.slice(0, 200) ?? '';
}

// ---------------------------------------------------------------------------
// Source discovery rules
// ---------------------------------------------------------------------------

interface DiscoveryRule {
  relPath: string;
  category: NotebookSourceCategory;
  glob?: boolean; // if true, relPath is a directory; discover all .md files inside
}

const DISCOVERY_RULES: DiscoveryRule[] = [
  { relPath: '.ai/canonical/PROJECT.md',      category: 'canonical_project' },
  { relPath: '.ai/canonical/ARCHITECTURE.md', category: 'architecture' },
  { relPath: '.ai/canonical/CONSTRAINTS.md',  category: 'canonical_project' },
  { relPath: '.ai/notebook/PROJECT-KNOWLEDGE.md', category: 'canonical_project' },
  { relPath: '.ai/notebook/ARCHITECTURE.md',  category: 'architecture' },
  { relPath: '.ai/notebook/DECISIONS.md',     category: 'decision' },
  { relPath: '.ai/notebook/SOURCES.md',       category: 'research' },
  { relPath: '.ai/canonical/DECISIONS',       category: 'decision',      glob: true },
  { relPath: '.ai/research',                  category: 'research',      glob: true },
  { relPath: '.ai/specs',                     category: 'specification', glob: true },
];

// ---------------------------------------------------------------------------
// NotebookManifestBuilder
// ---------------------------------------------------------------------------

export class NotebookManifestBuilder {
  private readonly firewall: NotebookFirewall;

  constructor(private readonly projectRoot: string) {
    this.firewall = new NotebookFirewall();
  }

  public build(options: NotebookExportOptions = {}): NotebookManifest {
    const sources: NotebookSourceEntry[] = [];
    const warnings: string[] = [];
    const seenPaths = new Set<string>();

    for (const rule of DISCOVERY_RULES) {
      const absPath = path.join(this.projectRoot, rule.relPath);

      if (rule.glob) {
        // Discover all .md files inside the directory
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) continue;

        const files = fs.readdirSync(absPath).filter((f) => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(absPath, file);
          const relFile = path.join(rule.relPath, file);
          this.processFile(filePath, relFile, rule.category, sources, seenPaths, warnings, options);
        }
      } else {
        if (!fs.existsSync(absPath)) continue;
        this.processFile(absPath, rule.relPath, rule.category, sources, seenPaths, warnings, options);
      }
    }

    const totalWords = sources.reduce((s, e) => s + e.wordCount, 0);
    const totalTokens = sources.reduce((s, e) => s + e.tokenEstimate, 0);

    return {
      projectId: options.projectId ?? 'unknown',
      generatedAt: Date.now(),
      version: '1.0.0',
      totalSources: sources.length,
      totalWords,
      totalTokens,
      sources,
      excludedPatterns: [
        'node_modules/**', 'dist/**', 'build/**', 'coverage/**',
        '*.log', 'logs/**', 'tmp/**', '.cache/**', '.git/**',
        '.env*', '*.pem', '*.key', '.ai/handoff/**', '.ai/state/**', '.ai/tasks/**',
        '*.tmp', '*.bak', '*.swp',
        '*.ts', '*.js', '*.py', '*.go',
      ],
      firewallVerified: true,
    };
  }

  private processFile(
    absolutePath: string,
    relativePath: string,
    category: NotebookSourceCategory,
    sources: NotebookSourceEntry[],
    seenPaths: Set<string>,
    warnings: string[],
    _options: NotebookExportOptions
  ): void {
    if (seenPaths.has(absolutePath)) return;
    seenPaths.add(absolutePath);

    // Firewall check
    const firewallResult = this.firewall.check(relativePath);
    if (!firewallResult.allowed) {
      warnings.push(`Firewall blocked ${relativePath}: ${firewallResult.reason}`);
      return;
    }

    let content: string;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
      content = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      warnings.push(`Could not read ${relativePath}`);
      return;
    }

    // Size check
    if (stat.size > this.firewall.maxFileSizeBytes) {
      warnings.push(`Skipped ${relativePath}: exceeds 500 KB`);
      return;
    }

    const title = this.extractTitle(content, path.basename(relativePath));
    const entry: NotebookSourceEntry = {
      id: relativePath.replace(/[^a-zA-Z0-9]/g, '_'),
      title,
      relativePath,
      category,
      sha256: sha256(content),
      wordCount: countWords(content),
      tokenEstimate: estimateTokens(content),
      abstract: firstParagraph(content) || undefined,
    };

    sources.push(entry);
  }

  private extractTitle(content: string, fallback: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return (match?.[1]?.trim()) ?? fallback.replace(/\.md$/, '');
  }
}
