import type { DatabaseSync } from 'node:sqlite';

export type SymbolKind = 'FUNCTION' | 'CLASS' | 'INTERFACE' | 'VARIABLE' | 'METHOD';

export interface SymbolDefinition {
  nodeId: string;
  identifier: string;
  label: string;
  filePath: string;
  kind: SymbolKind;
  documentation?: string;
  lineStart: number;
  lineEnd: number;
}

export interface ICodeIntelligenceEngine {
  indexSymbols(symbols: SymbolDefinition[]): Promise<void>;
  searchSymbols(query: string): Promise<SymbolDefinition[]>;
}

export class CodeIntelligenceEngine implements ICodeIntelligenceEngine {
  constructor(private readonly db: DatabaseSync) {}

  public async indexSymbols(symbols: SymbolDefinition[]): Promise<void> {
    const insertStmt = this.db.prepare(`
      INSERT INTO fts_code_symbols (node_id, identifier, label, file_path, documentation)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.db.exec('BEGIN TRANSACTION;');
    try {
      for (const s of symbols) {
        insertStmt.run(s.nodeId, s.identifier, s.label, s.filePath, s.documentation ?? null);
      }
      this.db.exec('COMMIT;');
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    }
  }

  public async searchSymbols(query: string): Promise<SymbolDefinition[]> {
    if (!query || query.trim() === '') return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM fts_code_symbols
        WHERE fts_code_symbols MATCH ?
        LIMIT 20
      `);
      const rows = stmt.all(query) as Record<string, unknown>[];
      return rows.map((r) => ({
        nodeId: String(r['node_id']),
        identifier: String(r['identifier']),
        label: String(r['label']),
        filePath: String(r['file_path']),
        kind: 'FUNCTION' as SymbolKind,
        documentation: r['documentation'] ? String(r['documentation']) : undefined,
        lineStart: 1,
        lineEnd: 1,
      }));
    } catch {
      return [];
    }
  }
}
