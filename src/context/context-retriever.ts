import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Task, HandoffRecord } from '../core/types.js';
import { GraphService } from '../graph/graph-service.js';
import { CodeQueryService } from '../code-intelligence/code-query-service.js';
import { DecisionRepository } from '../database/repositories/decision.repository.js';
import { HandoffRepository } from '../database/repositories/handoff.repository.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';

import { ArchitectureGuard } from '../guard/architecture-guard.js';
import { PreImplementationContext } from '../guard/types.js';

export interface RawCandidateFile {
  path: string;
  isModified?: boolean;
  isDependency?: boolean;
  depth?: number;
  keywordMatch?: boolean;
  graphScore?: number;
  content?: string;
}

export interface RawCandidateSymbol {
  name: string;
  kind: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  signature?: string;
  docstring?: string;
  inModifiedFile?: boolean;
  keywordMatch?: boolean;
}

export interface RawCandidateDecision {
  id: string;
  title: string;
  status: string;
  rationale?: string;
  summary?: string;
  isGraphLinked?: boolean;
  keywordMatch?: boolean;
}

export interface RawCandidateConstraint {
  id: string;
  title: string;
  rule: string;
  category?: string;
  severity?: string;
  isGraphLinked?: boolean;
  keywordMatch?: boolean;
}

export interface RawCandidateTest {
  filePath: string;
  targetFile?: string;
  testNames?: string[];
  isDirectTest?: boolean;
  keywordMatch?: boolean;
}

export interface RawCandidateArchitecture {
  subsystem?: string;
  summary: string;
  rules?: string[];
  matchesFile?: boolean;
}

export interface RawContextCandidates {
  task: Task;
  files: RawCandidateFile[];
  symbols: RawCandidateSymbol[];
  decisions: RawCandidateDecision[];
  constraints: RawCandidateConstraint[];
  tests: RawCandidateTest[];
  architecture: RawCandidateArchitecture[];
  handoff?: HandoffRecord | null;
  generalInfo?: {
    projectName: string;
    projectDescription: string;
    rules: string[];
  };
  preImplementation?: PreImplementationContext;
}

export class ContextRetriever {
  private readonly db: DatabaseSync;
  private readonly decisionRepo: DecisionRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly graphRepo: GraphRepository;
  private readonly codeQueryService: CodeQueryService;

  constructor(
    db: DatabaseSync,
    private readonly graphService: GraphService,
    private readonly projectRoot: string = process.cwd()
  ) {
    this.db = db;
    this.decisionRepo = new DecisionRepository(db);
    this.handoffRepo = new HandoffRepository(db);
    this.graphRepo = new GraphRepository(db);
    this.codeQueryService = new CodeQueryService(db);
  }

