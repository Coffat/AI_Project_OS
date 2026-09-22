import { ContextLevel, ExcludedContextItem } from '../core/types.js';
import { ContextEstimator } from './context-estimator.js';

export interface DeduplicableCandidate {
  id: string;
  type: string;
  level: ContextLevel;
  content: string;
  score: number;
  priorityTier: number;
  mandatory?: boolean;
  reason?: string;
  filePath?: string;
  rawContent?: string;
  compressedContent?: string;
}

export interface DeduplicationResult<T extends DeduplicableCandidate> {
  kept: T[];
  deduplicated: ExcludedContextItem[];
  tokensSaved: number;
}

export class ContextDeduplicator {
  private readonly estimator: ContextEstimator;
  private readonly similarityThreshold: number;
  private readonly deduplicateSymbols: boolean;

  constructor(
    options: {
      similarityThreshold?: number;
      estimator?: ContextEstimator;
      deduplicateSymbols?: boolean;
    } = {}
  ) {
    this.estimator = options.estimator ?? new ContextEstimator();
    this.similarityThreshold = options.similarityThreshold ?? 0.4;
    this.deduplicateSymbols = options.deduplicateSymbols ?? false;
  }

  /**
   * Deduplicates candidate items across layers (Architecture vs Decisions, Constraints vs Decisions,
   * Code files vs Symbols, and Exact Duplicates).
   */
  public deduplicate<T extends DeduplicableCandidate>(candidates: T[]): DeduplicationResult<T> {
    const kept: T[] = [];
    const deduplicated: ExcludedContextItem[] = [];
    let tokensSaved = 0;

    // 1. First pass: exact duplicate content detection
    const seenContentHashes = new Map<string, T>();
    const pass1Candidates: T[] = [];

    for (const item of candidates) {
      if (item.mandatory) {
        pass1Candidates.push(item);
        continue;
      }

      const normalized = this.normalizeText(item.content);
      const existing = seenContentHashes.get(normalized);
      if (existing) {
        const tokens = this.estimator.estimateTokens(item.content);
        tokensSaved += tokens;
        deduplicated.push({
          id: item.id,
          type: item.type,
          level: item.level,
          reason: `Deduplicated: exact duplicate content already provided by ${existing.id}`,
          tokens,
          coveredBy: existing.id,
        });
      } else {
        seenContentHashes.set(normalized, item);
        pass1Candidates.push(item);
      }
    }

    // 2. Identify files that have full content included
    const fullContentFilePaths = new Set<string>();
    for (const item of pass1Candidates) {
      if (item.type === 'file' && item.filePath) {
        // If file does not indicate it's only an outline
        if (!item.content.includes('// [Outline Compressed]')) {
          fullContentFilePaths.add(item.filePath);
        }
      }
    }

    // 3. Second pass: Cross-layer deduplication
    // Separate decisions and architecture rules to detect mutual redundancy
    const decisions = pass1Candidates.filter((c) => c.type === 'decision');
    const architectures = pass1Candidates.filter((c) => c.type === 'architecture');
    const constraints = pass1Candidates.filter((c) => c.type === 'constraint');

    const excludedCandidateIds = new Set<string>();

    // Cross-deduplication Rule A: Architecture vs Decision
    // If a decision and an architecture rule share high information overlap,
    // the Decision (usually more specific/recent) covers the architecture rule.
    for (const arch of architectures) {
      if (excludedCandidateIds.has(arch.id)) continue;
      const archTokens = this.extractMeaningfulTokens(arch.content);
      if (archTokens.size < 4) continue;

      for (const dec of decisions) {
        if (excludedCandidateIds.has(dec.id)) continue;
        const decTokens = this.extractMeaningfulTokens(dec.content);
        if (decTokens.size < 4) continue;

        const similarity = this.calculateJaccardSimilarity(archTokens, decTokens);
        const isSubstring = this.checkSubstantialOverlap(arch.content, dec.content);

        if (similarity >= this.similarityThreshold || isSubstring) {
          // Both convey the same information. If decision has higher or equal score, drop architecture
          if (dec.score >= arch.score || dec.priorityTier <= arch.priorityTier) {
            excludedCandidateIds.add(arch.id);
            const tokens = this.estimator.estimateTokens(arch.content);
            tokensSaved += tokens;
            deduplicated.push({
              id: arch.id,
              type: arch.type,
              level: arch.level,
              reason: `Deduplicated: information already covered by decision [${dec.id}]`,
              tokens,
              coveredBy: dec.id,
            });
            break;
          } else {
            excludedCandidateIds.add(dec.id);
            const tokens = this.estimator.estimateTokens(dec.content);
            tokensSaved += tokens;
            deduplicated.push({
              id: dec.id,
              type: dec.type,
              level: dec.level,
              reason: `Deduplicated: information already covered by architecture [${arch.id}]`,
              tokens,
              coveredBy: arch.id,
            });
          }
        }
      }
    }

    // Cross-deduplication Rule B: Constraints vs Decisions / Architecture
    for (const con of constraints) {
      if (excludedCandidateIds.has(con.id)) continue;
      const conTokens = this.extractMeaningfulTokens(con.content);
      if (conTokens.size < 3) continue;

      // Check against decisions
      for (const dec of decisions) {
        if (excludedCandidateIds.has(dec.id)) continue;
        const decTokens = this.extractMeaningfulTokens(dec.content);
        const similarity = this.calculateJaccardSimilarity(conTokens, decTokens);
        if (similarity >= 0.55 || this.checkSubstantialOverlap(con.content, dec.content)) {
          // Constraint is preserved as mandatory policy, but if decision is identical, drop duplicate decision text
          if (dec.score < con.score) {
            excludedCandidateIds.add(dec.id);
            const tokens = this.estimator.estimateTokens(dec.content);
            tokensSaved += tokens;
            deduplicated.push({
              id: dec.id,
              type: dec.type,
              level: dec.level,
              reason: `Deduplicated: constraint [${con.id}] already enforces this rule`,
              tokens,
              coveredBy: con.id,
            });
          }
        }
      }
    }

    // Cross-deduplication Rule C: Full Code File vs Isolated Symbol Signatures (optional)
    for (const item of pass1Candidates) {
      if (excludedCandidateIds.has(item.id)) continue;

      if (
        this.deduplicateSymbols &&
        item.type === 'symbol' &&
        item.filePath &&
        fullContentFilePaths.has(item.filePath)
      ) {
        // Full file is already included, so individual symbol signature is redundant
        excludedCandidateIds.add(item.id);
        const tokens = this.estimator.estimateTokens(item.content);
        tokensSaved += tokens;
        deduplicated.push({
          id: item.id,
          type: item.type,
          level: item.level,
          reason: `Deduplicated: symbol already contained in fully included file [${item.filePath}]`,
          tokens,
          coveredBy: `file:${item.filePath}`,
        });
        continue;
      }

      kept.push(item);
    }

    return {
      kept,
      deduplicated,
      tokensSaved,
    };
  }

