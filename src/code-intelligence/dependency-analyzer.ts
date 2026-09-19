import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GraphRepository } from '../database/repositories/graph.repository.js';
import {
  AstAnalysisResult,
  GraphNode,
  GraphEdge,
} from '../core/types.js';

export interface ResolveModuleParams {
  importingFilePath: string;
  sourceModule: string;
  knownFiles: string[]; // relative paths in project
}

export class DependencyAnalyzer {
  private readonly graphRepo: GraphRepository;

  constructor(db: DatabaseSync) {
    this.graphRepo = new GraphRepository(db);
  }

  /**
   * Resolves an import module specifier from an importing file to a project relative file path or external module.
   */
  public resolveModuleSpecifier(params: ResolveModuleParams): {
    resolvedPath?: string;
    isExternal: boolean;
    moduleName: string;
  } {
    const { importingFilePath, sourceModule, knownFiles } = params;

    // Check if relative import
    if (sourceModule.startsWith('./') || sourceModule.startsWith('../')) {
      const importingDir = path.dirname(importingFilePath);
      const rawTarget = path.normalize(path.join(importingDir, sourceModule));

      // Extensions to try
      const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.d.ts'];
      // Also handle when import specifier has .js but source file is .ts
      const baseWithoutExt = rawTarget.replace(/\.(js|jsx|ts|tsx)$/, '');

      for (const ext of extensions) {
        const candidate = rawTarget + ext;
        if (knownFiles.includes(candidate)) {
          return { resolvedPath: candidate, isExternal: false, moduleName: candidate };
        }
      }

      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = baseWithoutExt + ext;
        if (knownFiles.includes(candidate)) {
          return { resolvedPath: candidate, isExternal: false, moduleName: candidate };
        }
      }

      // Check index files
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const indexCandidate = path.join(rawTarget, `index${ext}`);
        if (knownFiles.includes(indexCandidate)) {
          return { resolvedPath: indexCandidate, isExternal: false, moduleName: indexCandidate };
        }
      }

