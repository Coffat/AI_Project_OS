import { ContextLevel, Task } from '../core/types.js';

export interface PrioritizerItemInput {
  id: string;
  type: string;
  content: string;
  level?: ContextLevel;
  mandatory?: boolean;
  reason?: string;
  filePath?: string;
  isModified?: boolean;
  isDependency?: boolean;
  graphHopDistance?: number; // 0 = direct/modifies, 1 = 1-hop, 2 = 2-hop
  graphScore?: number;
  keywordMatch?: boolean;
  status?: string;
  compressedContent?: string;
}

export interface PrioritizedCandidate {
  id: string;
  type: string;
  level: ContextLevel;
  content: string;
  score: number;
  priorityTier: number; // 1 (highest) to 9 (lowest)
  mandatory?: boolean;
  reason?: string;
  filePath?: string;
  compressedContent?: string;
  scoreBreakdown: {
    baseLevelScore: number;
    graphLocalityScore: number;
    keywordBoost: number;
    statusBoost: number;
  };
}

export type SemanticRankingFallbackFn = (
  candidates: PrioritizedCandidate[],
  task: Task
) => Promise<PrioritizedCandidate[]>;

export interface PrioritizerOptions {
  maxLevel?: ContextLevel;
  semanticRankingFallback?: SemanticRankingFallbackFn;
  enableSemanticFallback?: boolean;
}

export class ContextPrioritizer {
  private static readonly LEVEL_ORDER: Record<ContextLevel, number> = {
    L0: 0,
    L1: 1,
    L2: 2,
    L3: 3,
    L4: 4,
  };

  /**
   * Automatically resolves the canonical ContextLevel (L0-L4) for an item based on its entity type.
   * L0: task objective
   * L1: current step, blockers, next action, handoff
   * L2: relevant files, symbols, decisions
   * L3: architecture, constraints, tests
   * L4: broader project knowledge
   */
  public resolveLevel(type: string): ContextLevel {
    switch (type.toLowerCase()) {
      case 'task':
      case 'objective':
        return 'L0';

      case 'current_state':
      case 'step':
      case 'blocker':
      case 'handoff':
      case 'next_action':
        return 'L1';

      case 'file':
      case 'symbol':
      case 'decision':
        return 'L2';

      case 'architecture':
      case 'constraint':
      case 'test':
        return 'L3';

      case 'general':
      case 'project_info':
      case 'overview':
      default:
        return 'L4';
    }
  }

  /**
   * Deterministically scores and ranks candidates using graph locality, level hierarchy, and keyword matching.
   * Optional LLM semantic fallback is only invoked if enabled.
   */
  public async prioritize(
    candidates: PrioritizerItemInput[],
    task?: Task,
    options: PrioritizerOptions = {}
  ): Promise<PrioritizedCandidate[]> {
    // 1. Assign levels and deterministic scores
    const prioritized: PrioritizedCandidate[] = candidates.map((c) => {
      const level = c.level ?? this.resolveLevel(c.type);
      const { score, priorityTier, scoreBreakdown } = this.calculateDeterministicScore(c, level);

      return {
        id: c.id,
        type: c.type,
        level,
        content: c.content,
        score,
        priorityTier,
        mandatory: c.mandatory ?? level === 'L0',
        reason: c.reason ?? `Context level ${level} (${c.type})`,
        filePath: c.filePath,
        compressedContent: c.compressedContent,
        scoreBreakdown,
      };
    });

    // 2. Filter by max level if specified
    const maxLevel = options.maxLevel;
    let filtered = prioritized;
    if (maxLevel) {
      const maxOrder = ContextPrioritizer.LEVEL_ORDER[maxLevel];
      filtered = prioritized.filter((c) => ContextPrioritizer.LEVEL_ORDER[c.level] <= maxOrder);
    }

    // 3. Deterministic sorting:
    // Primary: Level order (L0 -> L1 -> L2 -> L3 -> L4)
    // Secondary: Score descending
    filtered.sort((a, b) => {
      const levelDiff = ContextPrioritizer.LEVEL_ORDER[a.level] - ContextPrioritizer.LEVEL_ORDER[b.level];
      if (levelDiff !== 0) {
        return levelDiff;
      }
      return b.score - a.score;
    });

    // 4. Optional LLM semantic ranking fallback (strictly fallback, never default)
    if (options.enableSemanticFallback && options.semanticRankingFallback && task) {
      try {
        return await options.semanticRankingFallback(filtered, task);
      } catch {
        // Fallback gracefully to deterministic sort on failure
        return filtered;
      }
    }

    return filtered;
  }

  /**
   * Deterministic scoring formula:
   * Level Base + Graph Locality Boost + Keyword Match Boost + Status Boost
   */
  private calculateDeterministicScore(
    item: PrioritizerItemInput,
    level: ContextLevel
  ): { score: number; priorityTier: number; scoreBreakdown: PrioritizedCandidate['scoreBreakdown'] } {
    let baseScore = 0;
    let priorityTier = 5;

    switch (level) {
      case 'L0':
        baseScore = 1000;
        priorityTier = 1;
        break;
      case 'L1':
        baseScore = 900;
        priorityTier = 2;
        break;
      case 'L2':
        baseScore = 700;
        priorityTier = item.type === 'file' ? 3 : item.type === 'decision' ? 4 : 5;
        break;
      case 'L3':
        baseScore = 400;
        priorityTier = item.type === 'constraint' ? 6 : item.type === 'test' ? 7 : 8;
        break;
      case 'L4':
        baseScore = 100;
        priorityTier = 9;
        break;
    }

    // Graph locality scoring:
    // Distance from task node: 0-hop (modified by task) > 1-hop (direct import/calls) > 2-hop
    let graphLocalityScore = 0;
    if (item.isModified || item.graphHopDistance === 0) {
      graphLocalityScore += 800;
    } else if (item.graphHopDistance === 1 || item.isDependency) {
      graphLocalityScore += 500;
    } else if (item.graphHopDistance === 2) {
      graphLocalityScore += 250;
    }

    if (item.graphScore) {
      graphLocalityScore += Math.round(item.graphScore * 0.5);
    }

    // Keyword relevance boost
    let keywordBoost = 0;
    if (item.keywordMatch) {
      keywordBoost = 150;
    }

    // Status / recency boost
    let statusBoost = 0;
    if (item.status === 'Accepted' || item.status === 'active') {
      statusBoost = 100;
    }

    const totalScore = baseScore + graphLocalityScore + keywordBoost + statusBoost;

    return {
      score: totalScore,
      priorityTier,
      scoreBreakdown: {
        baseLevelScore: baseScore,
        graphLocalityScore,
        keywordBoost,
        statusBoost,
      },
    };
  }
}
