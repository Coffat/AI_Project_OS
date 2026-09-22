import { randomUUID } from 'node:crypto';
import {
  MemoryEvent,
  MemoryLayer,
  MemoryDiffResult,
  GitChangedFiles,
  SymbolEntity,
  GraphEdge,
  DecisionRecord,
  ConstraintRecord,
  Task,
} from '../core/types.js';

export interface PreviousStateSnapshot {
  files: Map<string, { contentHash: string; sizeBytes: number }>;
  symbols: Map<string, SymbolEntity[]>; // key: filePath
  edges: Map<string, GraphEdge[]>; // key: filePath or sourceNodeId
  decisions: Map<string, DecisionRecord>;
  constraints: Map<string, ConstraintRecord>;
}

export interface CurrentStateSnapshot {
  files: Map<string, { contentHash: string; sizeBytes: number }>;
  symbols: Map<string, SymbolEntity[]>;
  edges: Map<string, GraphEdge[]>;
  decisions: Map<string, DecisionRecord>;
  constraints: Map<string, ConstraintRecord>;
}

export class MemoryDiff {
  /**
   * Computes granular memory events by comparing changed files, AST symbols, and graph relationships.
   */
  public computeDiff(params: {
    projectId: string;
    changedFiles: GitChangedFiles;
    previousSymbols?: Map<string, SymbolEntity[]>;
    currentSymbols?: Map<string, SymbolEntity[]>;
    previousEdges?: Map<string, GraphEdge[]>;
    currentEdges?: Map<string, GraphEdge[]>;
    decisions?: { previous?: DecisionRecord[]; current?: DecisionRecord[] };
    constraints?: { previous?: ConstraintRecord[]; current?: ConstraintRecord[] };
    completedTask?: Task;
  }): MemoryDiffResult {
    const events: MemoryEvent[] = [];
    const affectedFiles = new Set<string>();
    const affectedSymbols = new Set<string>();
    const affectedLayers = new Set<MemoryLayer>();
    const semanticReasons: string[] = [];

    const now = Date.now();

    // 1. File Level Diff
    for (const file of params.changedFiles.added) {
      affectedFiles.add(file);
      affectedLayers.add('architecture');
      events.push({
        eventId: randomUUID(),
        type: 'FILE_ADDED',
        timestamp: now,
        source: 'git_diff',
        entity: `file:${file}`,
        before: null,
        after: { path: file, status: 'added' },
      });
    }

    for (const file of params.changedFiles.modified) {
      affectedFiles.add(file);
      affectedLayers.add('architecture');
      events.push({
        eventId: randomUUID(),
        type: 'FILE_MODIFIED',
        timestamp: now,
        source: 'git_diff',
        entity: `file:${file}`,
        before: { path: file, status: 'existing' },
        after: { path: file, status: 'modified' },
      });
    }

    for (const file of params.changedFiles.deleted) {
      affectedFiles.add(file);
      affectedLayers.add('architecture');
      events.push({
        eventId: randomUUID(),
        type: 'FILE_DELETED',
        timestamp: now,
        source: 'git_diff',
        entity: `file:${file}`,
        before: { path: file, status: 'existing' },
        after: null,
      });
    }

    for (const rename of params.changedFiles.renamed) {
      affectedFiles.add(rename.to);
      affectedFiles.add(rename.from);
      affectedLayers.add('architecture');
      events.push({
        eventId: randomUUID(),
        type: 'FILE_RENAMED',
        timestamp: now,
        source: 'git_diff',
        entity: `file:${rename.to}`,
        before: { path: rename.from },
        after: { path: rename.to },
      });
    }

    // 2. Symbol Level Diff (AST Diff)
    if (params.previousSymbols || params.currentSymbols) {
      const prevMap = params.previousSymbols ?? new Map<string, SymbolEntity[]>();
      const currMap = params.currentSymbols ?? new Map<string, SymbolEntity[]>();

      const allFileKeys = new Set([...prevMap.keys(), ...currMap.keys()]);

      for (const filePath of allFileKeys) {
        const prevSyms = prevMap.get(filePath) ?? [];
        const currSyms = currMap.get(filePath) ?? [];

        const prevByName = new Map<string, SymbolEntity>(prevSyms.map((s) => [s.name, s]));
        const currByName = new Map<string, SymbolEntity>(currSyms.map((s) => [s.name, s]));

        // Check added symbols
        for (const [name, sym] of currByName) {
          if (!prevByName.has(name)) {
            affectedSymbols.add(name);
            affectedLayers.add('architecture');
            events.push({
              eventId: randomUUID(),
              type: 'SYMBOL_ADDED',
              timestamp: now,
              source: 'ast_analyzer',
              entity: `symbol:${filePath}:${name}`,
              before: null,
              after: { name: sym.name, kind: sym.kind, signature: sym.signature, docstring: sym.docstring },
            });

            // Heuristic check for business rules or policy extraction
            if (this.isSemanticExtractionCandidate(sym)) {
              semanticReasons.push(`New high-level symbol '${name}' in '${filePath}' may introduce new business policy or architecture constraints`);
            }
          }
        }

        // Check removed symbols
        for (const [name, sym] of prevByName) {
          if (!currByName.has(name)) {
            affectedSymbols.add(name);
            affectedLayers.add('architecture');
            events.push({
              eventId: randomUUID(),
              type: 'SYMBOL_REMOVED',
              timestamp: now,
              source: 'ast_analyzer',
              entity: `symbol:${filePath}:${name}`,
              before: { name: sym.name, kind: sym.kind },
              after: null,
            });
          }
        }

        // Check modified symbols
        for (const [name, currSym] of currByName) {
          const prevSym = prevByName.get(name);
          if (prevSym) {
            const sigChanged = prevSym.signature !== currSym.signature;
            const docChanged = prevSym.docstring !== currSym.docstring;
            if (sigChanged || docChanged) {
              affectedSymbols.add(name);
              affectedLayers.add('architecture');
              events.push({
                eventId: randomUUID(),
                type: 'SYMBOL_MODIFIED',
                timestamp: now,
                source: 'ast_analyzer',
                entity: `symbol:${filePath}:${name}`,
                before: { signature: prevSym.signature, docstring: prevSym.docstring },
                after: { signature: currSym.signature, docstring: currSym.docstring },
              });
            }
          }
        }
      }
    }

    // 3. Graph Dependency Diff
    if (params.previousEdges || params.currentEdges) {
      const prevEdges = params.previousEdges ?? new Map<string, GraphEdge[]>();
      const currEdges = params.currentEdges ?? new Map<string, GraphEdge[]>();

      const allKeys = new Set([...prevEdges.keys(), ...currEdges.keys()]);
      for (const k of allKeys) {
        const prev = prevEdges.get(k) ?? [];
        const curr = currEdges.get(k) ?? [];

        const prevSig = new Set(prev.map((e) => `${e.sourceNodeId}->${e.relationType}->${e.targetNodeId}`));
        const currSig = new Set(curr.map((e) => `${e.sourceNodeId}->${e.relationType}->${e.targetNodeId}`));

        let changed = false;
        if (prevSig.size !== currSig.size) {
          changed = true;
        } else {
          for (const s of currSig) {
            if (!prevSig.has(s)) {
              changed = true;
              break;
            }
          }
        }

        if (changed) {
          affectedLayers.add('architecture');
          events.push({
            eventId: randomUUID(),
            type: 'DEPENDENCY_CHANGED',
            timestamp: now,
            source: 'graph_diff',
            entity: `dependencies:${k}`,
            before: { edgeCount: prev.length },
            after: { edgeCount: curr.length },
          });
        }
      }
    }

    // 4. Decision Diff
    if (params.decisions) {
      const prev = new Map((params.decisions.previous ?? []).map((d) => [d.id, d]));
      const curr = new Map((params.decisions.current ?? []).map((d) => [d.id, d]));

      for (const [id, decision] of curr) {
        if (!prev.has(id)) {
          affectedLayers.add('decision');
          affectedLayers.add('architecture');
          events.push({
            eventId: randomUUID(),
            type: 'DECISION_CREATED',
            timestamp: now,
            source: 'decision_engine',
            entity: `decision:${decision.id}`,
            before: null,
            after: { title: decision.title, status: decision.status, context: decision.context },
          });
        } else {
          const old = prev.get(id)!;
          if (old.status !== decision.status || old.title !== decision.title) {
            affectedLayers.add('decision');
            events.push({
              eventId: randomUUID(),
              type: 'DECISION_UPDATED',
              timestamp: now,
              source: 'decision_engine',
              entity: `decision:${decision.id}`,
              before: { title: old.title, status: old.status },
              after: { title: decision.title, status: decision.status },
            });
          }
        }
      }
    }

    // 5. Constraint Diff
    if (params.constraints) {
      const prev = new Map((params.constraints.previous ?? []).map((c) => [c.id, c]));
      const curr = new Map((params.constraints.current ?? []).map((c) => [c.id, c]));

      for (const [id, constraint] of curr) {
        if (!prev.has(id)) {
          affectedLayers.add('constraint');
          events.push({
            eventId: randomUUID(),
            type: 'CONSTRAINT_CHANGED',
            timestamp: now,
            source: 'constraint_engine',
            entity: `constraint:${constraint.id}`,
            before: null,
            after: { title: constraint.title, category: constraint.category, ruleContent: constraint.ruleContent },
          });
        } else {
          const old = prev.get(id)!;
          if (old.ruleContent !== constraint.ruleContent || old.enforcementLevel !== constraint.enforcementLevel) {
            affectedLayers.add('constraint');
            events.push({
              eventId: randomUUID(),
              type: 'CONSTRAINT_CHANGED',
              timestamp: now,
              source: 'constraint_engine',
              entity: `constraint:${constraint.id}`,
              before: { ruleContent: old.ruleContent, enforcement: old.enforcementLevel },
              after: { ruleContent: constraint.ruleContent, enforcement: constraint.enforcementLevel },
            });
          }
        }
      }
    }

    // 6. Task Completion Diff
    if (params.completedTask) {
      affectedLayers.add('task');
      events.push({
        eventId: randomUUID(),
        type: 'TASK_COMPLETED',
        timestamp: now,
        source: 'task_engine',
        entity: `task:${params.completedTask.id}`,
        before: { status: 'in_progress' },
        after: { status: 'completed', title: params.completedTask.title, goal: params.completedTask.goal },
      });
    }

    return {
      events,
      affectedFiles: Array.from(affectedFiles),
      affectedSymbols: Array.from(affectedSymbols),
      affectedLayers: Array.from(affectedLayers),
      semanticExtractionRequired: semanticReasons.length > 0,
      semanticReasons,
    };
  }

  private isSemanticExtractionCandidate(sym: SymbolEntity): boolean {
    const text = `${sym.name} ${sym.docstring ?? ''}`.toLowerCase();
    const keywords = ['business rule', 'security policy', 'compliance requirement', 'governance rule', 'financial transaction', 'access control constraint'];
    return keywords.some((kw) => text.includes(kw));
  }
}