      // If relative file path not in known files, return normalized path
      return { resolvedPath: rawTarget, isExternal: false, moduleName: rawTarget };
    }

    // External npm module or alias
    return {
      resolvedPath: undefined,
      isExternal: true,
      moduleName: sourceModule,
    };
  }

  /**
   * Links a single file's AST analysis into graph edges.
   */
  public linkFileDependencies(
    projectId: string,
    fileNode: GraphNode,
    analysis: AstAnalysisResult,
    fileSymbolNodes: GraphNode[],
    knownFiles: string[]
  ): GraphEdge[] {
    const createdEdges: GraphEdge[] = [];
    const symbolMapByName = new Map<string, GraphNode>();
    for (const sn of fileSymbolNodes) {
      if (sn.name) symbolMapByName.set(sn.name, sn);
      symbolMapByName.set(sn.label, sn);
    }

    // 1. "contains" Edges: fileNode -> symbolNode
    for (const symNode of fileSymbolNodes) {
      const edge = this.graphRepo.addEdge({
        projectId,
        sourceNodeId: fileNode.id,
        targetNodeId: symNode.id,
        relationType: 'contains',
      });
      createdEdges.push(edge);
    }

    // 2. "exports" Edges: fileNode -> symbolNode
    for (const exp of analysis.exports) {
      const symNode = symbolMapByName.get(exp.name) ?? symbolMapByName.get(exp.exportedName);
      if (symNode) {
        const edge = this.graphRepo.addEdge({
          projectId,
          sourceNodeId: fileNode.id,
          targetNodeId: symNode.id,
          relationType: 'exports',
          metadata: { isDefault: exp.isDefault, exportedName: exp.exportedName },
        });
        createdEdges.push(edge);
      }
    }

    // 3. "imports" & "depends_on" Edges
    for (const imp of analysis.imports) {
      const resolved = this.resolveModuleSpecifier({
        importingFilePath: analysis.filePath,
        sourceModule: imp.sourceModule,
        knownFiles,
      });

      let targetNode: GraphNode | null = null;

      if (!resolved.isExternal && resolved.resolvedPath) {
        // Find or create target file node
        const targetNodes = this.graphRepo.findNodesByPath(projectId, resolved.resolvedPath);
        targetNode = targetNodes.find((n) => n.entityType === 'file') ?? null;
      } else {
        // Module node for external package (or unlocated module)
        targetNode = this.graphRepo.findNodeByEntity(projectId, 'module', resolved.moduleName);
        if (!targetNode) {
          targetNode = this.graphRepo.addNode({
            projectId,
            entityType: 'module',
            entityId: resolved.moduleName,
            label: resolved.moduleName,
            name: resolved.moduleName,
            metadata: { isExternal: true },
          });
        }
      }

      if (targetNode) {
        // file -> targetNode imports
        const importEdge = this.graphRepo.addEdge({
          projectId,
          sourceNodeId: fileNode.id,
          targetNodeId: targetNode.id,
          relationType: 'imports',
          metadata: {
            specifiers: imp.specifiers,
            isDefault: imp.isDefault,
            isNamespace: imp.isNamespace,
          },
        });
        createdEdges.push(importEdge);

        // file -> targetNode depends_on
        const depEdge = this.graphRepo.addEdge({
          projectId,
          sourceNodeId: fileNode.id,
          targetNodeId: targetNode.id,
          relationType: 'depends_on',
        });
        createdEdges.push(depEdge);

        // If specific symbols are imported and target is an internal file, link symbol -> target symbol
        if (!resolved.isExternal && resolved.resolvedPath) {
          for (const spec of imp.specifiers) {
            const importedSymNodes = this.graphRepo.findNodesByName(projectId, spec.name);
            const matching = importedSymNodes.find(
              (n) => n.path === resolved.resolvedPath && n.entityType === 'symbol'
            );
            if (matching) {
              const symImportEdge = this.graphRepo.addEdge({
                projectId,
                sourceNodeId: fileNode.id,
                targetNodeId: matching.id,
                relationType: 'imports',
                metadata: { specifier: spec.name },
              });
              createdEdges.push(symImportEdge);
            }
          }
        }
      }
    }

    // 4. "implements" Edges: Class -> Interface
    for (const impl of analysis.implements) {
      const classNode = symbolMapByName.get(impl.className);
      if (classNode) {
        // Search for interface in current project
        const candidates = this.graphRepo.findNodesByName(projectId, impl.interfaceName);
        const ifaceNode = candidates.find((n) => n.entityType === 'symbol');
        if (ifaceNode) {
          const edge = this.graphRepo.addEdge({
            projectId,
            sourceNodeId: classNode.id,
            targetNodeId: ifaceNode.id,
            relationType: 'implements',
          });
          createdEdges.push(edge);
        }
      }
    }

    // 5. "calls" Edges: Caller symbol -> Callee symbol
    for (const call of analysis.calls) {
      if (!call.callerSymbolName) continue;

      const callerNode = symbolMapByName.get(call.callerSymbolName);
      if (!callerNode) continue;

      // Find callee in same file first
      let calleeNode = symbolMapByName.get(call.calleeName);

      // If not in same file, search by name in project
      if (!calleeNode) {
        const candidates = this.graphRepo.findNodesByName(projectId, call.calleeName);
        calleeNode = candidates.find((n) => n.entityType === 'symbol');
      }

      if (calleeNode && calleeNode.id !== callerNode.id) {
        const edge = this.graphRepo.addEdge({
          projectId,
          sourceNodeId: callerNode.id,
          targetNodeId: calleeNode.id,
          relationType: 'calls',
        });
        createdEdges.push(edge);
      }
    }

    // 6. "tests" Edges: Test file/case -> Target symbols or files
    const isTestFile =
      analysis.filePath.includes('.test.') ||
      analysis.filePath.includes('.spec.') ||
      analysis.filePath.startsWith('tests/') ||
      analysis.filePath.startsWith('test/');

    if (isTestFile) {
      // Find what files this test file imports
      const importEdges = this.graphRepo.findEdgesBySource(fileNode.id, 'imports');
      for (const ie of importEdges) {
        const targetNode = this.graphRepo.findNodeById(ie.targetNodeId);
        if (targetNode && targetNode.entityType === 'file') {
          const edge = this.graphRepo.addEdge({
            projectId,
            sourceNodeId: fileNode.id,
            targetNodeId: targetNode.id,
            relationType: 'tests',
          });
          createdEdges.push(edge);
        }
      }

      // Link specific test cases to tested symbols
      for (const testCase of analysis.tests) {
        for (const calledSym of testCase.calledSymbols) {
          const candidates = this.graphRepo.findNodesByName(projectId, calledSym);
          for (const cand of candidates) {
            if (cand.entityType === 'symbol' && cand.path !== analysis.filePath) {
              const edge = this.graphRepo.addEdge({
                projectId,
                sourceNodeId: fileNode.id,
                targetNodeId: cand.id,
                relationType: 'tests',
                metadata: { testName: testCase.testName },
              });
              createdEdges.push(edge);
            }
          }
        }
      }
    }

    return createdEdges;
  }
}
