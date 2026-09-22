import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ASTAnalyzer } from './ast-analyzer.js';
import { SymbolIndexer } from './symbol-indexer.js';
import { DependencyAnalyzer } from './dependency-analyzer.js';
import { GitAnalyzer } from './git-analyzer.js';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import { AstAnalysisResult, GraphNode } from '../core/types.js';

export interface IndexProjectOptions {
  includeExtensions?: string[];
  excludePatterns?: string[];
}

export interface IndexProjectResult {
  projectId: string;
  filesIndexed: number;
  symbolsIndexed: number;
  edgesCreated: number;
  durationMs: number;
}

export interface IndexChangedOptions {
  baseRef?: string;
  targetRef?: string;
}

export interface IndexChangedResult {
  projectId: string;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  renamedCount: number;
  affectedReindexedCount: number;
  durationMs: number;
}

export class CodeIndexer {
  private readonly astAnalyzer: ASTAnalyzer;
  private readonly symbolIndexer: SymbolIndexer;
  private readonly dependencyAnalyzer: DependencyAnalyzer;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly graphRepo: GraphRepository;

  constructor(db: DatabaseSync) {
    this.astAnalyzer = new ASTAnalyzer();
    this.symbolIndexer = new SymbolIndexer(db);
    this.dependencyAnalyzer = new DependencyAnalyzer(db);
    this.gitAnalyzer = new GitAnalyzer();
    this.graphRepo = new GraphRepository(db);
  }

  /**
   * Scans and indexes an entire project codebase.
   */
  public async indexProject(
    projectRoot: string,
    projectId: string,
    options: IndexProjectOptions = {}
  ): Promise<IndexProjectResult> {
    const startTime = performance.now();
    const exts = options.includeExtensions ?? [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.json',
      '.sql',
      '.prisma',
    ];
    const excludePatterns = options.excludePatterns ?? [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.ai',
      'coverage',
    ];

    // 1. Discover all candidate files
    const filePaths = await this.walkDirectory(projectRoot, projectRoot, exts, excludePatterns);
    let totalSymbols = 0;
    let totalEdges = 0;

    // Cache of analyses for 2nd-pass dependency linking
    const analysisCache: Array<{
      relPath: string;
      fileNode: GraphNode;
      analysis: AstAnalysisResult;
      symbolNodes: GraphNode[];
    }> = [];

    // PASS 1: Read files, insert files, parse AST, insert symbols & file nodes
    for (const relPath of filePaths) {
      const fullPath = path.join(projectRoot, relPath);
      const content = await fs.readFile(fullPath, 'utf8');
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const stat = await fs.stat(fullPath);

      // Upsert into files table
      const fileEntity = this.graphRepo.upsertFile({
        projectId,
        path: relPath,
        language: path.extname(relPath).replace('.', ''),
        sizeBytes: stat.size,
        lastModifiedAt: stat.mtimeMs,
        contentHash: hash,
      });

      // Add or get file graph node
      const fileNode = this.graphRepo.addNode({
        projectId,
        entityType: 'file',
        entityId: fileEntity.id,
        label: path.basename(relPath),
        name: path.basename(relPath),
        path: relPath,
      });

      // Parse AST
      const analysis = this.astAnalyzer.analyze(relPath, content);

      // Clean old symbols and index new
      this.symbolIndexer.deleteSymbolsForFile(fileEntity.id, projectId, relPath);
      const indexedSymbols = this.symbolIndexer.indexFileSymbols(
        fileEntity.id,
        projectId,
        relPath,
        analysis.symbols
      );
      totalSymbols += indexedSymbols.length;

      const symbolNodes = indexedSymbols.map((s) => s.node);
      analysisCache.push({ relPath, fileNode, analysis, symbolNodes });
    }

    // PASS 2: Link cross-file dependencies and build graph edges
    for (const item of analysisCache) {
      const edges = this.dependencyAnalyzer.linkFileDependencies(
        projectId,
        item.fileNode,
        item.analysis,
        item.symbolNodes,
        filePaths
      );
      totalEdges += edges.length;
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      projectId,
      filesIndexed: filePaths.length,
      symbolsIndexed: totalSymbols,
      edgesCreated: totalEdges,
      durationMs,
    };
  }

