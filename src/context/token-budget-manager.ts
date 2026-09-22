import {
  ContextEntityReference,
  ContextExclusionReference,
  ContextReasoningMetadata,
  ContextLevel,
  ExcludedContextItem,
} from '../core/types.js';
import { ContextEstimator, CompressionMetrics } from './context-estimator.js';

export interface BudgetCandidate {
  id: string;
  type: ContextEntityReference['type'] | string;
  content: string;
  score: number;
  priorityTier: number; // 1 = highest, 9 = lowest
  level?: ContextLevel;
  mandatory?: boolean;
  reason?: string;
  filePath?: string;
  compressedContent?: string;
}

export interface PackingResult<T extends BudgetCandidate> {
  included: T[];
  excluded: Array<T & { dropReason: string }>;
  includedEntities: ContextEntityReference[];
  excludedEntities: ContextExclusionReference[];
  excludedContext: ExcludedContextItem[];
  totalTokens: number;
  tokenBudget: number;
  loadedLevels: ContextLevel[];
  compressionMetrics: CompressionMetrics;
  metadata: ContextReasoningMetadata;
}

export interface PackingOptions {
  allowCompression?: boolean;
  baseReserveTokens?: number;
  totalProjectTokens?: number;
  maxLevel?: ContextLevel;
  deduplicationSavingsTokens?: number;
}

export class TokenBudgetManager {
  private readonly estimator: ContextEstimator;

  constructor(estimator?: ContextEstimator) {
    this.estimator = estimator ?? new ContextEstimator();
  }

  /**
   * Fast, deterministic token estimation for code and markdown prose.
   */
  public estimateTokens(text: string | undefined | null): number {
    return this.estimator.estimateTokens(text);
  }

  /**
   * Packs candidate items into the specified token budget following strict hierarchical levels (L0-L4)
   * and priority tiers.
   *
   * CONTEXT LEVELS:
   * L0: task objective (Mandatory)
   * L1: current step, blockers, next action (Mandatory continuity)
   * L2: relevant files, symbols, decisions
   * L3: architecture, constraints, tests
   * L4: broader project knowledge
   *
   * Rule: Chỉ load level cao hơn khi cần (Higher levels only loaded if budget remains).
   */
  public packCandidates<T extends BudgetCandidate>(
    candidates: T[],
    budget = 8000,
    options: PackingOptions = {}
  ): PackingResult<T> {
    const included: T[] = [];
    const excluded: Array<T & { dropReason: string }> = [];
    const includedEntities: ContextEntityReference[] = [];
    const excludedEntities: ContextExclusionReference[] = [];
    const excludedContext: ExcludedContextItem[] = [];
    const loadedLevelsSet = new Set<ContextLevel>();

    const effectiveBudget = Math.max(500, budget);
    let usedTokens = options.baseReserveTokens ?? 0;

    // 1. Group candidates by Level (L0, L1, L2, L3, L4)
    const levelBuckets: Record<ContextLevel, T[]> = {
      L0: [],
      L1: [],
      L2: [],
      L3: [],
      L4: [],
    };

    for (const c of candidates) {
      const lvl = c.level ?? this.inferLevel(c.type, c.priorityTier);
      levelBuckets[lvl].push(c);
    }

    // Sort within each bucket by priorityTier ascending, then score descending
    const levels: ContextLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];
    for (const lvl of levels) {
      levelBuckets[lvl].sort((a, b) => {
        if (a.mandatory && !b.mandatory) return -1;
        if (!a.mandatory && b.mandatory) return 1;
        if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;
        return b.score - a.score;
      });
    }

    const maxLevelOrder = options.maxLevel ? levels.indexOf(options.maxLevel) : 4;
    let budgetExhaustedAtLevel: ContextLevel | null = null;

