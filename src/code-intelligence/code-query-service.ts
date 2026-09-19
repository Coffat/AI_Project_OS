import { DatabaseSync } from 'node:sqlite';
import { GraphRepository } from '../database/repositories/graph.repository.js';

export interface SymbolLocationResult {
  symbolName: string;
  kind: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  signature?: string;
  docstring?: string;
}

export interface ImporterResult {
  importingFilePath: string;
  targetModuleOrPath: string;
  specifiers?: Array<{ name: string; alias?: string }>;
}

export interface DependencyResult {
  name: string;
  type: string;
  path?: string;
  relation: string;
}

export interface RelatedTestResult {
  testFilePath: string;
  testName?: string;
  targetSymbolOrFile: string;
}

export interface SymbolInspectionResult {
  symbol: SymbolLocationResult;
  callers: Array<{ name: string; path?: string }>;
  callees: Array<{ name: string; path?: string }>;
  implementsInterfaces: string[];
  relatedTests: RelatedTestResult[];
}

export interface FileInspectionResult {
  filePath: string;
  sizeBytes: number;
  language?: string;
  symbols: SymbolLocationResult[];
  exports: string[];
  imports: string[];
  dependents: string[];
  relatedTests: RelatedTestResult[];
}

export class CodeQueryService {
  private readonly graphRepo: GraphRepository;

  constructor(private readonly db: DatabaseSync) {
    this.graphRepo = new GraphRepository(db);
  }

  /**
   * "Function X nằm ở đâu?"
   * Finds the exact location (file, start line, end line) of a function, method, or symbol.
   */
  public findSymbolLocation(symbolName: string, projectId: string): SymbolLocationResult[] {
    const symbols = this.graphRepo.findNodesByName(projectId, symbolName);
    const results: SymbolLocationResult[] = [];

    for (const node of symbols) {
      if (node.entityType === 'symbol' && node.path) {
        const meta = node.metadataJson ? JSON.parse(node.metadataJson) : {};
        results.push({
          symbolName: node.name ?? node.label,
          kind: meta.kind ?? 'symbol',
          filePath: node.path,
          lineStart: node.lineStart ?? 1,
          lineEnd: node.lineEnd ?? 1,
          signature: meta.signature,
          docstring: meta.docstring,
        });
      }
    }

    if (results.length === 0) {
      // Fallback query to symbols table directly
      const stmt = this.db.prepare(`
        SELECT s.*, f.path as file_path FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE s.project_id = ? AND (s.name = ? OR s.name LIKE ?)
      `);
      const rows = stmt.all(projectId, symbolName, `%${symbolName}`) as Record<string, unknown>[];
      for (const r of rows) {
        results.push({
          symbolName: String(r['name']),
          kind: String(r['kind']),
          filePath: String(r['file_path']),
          lineStart: Number(r['line_start']),
          lineEnd: Number(r['line_end']),
          signature: r['signature'] ? String(r['signature']) : undefined,
          docstring: r['docstring'] ? String(r['docstring']) : undefined,
        });
      }
    }

    return results;
  }

  /**
   * "File nào import module Y?"
   * Finds all files that import a given module name or file path.
   */
  public findModuleImporters(targetModuleOrPath: string, projectId: string): ImporterResult[] {
    const results: ImporterResult[] = [];

    // 1. Find target node (file or module)
    const candidates = [
      ...this.graphRepo.findNodesByPath(projectId, targetModuleOrPath),
      ...this.graphRepo.findNodesByName(projectId, targetModuleOrPath),
    ];

    const targetNodeIds = new Set<string>();
    for (const c of candidates) {
      targetNodeIds.add(c.id);
    }

    // Also check if module exists as entity_id
    const modNode = this.graphRepo.findNodeByEntity(projectId, 'module', targetModuleOrPath);
    if (modNode) targetNodeIds.add(modNode.id);

    // 2. Look for incoming import edges
    for (const targetId of targetNodeIds) {
      const incomingEdges = this.graphRepo.findEdgesByTarget(targetId, 'imports');
      for (const edge of incomingEdges) {
        const sourceNode = this.graphRepo.findNodeById(edge.sourceNodeId);
        if (sourceNode && sourceNode.path) {
          const meta = edge.metadataJson ? JSON.parse(edge.metadataJson) : {};
          results.push({
            importingFilePath: sourceNode.path,
            targetModuleOrPath,
            specifiers: meta.specifiers,
          });
        }
      }
    }

    // De-duplicate by importingFilePath
    const uniqueMap = new Map<string, ImporterResult>();
    for (const res of results) {
      uniqueMap.set(res.importingFilePath, res);
    }

    return Array.from(uniqueMap.values());
  }