  /**
   * Normalizes text by removing markdown formatting, punctuation, and extra whitespace.
   */
  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[#*`_~>\-[\]():;,.{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extracts meaningful unique token words (excluding basic stop words).
   */
  private extractMeaningfulTokens(text: string): Set<string> {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'can', 'could', 'should', 'would', 'will', 'must', 'all', 'any', 'this', 'that',
      'these', 'those', 'it', 'its', 'from', 'as', 'into', 'use', 'uses', 'used', 'using',
    ]);

    const words = this.normalizeText(text)
      .split(' ')
      .filter((w) => w.length > 2 && !stopWords.has(w));

    return new Set(words);
  }

  /**
   * Computes Jaccard Similarity between two sets of token words: |A ∩ B| / |A ∪ B|
   */
  private calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersectionCount = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionCount++;
      }
    }

    const unionCount = setA.size + setB.size - intersectionCount;
    return unionCount > 0 ? intersectionCount / unionCount : 0;
  }

  /**
   * Checks if either text substantially contains the significant phrases of the other.
   */
  private checkSubstantialOverlap(textA: string, textB: string): boolean {
    const normA = this.normalizeText(textA);
    const normB = this.normalizeText(textB);

    if (normA.length < 20 || normB.length < 20) return false;

    // Check if one contains a large chunk (>= 35 chars) of the other
    const minChunk = 35;
    if (normA.length >= minChunk && normB.includes(normA.slice(0, minChunk))) return true;
    if (normB.length >= minChunk && normA.includes(normB.slice(0, minChunk))) return true;

    return false;
  }
}