    // 2. Process Level by Level
    for (let i = 0; i < levels.length; i++) {
      const lvl = levels[i]!;
      const itemsInLevel = levelBuckets[lvl];

      // If user capped maximum level
      if (i > maxLevelOrder) {
        for (const item of itemsInLevel) {
          const tokens = this.estimateTokens(item.content);
          const dropReason = `Level ${lvl} excluded: caller restricted maximum context level to ${options.maxLevel}`;
          this.recordExclusion(item, tokens, lvl, dropReason, excluded, excludedEntities, excludedContext);
        }
        continue;
      }

      // If budget was already exhausted in an earlier level, skip higher levels completely
      if (budgetExhaustedAtLevel !== null) {
        for (const item of itemsInLevel) {
          const tokens = this.estimateTokens(item.content);
          const dropReason = `Exceeded token budget limit: level ${lvl} omitted (limit reached at level ${budgetExhaustedAtLevel})`;
          this.recordExclusion(item, tokens, lvl, dropReason, excluded, excludedEntities, excludedContext);
        }
        continue;
      }

      // Pack items in current level
      for (const item of itemsInLevel) {
        let content = item.content;
        let tokens = this.estimateTokens(content);

        // L0 and L1 are mandatory (never dropped)
        const isMandatory = item.mandatory || lvl === 'L0' || lvl === 'L1';

        if (isMandatory) {
          usedTokens += tokens;
          included.push(item);
          loadedLevelsSet.add(lvl);
          includedEntities.push({
            id: item.id,
            type: item.type as ContextEntityReference['type'],
            tokens,
            score: item.score,
            reason: item.reason ?? `Mandatory ${lvl} context`,
          });
          continue;
        }

        // Optional candidate: try compression if over budget
        if (
          usedTokens + tokens > effectiveBudget &&
          options.allowCompression &&
          item.compressedContent
        ) {
          const compressedTokens = this.estimateTokens(item.compressedContent);
          if (usedTokens + compressedTokens <= effectiveBudget) {
            content = item.compressedContent;
            tokens = compressedTokens;
          }
        }

        if (usedTokens + tokens <= effectiveBudget) {
          usedTokens += tokens;
          included.push({
            ...item,
            content,
          });
          loadedLevelsSet.add(lvl);
          includedEntities.push({
            id: item.id,
            type: item.type as ContextEntityReference['type'],
            tokens,
            score: item.score,
            reason: item.reason,
          });
        } else {
          // Budget reached for optional items
          const dropReason = `Exceeded token budget limit (${usedTokens}/${effectiveBudget} tokens used, item required ${tokens} tokens)`;
          this.recordExclusion(item, tokens, lvl, dropReason, excluded, excludedEntities, excludedContext);

          // Mark budget exhausted at this level so we don't load higher levels
          if (!budgetExhaustedAtLevel) {
            budgetExhaustedAtLevel = lvl;
          }
        }
      }
    }

    const loadedLevels = Array.from(loadedLevelsSet);
    const totalProjectTokens = options.totalProjectTokens ?? Math.max(50000, usedTokens * 10);
    const compressionMetrics = this.estimator.calculateCompressionMetrics(totalProjectTokens, usedTokens);

    const utilization = Math.min(100, Math.round((usedTokens / effectiveBudget) * 100));

    const metadata: ContextReasoningMetadata = {
      tokenBudget: effectiveBudget,
      totalCandidates: candidates.length,
      includedCount: included.length,
      excludedCount: excluded.length,
      budgetUtilizationPercent: utilization,
      rankingStrategy:
        'L0 (task) > L1 (current step/blockers) > L2 (graph locality files/symbols/decisions) > L3 (arch/constraints/tests) > L4 (broader project)',
      compressionApplied: Boolean(options.allowCompression),
      totalProjectEstimatedTokens: compressionMetrics.totalProjectTokens,
      selectedContextTokens: compressionMetrics.selectedContextTokens,
      compressionRatio: compressionMetrics.compressionRatio,
      compressionPercentage: compressionMetrics.compressionPercentage,
      compressionFactor: compressionMetrics.compressionFactor,
      loadedLevels,
      deduplicationSavingsTokens: options.deduplicationSavingsTokens,
    };

    return {
      included,
      excluded,
      includedEntities,
      excludedEntities,
      excludedContext,
      totalTokens: usedTokens,
      tokenBudget: effectiveBudget,
      loadedLevels,
      compressionMetrics,
      metadata,
    };
  }

  private inferLevel(type: string, priorityTier: number): ContextLevel {
    if (type === 'task' || priorityTier === 1) return 'L0';
    if (type === 'handoff' || type === 'current_state' || priorityTier === 2) return 'L1';
    if (type === 'file' || type === 'symbol' || type === 'decision' || priorityTier <= 5) return 'L2';
    if (type === 'architecture' || type === 'constraint' || type === 'test' || priorityTier <= 8) return 'L3';
    return 'L4';
  }

  private recordExclusion<T extends BudgetCandidate>(
    item: T,
    tokens: number,
    level: ContextLevel,
    dropReason: string,
    excluded: Array<T & { dropReason: string }>,
    excludedEntities: ContextExclusionReference[],
    excludedContext: ExcludedContextItem[]
  ): void {
    excluded.push({
      ...item,
      dropReason,
    });
    excludedEntities.push({
      id: item.id,
      type: item.type as ContextEntityReference['type'],
      tokens,
      score: item.score,
      reason: item.reason,
      dropReason,
    });
    excludedContext.push({
      id: item.id,
      type: String(item.type),
      level,
      reason: dropReason,
      tokens,
    });
  }
}