  /**
   * Deterministically retrieves candidate context across Graph, FTS, AST, and Repositories.
   */
  public async retrieveCandidates(
    task: Task,
    options: { maxGraphDepth?: number; includeGeneralInfo?: boolean } = {}
  ): Promise<RawContextCandidates> {
    const projectId = task.projectId;
    const taskKeywords = this.extractKeywords(`${task.title} ${task.description ?? ''}`);

    // 1. Graph Retrieval: Unified 4-Graph Task Context
    let taskGraphContext = null;
    try {
      taskGraphContext = await this.graphService.findTaskContext(task.id, {
        maxDepth: options.maxGraphDepth ?? 2,
        projectId,
      });
    } catch {
      // Task might not have a graph node yet
    }

    // 2. Resolve Modified Files
    const fileCandidateMap = new Map<string, RawCandidateFile>();

    // From task metadata (e.g. affected files or handoff)
    if (taskGraphContext) {
      for (const mf of taskGraphContext.modifiedFiles) {
        fileCandidateMap.set(mf.path, {
          path: mf.path,
          isModified: true,
          graphScore: mf.score,
          content: this.readFileContentSafely(mf.path),
        });
      }
    }

    // From graph edges directly
    const directFileEdges = this.graphRepo.findEdgesBySource(task.id, 'modifies');
    for (const edge of directFileEdges) {
      const node = this.graphRepo.findNodeById(edge.targetNodeId);
      if (node?.path && !fileCandidateMap.has(node.path)) {
        fileCandidateMap.set(node.path, {
          path: node.path,
          isModified: true,
          content: this.readFileContentSafely(node.path),
        });
      }
    }

    // 3. Resolve Dependencies (1-hop & 2-hop) of modified files
    const modifiedFilePaths = Array.from(fileCandidateMap.keys());
    for (const filePath of modifiedFilePaths) {
      const deps = this.codeQueryService.findDependencies(filePath, projectId);
      for (const dep of deps) {
        if (dep.path && !fileCandidateMap.has(dep.path)) {
          fileCandidateMap.set(dep.path, {
            path: dep.path,
            isDependency: true,
            depth: 1,
            content: this.readFileContentSafely(dep.path),
          });
        }
      }
    }

    // 4. Resolve Symbols
    const symbolCandidateMap = new Map<string, RawCandidateSymbol>();

    // From taskGraphContext
    if (taskGraphContext) {
      for (const s of taskGraphContext.symbols) {
        const symPath = s.node.path ?? '';
        const key = `${symPath}:${s.name}`;
        const meta = s.node.metadataJson ? JSON.parse(s.node.metadataJson) : {};
        symbolCandidateMap.set(key, {
          name: s.name,
          kind: meta.kind ?? 'symbol',
          filePath: symPath,
          signature: meta.signature,
          docstring: meta.docstring,
          inModifiedFile: true,
        });
      }
    }

    // Symbols in modified files (via inspectFile and graph nodes)
    for (const filePath of modifiedFilePaths) {
      const inspection = this.codeQueryService.inspectFile(filePath, projectId);
      const fileSymbols = inspection?.symbols ?? [];
      for (const s of fileSymbols) {
        const key = `${s.filePath}:${s.symbolName}`;
        symbolCandidateMap.set(key, {
          name: s.symbolName,
          kind: s.kind,
          filePath: s.filePath,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          signature: s.signature,
          docstring: s.docstring,
          inModifiedFile: true,
        });
      }

      // Also check graph nodes under this file path
      const graphNodes = this.graphRepo.findNodesByPath(projectId, filePath);
      for (const gn of graphNodes) {
        if (gn.entityType === 'symbol' && gn.name) {
          const key = `${filePath}:${gn.name}`;
          if (!symbolCandidateMap.has(key)) {
            const meta = gn.metadataJson ? JSON.parse(gn.metadataJson) : {};
            symbolCandidateMap.set(key, {
              name: gn.name,
              kind: meta.kind ?? 'symbol',
              filePath,
              lineStart: gn.lineStart ?? undefined,
              lineEnd: gn.lineEnd ?? undefined,
              signature: meta.signature,
              docstring: meta.docstring,
              inModifiedFile: true,
            });
          }
        }
      }
    }


    // FTS Symbol search matching task keywords
    for (const kw of taskKeywords) {
      try {
        const ftsSymbols = this.graphRepo.searchSymbolsFTS(kw, 5);
        for (const s of ftsSymbols) {
          const key = `${s.fileId}:${s.name}`;
          if (!symbolCandidateMap.has(key)) {
            symbolCandidateMap.set(key, {
              name: s.name,
              kind: s.kind,
              filePath: s.fileId,
              signature: s.signature ?? undefined,
              docstring: s.docstring ?? undefined,
              keywordMatch: true,
            });
          }
        }
      } catch {
        // FTS syntax error fallback
      }
    }

    // 5. Resolve Decisions
    const decisionCandidateMap = new Map<string, RawCandidateDecision>();

    // From graph context
    if (taskGraphContext) {
      for (const d of taskGraphContext.decisions) {
        const entityId = d.node.entityId || d.node.id;
        const decRecord = this.decisionRepo.findById(entityId);
        decisionCandidateMap.set(entityId, {
          id: entityId,
          title: decRecord?.title ?? d.label,
          status: decRecord?.status ?? 'Accepted',
          rationale: decRecord?.decisionRationale,
          summary: decRecord?.context,
          isGraphLinked: true,
        });
      }
    }

    // From decisions repository (matching keywords or all active)
    const allDecisions = this.decisionRepo.listByProject(projectId);
    for (const dec of allDecisions) {
      const hasKeyword = taskKeywords.some(
        (kw) =>
          dec.title.toLowerCase().includes(kw) ||
          (dec.context && dec.context.toLowerCase().includes(kw))
      );
      if (!decisionCandidateMap.has(dec.id)) {
        decisionCandidateMap.set(dec.id, {
          id: dec.id,
          title: dec.title,
          status: dec.status,
          rationale: dec.decisionRationale,
          summary: dec.context,
          keywordMatch: hasKeyword,
        });
      }
    }

    // 6. Resolve Constraints
    const constraintCandidateMap = new Map<string, RawCandidateConstraint>();

    // From graph context
    if (taskGraphContext) {
      for (const c of taskGraphContext.constraints) {
        const entityId = c.node.entityId || c.node.id;
        constraintCandidateMap.set(entityId, {
          id: entityId,
          title: c.label,
          rule: c.node.metadataJson ? JSON.parse(c.node.metadataJson).rule ?? c.label : c.label,
          isGraphLinked: true,
          severity: 'blocking',
        });
      }
    }


    // From Canonical CONSTRAINTS.md
    const canonicalConstraints = this.readCanonicalConstraints();
    for (const cc of canonicalConstraints) {
      if (!constraintCandidateMap.has(cc.id)) {
        const hasKeyword = taskKeywords.some(
          (kw) => cc.title.toLowerCase().includes(kw) || cc.rule.toLowerCase().includes(kw)
        );
        constraintCandidateMap.set(cc.id, {
          ...cc,
          keywordMatch: hasKeyword,
        });
      }
    }

    // 7. Resolve Tests
    const testCandidateMap = new Map<string, RawCandidateTest>();

    for (const filePath of modifiedFilePaths) {
      const relatedTests = this.codeQueryService.findRelatedTests(filePath, projectId);
      for (const rt of relatedTests) {
        if (!testCandidateMap.has(rt.testFilePath)) {
          testCandidateMap.set(rt.testFilePath, {
            filePath: rt.testFilePath,
            targetFile: filePath,
            testNames: rt.testName ? [rt.testName] : undefined,
            isDirectTest: true,
          });
        }
      }
    }

    // Also check graph context tests
    if (taskGraphContext) {
      for (const t of taskGraphContext.tests) {
        if (!testCandidateMap.has(t.path)) {
          testCandidateMap.set(t.path, {
            filePath: t.path,
            isDirectTest: true,
          });
        }
      }
    }

    // 8. Resolve Handoff
    const latestHandoff = this.handoffRepo.findLatestByTaskId(task.id);

    // 9. Resolve Architecture
    const architectureCandidates = this.readCanonicalArchitecture(modifiedFilePaths);

    // 10. General Project Information
    let generalInfo: RawContextCandidates['generalInfo'] | undefined;
    if (options.includeGeneralInfo !== false) {
      generalInfo = this.readCanonicalProjectInfo();
    }

    // 8. Pre-Implementation Anti-Bloat Knowledge (Phase 16)
    let preImplementation: PreImplementationContext | undefined = undefined;
    try {
      const guard = new ArchitectureGuard(this.projectRoot, this.db);
      preImplementation = await guard.getPreImplementationContext(taskKeywords);
    } catch {
      // Fallback if guard evaluation throws
    }

    return {
      task,
      files: Array.from(fileCandidateMap.values()),
      symbols: Array.from(symbolCandidateMap.values()),
      decisions: Array.from(decisionCandidateMap.values()),
      constraints: Array.from(constraintCandidateMap.values()),
      tests: Array.from(testCandidateMap.values()),
      architecture: architectureCandidates,
      handoff: latestHandoff ?? null,
      generalInfo,
      preImplementation,
    };
  }