  /**
   * "Những module nào phụ thuộc X?" (Dependents: entities that depend on target)
   */
  public findDependents(targetPathOrModule: string, projectId: string): DependencyResult[] {
    const results: DependencyResult[] = [];
    const targetNodes = [
      ...this.graphRepo.findNodesByPath(projectId, targetPathOrModule),
      ...this.graphRepo.findNodesByName(projectId, targetPathOrModule),
    ];

    const seenIds = new Set<string>();

    for (const tn of targetNodes) {
      // Find incoming 'depends_on' or 'imports' edges
      const inEdges = [
        ...this.graphRepo.findEdgesByTarget(tn.id, 'depends_on'),
        ...this.graphRepo.findEdgesByTarget(tn.id, 'imports'),
      ];

      for (const edge of inEdges) {
        if (seenIds.has(edge.sourceNodeId)) continue;
        seenIds.add(edge.sourceNodeId);

        const sourceNode = this.graphRepo.findNodeById(edge.sourceNodeId);
        if (sourceNode) {
          results.push({
            name: sourceNode.name ?? sourceNode.label,
            type: sourceNode.entityType,
            path: sourceNode.path,
            relation: edge.relationType,
          });
        }
      }
    }

    return results;
  }

  /**
   * Finds dependencies of a given file or module (Outgoing depends_on/imports).
   */
  public findDependencies(targetPathOrModule: string, projectId: string): DependencyResult[] {
    const results: DependencyResult[] = [];
    const targetNodes = [
      ...this.graphRepo.findNodesByPath(projectId, targetPathOrModule),
      ...this.graphRepo.findNodesByName(projectId, targetPathOrModule),
    ];

    const seenIds = new Set<string>();

    for (const tn of targetNodes) {
      const outEdges = [
        ...this.graphRepo.findEdgesBySource(tn.id, 'depends_on'),
        ...this.graphRepo.findEdgesBySource(tn.id, 'imports'),
      ];

      for (const edge of outEdges) {
        if (seenIds.has(edge.targetNodeId)) continue;
        seenIds.add(edge.targetNodeId);

        const targetNode = this.graphRepo.findNodeById(edge.targetNodeId);
        if (targetNode) {
          results.push({
            name: targetNode.name ?? targetNode.label,
            type: targetNode.entityType,
            path: targetNode.path,
            relation: edge.relationType,
          });
        }
      }
    }

    return results;
  }

