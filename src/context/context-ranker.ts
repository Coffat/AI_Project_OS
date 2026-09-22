import {
  RelevantFileItem,
  RelevantSymbolItem,
  RelevantDecisionItem,
  RelevantConstraintItem,
  RelevantTestItem,
  RelevantArchitectureItem,
} from '../core/types.js';

export interface ScoredCandidate<T> {
  item: T;
  score: number;
  priorityTier: number;
  reason: string;
}

export class ContextRanker {
  /**
   * Scores and ranks files according to task relationship.
   * Direct task modified files > 1-hop dependencies > 2-hop dependencies.
   */
  public rankFiles(
    files: Array<{
      path: string;
      isModified?: boolean;
      isDependency?: boolean;
      depth?: number;
      keywordMatch?: boolean;
      graphScore?: number;
    }>
  ): RelevantFileItem[] {
    const scored = files.map((f) => {
      let score = 0;
      const reasons: string[] = [];

      if (f.isModified) {
        score += 800;
        reasons.push('Directly modified by task (+800)');
      } else if (f.isDependency) {
        const depth = f.depth ?? 1;
        const depScore = Math.max(100, Math.round(600 / depth));
        score += depScore;
        reasons.push(`${depth}-hop dependency (+${depScore})`);
      } else {
        score += 300;
        reasons.push('Referenced file (+300)');
      }

      if (f.graphScore) {
        score += Math.round(f.graphScore * 0.5);
        reasons.push(`Graph centrality boost (+${Math.round(f.graphScore * 0.5)})`);
      }

      if (f.keywordMatch) {
        score += 150;
        reasons.push('Matches task keywords (+150)');
      }

      return {
        path: f.path,
        relevanceScore: score,
        reason: reasons.join('; '),
        isModified: Boolean(f.isModified),
        isDependency: Boolean(f.isDependency),
      };
    });

    // Sort descending by score
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    return scored;
  }

  /**
   * Scores and ranks code symbols.
   * Symbols in modified files > exported symbols > called/callee symbols.
   */
  public rankSymbols(
    symbols: Array<{
      name: string;
      kind: string;
      filePath: string;
      lineStart?: number;
      lineEnd?: number;
      signature?: string;
      docstring?: string;
      inModifiedFile?: boolean;
      keywordMatch?: boolean;
      isExported?: boolean;
    }>
  ): RelevantSymbolItem[] {
    const scored = symbols.map((s) => {
      let score = 250;
      if (s.inModifiedFile) score += 450;
      if (s.isExported) score += 100;
      if (s.keywordMatch) score += 150;

      return {
        name: s.name,
        kind: s.kind,
        filePath: s.filePath,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        signature: s.signature,
        docstring: s.docstring,
        relevanceScore: score,
      };
    });

    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return scored;
  }

  /**
   * Scores and ranks architectural decisions.
   * Directly linked in graph > matching task keywords > project-wide ADRs.
   */
  public rankDecisions(
    decisions: Array<{
      id: string;
      title: string;
      status: string;
      rationale?: string;
      summary?: string;
      isGraphLinked?: boolean;
      keywordMatch?: boolean;
    }>
  ): RelevantDecisionItem[] {
    const scored = decisions.map((d) => {
      let score = 500;
      if (d.isGraphLinked) score += 200;
      if (d.keywordMatch) score += 150;
      if (d.status.toLowerCase() === 'accepted') score += 50;

      return {
        id: d.id,
        title: d.title,
        status: d.status,
        summary: d.summary,
        rationale: d.rationale,
        relevanceScore: score,
      };
    });

    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return scored;
  }

  /**
   * Scores and ranks project constraints.
   * Directly linked in graph > matching task keywords > general constraints.
   */
  public rankConstraints(
    constraints: Array<{
      id: string;
      title: string;
      rule: string;
      category?: string;
      severity?: string;
      isGraphLinked?: boolean;
      keywordMatch?: boolean;
    }>
  ): RelevantConstraintItem[] {
    const scored = constraints.map((c) => {
      let score = 450;
      if (c.isGraphLinked) score += 200;
      if (c.keywordMatch) score += 150;
      if (c.severity?.toLowerCase() === 'blocking' || c.severity?.toLowerCase() === 'critical') score += 100;

      return {
        id: c.id,
        title: c.title,
        rule: c.rule,
        category: c.category,
        severity: c.severity,
        relevanceScore: score,
      };
    });

    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return scored;
  }

  /**
   * Scores and ranks relevant tests.
   * Tests directly testing modified files > tests testing dependencies > general tests.
   */
  public rankTests(
    tests: Array<{
      filePath: string;
      targetFile?: string;
      testNames?: string[];
      isDirectTest?: boolean;
      keywordMatch?: boolean;
    }>
  ): RelevantTestItem[] {
    const scored = tests.map((t) => {
      let score = 400;
      if (t.isDirectTest) score += 200;
      if (t.keywordMatch) score += 100;

      return {
        filePath: t.filePath,
        targetFile: t.targetFile,
        testNames: t.testNames,
        relevanceScore: score,
      };
    });

    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return scored;
  }

  /**
   * Scores and ranks architecture subsystems.
   */
  public rankArchitecture(
    archList: Array<{
      subsystem?: string;
      summary: string;
      rules?: string[];
      matchesFile?: boolean;
    }>
  ): RelevantArchitectureItem[] {
    const scored = archList.map((a) => {
      let score = 200;
      if (a.matchesFile) score += 150;

      return {
        subsystem: a.subsystem,
        summary: a.summary,
        rules: a.rules,
        relevanceScore: score,
      };
    });

    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    return scored;
  }
}