  // --- Private Helpers ---

  private extractKeywords(text: string): string[] {
    return Array.from(
      new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9_-]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 4)
      )
    );
  }

  private readFileContentSafely(relativePath: string): string | undefined {
    try {
      const fullPath = path.isAbsolute(relativePath)
        ? relativePath
        : path.join(this.projectRoot, relativePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        return fs.readFileSync(fullPath, 'utf8');
      }
    } catch {
      // Ignored
    }
    return undefined;
  }

  private readCanonicalConstraints(): RawCandidateConstraint[] {
    const filePath = path.join(this.projectRoot, '.ai', 'canonical', 'CONSTRAINTS.md');
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf8');
    const sections = content.split(/\n##? /);
    const results: RawCandidateConstraint[] = [];

    for (let i = 1; i < sections.length; i++) {
      const sec = sections[i];
      if (!sec) continue;
      const lines = sec.split('\n');
      const firstLine = lines[0];
      const title = firstLine ? firstLine.replace(/[*#]/g, '').trim() : '';
      const rule = lines.slice(1).join('\n').trim();
      if (title) {
        results.push({
          id: `CONSTRAINT-${String(i).padStart(3, '0')}`,
          title,
          rule: rule.slice(0, 300),
          severity: 'blocking',
        });
      }
    }
    return results;
  }

  private readCanonicalArchitecture(affectedFiles: string[]): RawCandidateArchitecture[] {
    const filePath = path.join(this.projectRoot, '.ai', 'canonical', 'ARCHITECTURE.md');
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf8');
    const results: RawCandidateArchitecture[] = [];

    // Parse subsystem sections
    const lines = content.split('\n');
    let currentSubsystem = '';
    const buffer: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## ') || line.startsWith('### ')) {
        if (currentSubsystem && buffer.length > 0) {
          const matches = affectedFiles.some((f) => f.includes(currentSubsystem.toLowerCase()));
          results.push({
            subsystem: currentSubsystem,
            summary: buffer.join('\n').trim(),
            matchesFile: matches,
          });
          buffer.length = 0;
        }
        currentSubsystem = line.replace(/^[#\s]+/, '').trim();
      } else if (currentSubsystem) {
        buffer.push(line);
      }
    }

    if (currentSubsystem && buffer.length > 0) {
      const matches = affectedFiles.some((f) => f.includes(currentSubsystem.toLowerCase()));
      results.push({
        subsystem: currentSubsystem,
        summary: buffer.join('\n').trim(),
        matchesFile: matches,
      });
    }

    return results;
  }

  private readCanonicalProjectInfo(): {
    projectName: string;
    projectDescription: string;
    rules: string[];
  } {
    const filePath = path.join(this.projectRoot, '.ai', 'canonical', 'PROJECT.md');
    let name = 'AI Project OS';
    let description = 'Project OS for autonomous AI coding agents';
    const rules: string[] = [];

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const nameMatch = content.match(/name:\s*(.+)/);
      const descMatch = content.match(/description:\s*(.+)/);
      if (nameMatch && nameMatch[1]) name = nameMatch[1].trim();
      if (descMatch && descMatch[1]) description = descMatch[1].trim();
    }

    return {
      projectName: name,
      projectDescription: description,
      rules,
    };
  }
}