  /**
   * Incrementally indexes changed files based on Git diff / status.
   */
  public async indexChanged(
    projectRoot: string,
    projectId: string,
    options: IndexChangedOptions = {}
  ): Promise<IndexChangedResult> {
    const startTime = performance.now();

    // 1. Determine changed files
    let changes = options.baseRef
      ? await this.gitAnalyzer.getDiffChanges(projectRoot, options.baseRef, options.targetRef)
      : await this.gitAnalyzer.getWorkingTreeChanges(projectRoot);

    if (
      changes.added.length === 0 &&
      changes.modified.length === 0 &&
      changes.deleted.length === 0 &&
      changes.renamed.length === 0
    ) {
      // Fallback to comparing current filesystem against SQLite files table
      const existingDbFiles = this.graphRepo.listFiles(projectId).map((f) => ({
        path: f.path,
        contentHash: f.contentHash,
        lastModifiedAt: f.lastModifiedAt,
      }));
      const allCandidatePaths = await this.walkDirectory(
        projectRoot,
        projectRoot,
        ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.sql', '.prisma'],
        ['node_modules', '.git', 'dist', 'build', '.ai', 'coverage']
      );
      const fsDiff = await this.gitAnalyzer.computeFilesystemDiff(projectRoot, existingDbFiles, allCandidatePaths);
      if (
        fsDiff.added.length > 0 ||
        fsDiff.modified.length > 0 ||
        fsDiff.deleted.length > 0 ||
        fsDiff.renamed.length > 0
      ) {
        changes = fsDiff;
      }
    }

    // 2. Handle deleted files
    for (const delPath of changes.deleted) {
      this.graphRepo.deleteFileGraph(projectId, delPath);
    }

    // 3. Handle renamed files
    for (const rename of changes.renamed) {
      this.graphRepo.updateFilePath(projectId, rename.from, rename.to);
    }

    // 4. Collect files to reindex (added + modified + renamed targets)
    const filesToReindex = Array.from(
      new Set([...changes.added, ...changes.modified, ...changes.renamed.map((r) => r.to)])
    );

    const allDbFiles = this.graphRepo.listFiles(projectId).map((f) => f.path);
    const knownFiles = Array.from(new Set([...allDbFiles, ...filesToReindex]));

    let affectedReindexedCount = 0;

    for (const relPath of filesToReindex) {
      const fullPath = path.join(projectRoot, relPath);
      let content = '';
      try {
        content = await fs.readFile(fullPath, 'utf8');
      } catch {
        // File may have been deleted before reindexing
        continue;
      }

      const hash = crypto.createHash('sha256').update(content).digest('hex');
      const stat = await fs.stat(fullPath);

      // Upsert file entity
      const fileEntity = this.graphRepo.upsertFile({
        projectId,
        path: relPath,
        language: path.extname(relPath).replace('.', ''),
        sizeBytes: stat.size,
        lastModifiedAt: stat.mtimeMs,
        contentHash: hash,
      });

      // Upsert file graph node
      const fileNode = this.graphRepo.addNode({
        projectId,
        entityType: 'file',
        entityId: fileEntity.id,
        label: path.basename(relPath),
        name: path.basename(relPath),
        path: relPath,
      });

      // Re-parse AST
      const analysis = this.astAnalyzer.analyze(relPath, content);

      // Delete old symbols for this file and re-index
      this.symbolIndexer.deleteSymbolsForFile(fileEntity.id, projectId, relPath);
      const indexed = this.symbolIndexer.indexFileSymbols(
        fileEntity.id,
        projectId,
        relPath,
        analysis.symbols
      );

      // Re-link dependencies for this file
      this.dependencyAnalyzer.linkFileDependencies(
        projectId,
        fileNode,
        analysis,
        indexed.map((i) => i.node),
        knownFiles
      );

      affectedReindexedCount++;
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      projectId,
      addedCount: changes.added.length,
      modifiedCount: changes.modified.length,
      deletedCount: changes.deleted.length,
      renamedCount: changes.renamed.length,
      affectedReindexedCount,
      durationMs,
    };
  }

  private async walkDirectory(
    dir: string,
    root: string,
    allowedExts: string[],
    excludes: string[]
  ): Promise<string[]> {
    const results: string[] = [];
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (excludes.includes(entry)) continue;

      const fullPath = path.join(dir, entry);
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const subFiles = await this.walkDirectory(fullPath, root, allowedExts, excludes);
        results.push(...subFiles);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (allowedExts.includes(ext)) {
          const rel = path.relative(root, fullPath);
          results.push(rel);
        }
      }
    }

    return results;
  }
}
