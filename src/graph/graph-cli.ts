import type { DatabaseSync } from 'node:sqlite';
import { GraphService } from './graph-service.js';

export class GraphCLI {
  private readonly service: GraphService;

  constructor(db: DatabaseSync) {
    this.service = new GraphService(db);
  }

  public async run(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.renderHelp();
    }

    // Normalize if first arg is 'graph'
    const commandIndex = args[0]?.toLowerCase() === 'graph' ? 1 : 0;
    const command = args[commandIndex]?.toLowerCase();

    const projectId = this.extractOption(args, '--project-id') || 'default';

    // 1. graph neighbors <nodeIdOrEntity>
    if (command === 'neighbors') {
      const identifier = args[commandIndex + 1];
      if (!identifier) {
        return 'Error: Node ID or entity identifier is required (e.g., graph neighbors TASK-042)';
      }

      const direction = (this.extractOption(args, '--direction')?.toUpperCase() || 'BOTH') as 'OUT' | 'IN' | 'BOTH';
      const depthStr = this.extractOption(args, '--depth');
      const maxDepth = depthStr ? parseInt(depthStr, 10) : 1;

      try {
        const neighbors = await this.service.getNeighbors(identifier, {
          direction,
          maxDepth,
          projectId,
        });

        const lines = [
          '================================================================================',
          `                     GRAPH NEIGHBORS: ${identifier}                            `,
          '================================================================================',
          `Direction:        ${direction}`,
          `Max Depth:        ${maxDepth}`,
          `Project ID:       ${projectId}`,
          `Neighbors Found:  ${neighbors.length}`,
          '-------------------------------- NEIGHBORS -------------------------------------',
        ];

        if (neighbors.length === 0) {
          lines.push('  (No connected neighbors found within depth limit)');
        } else {
          for (const item of neighbors) {
            const relDirection = item.edge.sourceNodeId === item.node.id ? '<-' : '->';
            lines.push(
              `  [Depth ${item.depth}] ${relDirection} [${item.edge.relationType}] ${item.node.label} (${item.node.entityType}:${item.node.entityId})${item.node.path ? ` at ${item.node.path}` : ''}`
            );
          }
        }
        lines.push('================================================================================');
        return lines.join('\n');
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    // 2. graph path <start> <end>
    if (command === 'path') {
      const start = args[commandIndex + 1];
      const end = args[commandIndex + 2];
      if (!start || !end) {
        return 'Error: Both start and end node identifiers are required (e.g., graph path TASK-042 SECURITY-003)';
      }

      const maxDepthStr = this.extractOption(args, '--max-depth');
      const maxDepth = maxDepthStr ? parseInt(maxDepthStr, 10) : 5;

      try {
        const pathResult = await this.service.findPath(start, end, {
          maxDepth,
          projectId,
        });

        if (!pathResult) {
          return [
            '================================================================================',
            `                 GRAPH PATH: ${start} -> ${end}                                `,
            '================================================================================',
            `Status:           No path found within depth limit (${maxDepth})`,
            '================================================================================',
          ].join('\n');
        }

        const lines = [
          '================================================================================',
          `                 GRAPH PATH: ${start} -> ${end}                                `,
          '================================================================================',
          `Distance (hops):  ${pathResult.distance}`,
          `Total Weight:     ${pathResult.totalWeight}`,
          `Hops Sequence:`,
        ];

        for (let i = 0; i < pathResult.nodes.length; i++) {
          const n = pathResult.nodes[i]!;
          lines.push(`  [${i}] ${n.label} (${n.entityType}:${n.entityId})`);
          if (i < pathResult.edges.length) {
            const e = pathResult.edges[i]!;
            lines.push(`      │ [${e.relationType}] (weight: ${e.weight ?? 1.0})`);
            lines.push(`      ▼`);
          }
        }
        lines.push('================================================================================');
        return lines.join('\n');
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    // 3. graph task-context <taskId>
    if (command === 'task-context') {
      const taskId = args[commandIndex + 1];
      if (!taskId) {
        return 'Error: Task ID or entity identifier is required (e.g., graph task-context TASK-042)';
      }

      const depthStr = this.extractOption(args, '--depth');
      const maxDepth = depthStr ? parseInt(depthStr, 10) : 2;

      try {
        const ctx = await this.service.findTaskContext(taskId, {
          maxDepth,
          projectId,
        });

        const lines = [
          '================================================================================',
          `                   GRAPH CONTEXT FOR TASK: ${ctx.taskNode.label}                `,
          '================================================================================',
          `Task ID:          ${ctx.taskNode.entityId}`,
          `Label:            ${ctx.taskNode.label}`,
          `Project ID:       ${projectId}`,
          '',
          '------------------------------ MODIFIED FILES ----------------------------------',
          ctx.modifiedFiles.length > 0
            ? ctx.modifiedFiles.map((f) => `  * ${f.path} (score: ${f.score})`).join('\n')
            : '  (None directly recorded)',
          '',
          '-------------------------- DEPENDENT ARCH DECISIONS ----------------------------',
          ctx.decisions.length > 0
            ? ctx.decisions.map((d) => `  * ${d.label} [${d.node.entityId}]`).join('\n')
            : '  (None)',
          '',
          '----------------------------- ACTIVE CONSTRAINTS -------------------------------',
          ctx.constraints.length > 0
            ? ctx.constraints.map((c) => `  * [!] ${c.label} [${c.node.entityId}]`).join('\n')
            : '  (None)',
          '',
          '-------------------------------- RELATED TESTS ---------------------------------',
          ctx.tests.length > 0
            ? ctx.tests.map((t) => `  * [Test] ${t.path}`).join('\n')
            : '  (None)',
          '',
          '---------------------------- CONNECTED SYMBOLS ---------------------------------',
          ctx.symbols.length > 0
            ? ctx.symbols.map((s) => `  * ${s.name}`).join('\n')
            : '  (None)',
          '',
          '--------------------------- TOP RANKED KNOWLEDGE -------------------------------',
          ctx.rankedRelated.length > 0
            ? ctx.rankedRelated.slice(0, 5).map((r) => `  [Score: ${r.score} | Hop: ${r.distance}] ${r.node.label} (${r.node.entityType})\n    Reasons: ${r.reasons.join(', ')}`).join('\n')
            : '  (No additional knowledge)',
          '================================================================================',
        ];
        return lines.join('\n');
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    // 4. graph file-context <filePath>
    if (command === 'file-context') {
      const filePath = args[commandIndex + 1];
      if (!filePath) {
        return 'Error: File path or node identifier is required (e.g., graph file-context src/auth/oauth.ts)';
      }

      const depthStr = this.extractOption(args, '--depth');
      const maxDepth = depthStr ? parseInt(depthStr, 10) : 2;

      try {
        const ctx = await this.service.findFileContext(filePath, {
          maxDepth,
          projectId,
        });

        const lines = [
          '================================================================================',
          `                   GRAPH CONTEXT FOR FILE: ${ctx.path}                          `,
          '================================================================================',
          `Path:             ${ctx.path}`,
          `Project ID:       ${projectId}`,
          '',
          '------------------------------- MODIFYING TASKS --------------------------------',
          ctx.modifyingTasks.length > 0
            ? ctx.modifyingTasks.map((t) => `  * ${t.label} [${t.node.entityId}]`).join('\n')
            : '  (None)',
          '',
          '-------------------------------- RELATED TESTS ---------------------------------',
          ctx.relatedTests.length > 0
            ? ctx.relatedTests.map((t) => `  * [Test] ${t.path}`).join('\n')
            : '  (None)',
          '',
          '-------------------------------- IMPORTS (OUT) ---------------------------------',
          ctx.importedFiles.length > 0
            ? ctx.importedFiles.map((f) => `  -> ${f.path}`).join('\n')
            : '  (None)',
          '',
          '-------------------------------- IMPORTERS (IN) --------------------------------',
          ctx.importerFiles.length > 0
            ? ctx.importerFiles.map((f) => `  <- ${f.path}`).join('\n')
            : '  (None)',
          '',
          '----------------------------- GOVERNING DECISIONS ------------------------------',
          ctx.relatedDecisions.length > 0
            ? ctx.relatedDecisions.map((d) => `  * ${d.label} [${d.node.entityId}]`).join('\n')
            : '  (None)',
          '================================================================================',
        ];
        return lines.join('\n');
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    // 5. graph verify
    if (command === 'verify') {
      try {
        const report = await this.service.verifyGraphIntegrity(projectId);
        const lines = [
          '================================================================================',
          '                     GRAPH INTEGRITY VERIFICATION REPORT                        ',
          '================================================================================',
          `Status:           ${report.isValid ? 'VALID (Consistent)' : 'INVALID (Corrupted edges detected)'}`,
          `Total Nodes:      ${report.totalNodes}`,
          `Total Edges:      ${report.totalEdges}`,
          `Dangling Edges:   ${report.danglingEdges.length}`,
          `Self Loops:       ${report.selfLoops.length}`,
          `Isolated Nodes:   ${report.isolatedNodes.length}`,
          '--------------------------------- DIAGNOSTICS ----------------------------------',
          ...report.details.map((d) => `  * ${d}`),
          '================================================================================',
        ];
        return lines.join('\n');
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    return this.renderHelp();
  }

  private extractOption(args: string[], optionName: string): string | undefined {
    for (const arg of args) {
      if (arg.startsWith(`${optionName}=`)) {
        return arg.substring(optionName.length + 1);
      }
    }
    const idx = args.indexOf(optionName);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }

  private renderHelp(): string {
    return [
      'Knowledge Graph CLI Commands:',
      '  graph neighbors <node-or-entity> [--direction=OUT|IN|BOTH] [--depth=1] [--project-id=id]',
      '  graph path <start> <end> [--max-depth=5] [--project-id=id]',
      '  graph task-context <task-id> [--depth=2] [--project-id=id]',
      '  graph file-context <file-path> [--depth=2] [--project-id=id]',
      '  graph verify [--project-id=id]',
    ].join('\n');
  }
}
