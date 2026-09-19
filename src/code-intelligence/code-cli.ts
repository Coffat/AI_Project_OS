import { DatabaseSync } from 'node:sqlite';
import { CodeIndexer } from './code-indexer.js';
import { CodeQueryService } from './code-query-service.js';

export class CodeCLI {
  private readonly indexer: CodeIndexer;
  private readonly queryService: CodeQueryService;

  constructor(db: DatabaseSync) {
    this.indexer = new CodeIndexer(db);
    this.queryService = new CodeQueryService(db);
  }

  public async run(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.renderHelp();
    }

    const command = args[0]?.toLowerCase();
    const subCommand = args[1]?.toLowerCase();

    // Command: index project
    if (command === 'index' && subCommand === 'project') {
      const projectRoot = args[2] || process.cwd();
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const result = await this.indexer.indexProject(projectRoot, projectId);
      return [
        '================================================================================',
        '                      CODE INTELLIGENCE — INDEX PROJECT                         ',
        '================================================================================',
        `Project ID:       ${result.projectId}`,
        `Project Root:     ${projectRoot}`,
        `Files Indexed:    ${result.filesIndexed}`,
        `Symbols Indexed:  ${result.symbolsIndexed}`,
        `Edges Created:    ${result.edgesCreated}`,
        `Duration:         ${result.durationMs}ms`,
        '================================================================================',
      ].join('\n');
    }

    // Command: index changed
    if (command === 'index' && subCommand === 'changed') {
      const projectRoot = args[2] || process.cwd();
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const baseRef = this.extractOption(args, '--base-ref');
      const result = await this.indexer.indexChanged(projectRoot, projectId, { baseRef });
      return [
        '================================================================================',
        '                      CODE INTELLIGENCE — INCREMENTAL INDEX                     ',
        '================================================================================',
        `Project ID:       ${result.projectId}`,
        `Added Files:      ${result.addedCount}`,
        `Modified Files:   ${result.modifiedCount}`,
        `Deleted Files:    ${result.deletedCount}`,
        `Renamed Files:    ${result.renamedCount}`,
        `Re-indexed Files: ${result.affectedReindexedCount}`,
        `Duration:         ${result.durationMs}ms`,
        '================================================================================',
      ].join('\n');
    }

    // Command: inspect symbol <name>
    if (command === 'inspect' && subCommand === 'symbol') {
      const symbolName = args[2];
      if (!symbolName) return 'Error: Symbol name is required (e.g., inspect symbol UserService)';
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const info = this.queryService.inspectSymbol(symbolName, projectId);
      if (!info) return `Symbol not found: "${symbolName}" in project "${projectId}".`;

      const lines = [
        '================================================================================',
        `                      SYMBOL INSPECTION: ${symbolName}                          `,
        '================================================================================',
        `Name:             ${info.symbol.symbolName}`,
        `Kind:             ${info.symbol.kind}`,
        `File Path:        ${info.symbol.filePath}`,
        `Lines:            ${info.symbol.lineStart} - ${info.symbol.lineEnd}`,
        `Signature:        ${info.symbol.signature ?? 'N/A'}`,
        `Docstring:        ${info.symbol.docstring ? info.symbol.docstring.replace(/\n/g, ' ') : 'N/A'}`,
        '-------------------------------- CALLERS ---------------------------------------',
        info.callers.length > 0
          ? info.callers.map((c) => `  <- ${c.name} (${c.path ?? 'unknown'})`).join('\n')
          : '  (No recorded callers)',
        '-------------------------------- CALLEES ---------------------------------------',
        info.callees.length > 0
          ? info.callees.map((c) => `  -> ${c.name} (${c.path ?? 'unknown'})`).join('\n')
          : '  (No recorded callees)',
        '-------------------------------- IMPLEMENTS ------------------------------------',
        info.implementsInterfaces.length > 0
          ? info.implementsInterfaces.map((i) => `  implements ${i}`).join('\n')
          : '  (None)',
        '------------------------------ RELATED TESTS -----------------------------------',
        info.relatedTests.length > 0
          ? info.relatedTests.map((t) => `  [Test] ${t.testFilePath} : ${t.testName ?? 'suite'}`).join('\n')
          : '  (No associated tests found)',
        '================================================================================',
      ];
      return lines.join('\n');
    }

    // Command: inspect file <path>
    if (command === 'inspect' && subCommand === 'file') {
      const filePath = args[2];
      if (!filePath) return 'Error: File path is required (e.g., inspect file src/math.ts)';
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const info = this.queryService.inspectFile(filePath, projectId);
      if (!info) return `File not found: "${filePath}" in project "${projectId}".`;

      const lines = [
        '================================================================================',
        `                      FILE INSPECTION: ${filePath}                              `,
        '================================================================================',
        `Path:             ${info.filePath}`,
        `Language:         ${info.language ?? 'unknown'}`,
        `Size:             ${info.sizeBytes} bytes`,
        `Symbols (${info.symbols.length}):`,
        ...info.symbols.map((s) => `  - ${s.symbolName} [${s.kind}] (L${s.lineStart}-L${s.lineEnd})`),
        `Exports (${info.exports.length}):`,
        ...info.exports.map((e) => `  - ${e}`),
        `Imports (${info.imports.length}):`,
        ...info.imports.map((i) => `  - ${i}`),
        `Dependents (${info.dependents.length}):`,
        ...info.dependents.map((d) => `  - ${d}`),
        `Related Tests (${info.relatedTests.length}):`,
        ...info.relatedTests.map((t) => `  - ${t.testFilePath} (${t.testName ?? 'suite'})`),
        '================================================================================',
      ];
      return lines.join('\n');
    }

    // Command: find references <symbol>
    if (command === 'find' && subCommand === 'references') {
      const symbolName = args[2];
      if (!symbolName) return 'Error: Symbol name is required';
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const refs = this.queryService.findReferences(symbolName, projectId);
      return [
        `References to "${symbolName}" (${refs.length}):`,
        ...refs.map((r) => `  - ${r.referencingName} (${r.relation}) in ${r.referencingPath ?? 'unknown'}`),
      ].join('\n');
    }

    // Command: find dependencies <target>
    if (command === 'find' && subCommand === 'dependencies') {
      const target = args[2];
      if (!target) return 'Error: Target is required';
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const deps = this.queryService.findDependencies(target, projectId);
      return [
        `Dependencies of "${target}" (${deps.length}):`,
        ...deps.map((d) => `  -> [${d.type}] ${d.name} (${d.relation}) ${d.path ? `in ${d.path}` : ''}`),
      ].join('\n');
    }

    // Command: find dependents <target>
    if (command === 'find' && subCommand === 'dependents') {
      const target = args[2];
      if (!target) return 'Error: Target is required';
      const projectId = this.extractOption(args, '--project-id') || 'default';
      const deps = this.queryService.findDependents(target, projectId);
      return [
        `Dependents on "${target}" (${deps.length}):`,
        ...deps.map((d) => `  <- [${d.type}] ${d.name} (${d.relation}) ${d.path ? `in ${d.path}` : ''}`),
      ].join('\n');
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
      'Code Intelligence Engine CLI Commands:',
      '  index project [path] [--project-id=id]',
      '  index changed [path] [--base-ref=git-hash] [--project-id=id]',
      '  inspect symbol <name> [--project-id=id]',
      '  inspect file <path> [--project-id=id]',
      '  find references <symbol> [--project-id=id]',
      '  find dependencies <target> [--project-id=id]',
      '  find dependents <target> [--project-id=id]',
    ].join('\n');
  }
}