  /**
   * "Test nào liên quan đến function X?"
   * Finds tests that directly or transitively test a given function or file.
   */
  public findRelatedTests(symbolOrFilePath: string, projectId: string): RelatedTestResult[] {
    const results: RelatedTestResult[] = [];
    const targetNodes = [
      ...this.graphRepo.findNodesByName(projectId, symbolOrFilePath),
      ...this.graphRepo.findNodesByPath(projectId, symbolOrFilePath),
    ];

    const seenTests = new Set<string>();

    for (const tn of targetNodes) {
      // 1. Direct 'tests' edges to this node
      const testEdges = this.graphRepo.findEdgesByTarget(tn.id, 'tests');
      for (const edge of testEdges) {
        const sourceNode = this.graphRepo.findNodeById(edge.sourceNodeId);
        if (sourceNode && sourceNode.path) {
          const meta = edge.metadataJson ? JSON.parse(edge.metadataJson) : {};
          const key = `${sourceNode.path}:${meta.testName ?? ''}`;
          if (!seenTests.has(key)) {
            seenTests.add(key);
            results.push({
              testFilePath: sourceNode.path,
              testName: meta.testName,
              targetSymbolOrFile: tn.name ?? tn.label,
            });
          }
        }
      }

      // 2. If tn is a symbol inside a file, also check tests targeting the enclosing file
      if (tn.entityType === 'symbol' && tn.path) {
        const fileNodes = this.graphRepo.findNodesByPath(projectId, tn.path);
        for (const fn of fileNodes) {
          if (fn.entityType === 'file') {
            const fileTestEdges = this.graphRepo.findEdgesByTarget(fn.id, 'tests');
            for (const fe of fileTestEdges) {
              const testSource = this.graphRepo.findNodeById(fe.sourceNodeId);
              if (testSource && testSource.path) {
                const key = `${testSource.path}:(file-level test)`;
                if (!seenTests.has(key)) {
                  seenTests.add(key);
                  results.push({
                    testFilePath: testSource.path,
                    testName: '(file-level test)',
                    targetSymbolOrFile: tn.name ?? tn.label,
                  });
                }
              }
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Inspect symbol: comprehensive view of symbol definition, callers, callees, implements, and tests.
   */
  public inspectSymbol(symbolName: string, projectId: string): SymbolInspectionResult | null {
    const locations = this.findSymbolLocation(symbolName, projectId);
    const primary = locations[0];
    if (!primary) return null;

    const symNodes = this.graphRepo.findNodesByName(projectId, symbolName);
    const symNode = symNodes.find((n) => n.entityType === 'symbol');

    const callers: Array<{ name: string; path?: string }> = [];
    const callees: Array<{ name: string; path?: string }> = [];
    const implementsInterfaces: string[] = [];

    if (symNode) {
      // Callers (incoming 'calls' edges)
      const callInEdges = this.graphRepo.findEdgesByTarget(symNode.id, 'calls');
      for (const e of callInEdges) {
        const src = this.graphRepo.findNodeById(e.sourceNodeId);
        if (src) {
          callers.push({ name: src.name ?? src.label, path: src.path });
        }
      }

      // Callees (outgoing 'calls' edges)
      const callOutEdges = this.graphRepo.findEdgesBySource(symNode.id, 'calls');
      for (const e of callOutEdges) {
        const tgt = this.graphRepo.findNodeById(e.targetNodeId);
        if (tgt) {
          callees.push({ name: tgt.name ?? tgt.label, path: tgt.path });
        }
      }

      // Implements (outgoing 'implements' edges)
      const implEdges = this.graphRepo.findEdgesBySource(symNode.id, 'implements');
      for (const e of implEdges) {
        const tgt = this.graphRepo.findNodeById(e.targetNodeId);
        if (tgt) {
          implementsInterfaces.push(tgt.name ?? tgt.label);
        }
      }
    }

    const relatedTests = this.findRelatedTests(symbolName, projectId);

    return {
      symbol: primary,
      callers,
      callees,
      implementsInterfaces,
      relatedTests,
    };
  }

  /**
   * Inspect file: comprehensive view of file symbols, exports, imports, dependents, and tests.
   */
  public inspectFile(filePath: string, projectId: string): FileInspectionResult | null {
    const file = this.graphRepo.findFileByPath(projectId, filePath);
    if (!file) return null;

    const fileNodes = this.graphRepo.findNodesByPath(projectId, filePath);
    const fileNode = fileNodes.find((n) => n.entityType === 'file');

    const symbols: SymbolLocationResult[] = [];
    const exports: string[] = [];
    const imports: string[] = [];

    for (const node of fileNodes) {
      if (node.entityType === 'symbol') {
        const meta = node.metadataJson ? JSON.parse(node.metadataJson) : {};
        symbols.push({
          symbolName: node.name ?? node.label,
          kind: meta.kind ?? 'symbol',
          filePath,
          lineStart: node.lineStart ?? 1,
          lineEnd: node.lineEnd ?? 1,
          signature: meta.signature,
        });
      }
    }

    if (fileNode) {
      // Exports
      const expEdges = this.graphRepo.findEdgesBySource(fileNode.id, 'exports');
      for (const e of expEdges) {
        const tgt = this.graphRepo.findNodeById(e.targetNodeId);
        if (tgt) exports.push(tgt.name ?? tgt.label);
      }

      // Imports
      const impEdges = this.graphRepo.findEdgesBySource(fileNode.id, 'imports');
      for (const e of impEdges) {
        const tgt = this.graphRepo.findNodeById(e.targetNodeId);
        if (tgt) imports.push(tgt.name ?? tgt.label);
      }
    }

    const dependents = this.findDependents(filePath, projectId).map((d) => d.path || d.name);
    const relatedTests = this.findRelatedTests(filePath, projectId);

    return {
      filePath,
      sizeBytes: file.sizeBytes,
      language: file.language,
      symbols,
      exports: Array.from(new Set(exports)),
      imports: Array.from(new Set(imports)),
      dependents: Array.from(new Set(dependents)),
      relatedTests,
    };
  }

  /**
   * Find references: all locations where a symbol is referenced/called.
   */
  public findReferences(symbolName: string, projectId: string): Array<{
    referencingName: string;
    referencingPath?: string;
    relation: string;
  }> {
    const results: Array<{ referencingName: string; referencingPath?: string; relation: string }> = [];
    const symNodes = this.graphRepo.findNodesByName(projectId, symbolName);

    for (const sn of symNodes) {
      const incomingEdges = [
        ...this.graphRepo.findEdgesByTarget(sn.id, 'calls'),
        ...this.graphRepo.findEdgesByTarget(sn.id, 'imports'),
        ...this.graphRepo.findEdgesByTarget(sn.id, 'tests'),
      ];

      for (const e of incomingEdges) {
        const src = this.graphRepo.findNodeById(e.sourceNodeId);
        if (src) {
          results.push({
            referencingName: src.name ?? src.label,
            referencingPath: src.path,
            relation: e.relationType,
          });
        }
      }
    }

    return results;
  }
}
