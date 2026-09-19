import { DatabaseSync } from 'node:sqlite';
import { GraphRepository, CreateSymbolParams } from '../database/repositories/graph.repository.js';
import { SymbolEntity, SymbolKind, AstAnalysisResult, GraphNode } from '../core/types.js';

export interface SymbolWithNode {
  symbol: SymbolEntity;
  node: GraphNode;
}

export class SymbolIndexer {
  private readonly graphRepo: GraphRepository;

  constructor(private readonly db: DatabaseSync) {
    this.graphRepo = new GraphRepository(db);
  }

  /**
   * Indexes all symbols extracted from an AST analysis into SQLite tables and Graph nodes.
   */
  public indexFileSymbols(
    fileId: string,
    projectId: string,
    filePath: string,
    symbols: AstAnalysisResult['symbols']
  ): SymbolWithNode[] {
    if (symbols.length === 0) return [];

    // 1. Prepare symbols for batch insert into symbols table
    const createParams: CreateSymbolParams[] = symbols.map((s) => ({
      fileId,
      projectId,
      name: s.name,
      kind: s.kind,
      lineStart: s.lineStart,
      lineEnd: s.lineEnd,
      signature: s.signature,
      docstring: s.docstring,
    }));

    const createdSymbols = this.graphRepo.addSymbols(createParams);
    const results: SymbolWithNode[] = [];

    // 2. Create graph nodes for each symbol
    for (let i = 0; i < createdSymbols.length; i++) {
      const sym = createdSymbols[i];
      const orig = symbols[i];
      if (!sym || !orig) continue;

      const node = this.graphRepo.addNode({
        projectId,
        entityType: 'symbol',
        entityId: sym.id,
        label: sym.name,
        name: sym.name,
        path: filePath,
        lineStart: sym.lineStart,
        lineEnd: sym.lineEnd,
        metadata: {
          kind: sym.kind,
          signature: sym.signature,
          docstring: sym.docstring,
          parentSymbolName: orig.parentSymbolName,
        },
      });

      results.push({ symbol: sym, node });
    }

    return results;
  }

  /**
   * Search symbols via full-text search (FTS5).
   */
  public searchSymbols(query: string, limit = 20): SymbolEntity[] {
    return this.graphRepo.searchSymbolsFTS(query, limit);
  }

  /**
   * Find symbol by exact name.
   */
  public findSymbolByName(projectId: string, name: string): SymbolEntity[] {
    const stmt = this.db.prepare(`
      SELECT * FROM symbols
      WHERE project_id = ? AND name = ?
      ORDER BY line_start ASC
    `);
    const rows = stmt.all(projectId, name) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r['id']),
      fileId: String(r['file_id']),
      projectId: String(r['project_id']),
      name: String(r['name']),
      kind: r['kind'] as SymbolKind,
      lineStart: Number(r['line_start']),
      lineEnd: Number(r['line_end']),
      signature: r['signature'] ? String(r['signature']) : undefined,
      docstring: r['docstring'] ? String(r['docstring']) : undefined,
      createdAt: Number(r['created_at']),
    }));
  }

  /**
   * Remove symbols associated with a specific file.
   */
  public deleteSymbolsForFile(fileId: string): void {
    this.graphRepo.deleteSymbolsByFileId(fileId);
  }
}
