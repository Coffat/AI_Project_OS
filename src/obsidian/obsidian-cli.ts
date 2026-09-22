import type { DatabaseSync } from 'node:sqlite';
import { ObsidianSyncService } from './obsidian-sync-service.js';

export class ObsidianCLI {
  private readonly syncService: ObsidianSyncService;

  constructor(db: DatabaseSync, projectRoot: string) {
    this.syncService = new ObsidianSyncService(db, projectRoot);
  }

  public async run(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.renderHelp();
    }

    let idx = 0;
    if (args[idx]?.toLowerCase() === 'obsidian') {
      idx++;
    }

    const subCommand = args[idx]?.toLowerCase();
    const projectId = this.extractOption(args, '--project-id');
    const force = args.includes('--force');

    switch (subCommand) {
      case 'sync': {
        const direction = args.includes('--export-only')
          ? 'export_only'
          : args.includes('--import-only')
          ? 'import_only'
          : 'bidirectional';

        const result = await this.syncService.sync({
          projectId,
          force,
          direction,
        });

        const lines = [
          '================================================================================',
          '                     OBSIDIAN VAULT SYNCHRONIZATION                             ',
          '================================================================================',
          `Project ID:       ${result.projectId}`,
          `Direction:        ${direction}`,
          `Exported Files:   ${result.exportedFiles.length}`,
          `Imported Files:   ${result.importedFiles.length}`,
          `Unchanged Files:  ${result.unchangedFiles.length}`,
          `Conflicts:        ${result.conflicts.length}`,
          '--------------------------------------------------------------------------------',
        ];

        if (result.exportedFiles.length > 0) {
          lines.push('  📤 Exported to Markdown:');
          for (const f of result.exportedFiles) {
            lines.push(`     - .ai/canonical/${f}`);
          }
        }

        if (result.importedFiles.length > 0) {
          lines.push('  📥 Imported to SQLite:');
          for (const f of result.importedFiles) {
            lines.push(`     - .ai/canonical/${f}`);
          }
        }

        if (result.conflicts.length > 0) {
          lines.push('  ⚠️ Conflicts Detected:');
          for (const c of result.conflicts) {
            lines.push(`     - ${c.filePath} -> Conflict file: ${c.conflictFilePath}`);
          }
        }

        lines.push('================================================================================');
        lines.push('  Status: SUCCESS — Obsidian vault is in sync with machine state.');
        return lines.join('\n');
      }

      case 'export': {
        const result = await this.syncService.sync({
          projectId,
          force,
          direction: 'export_only',
        });
        return `Exported ${result.exportedFiles.length} file(s) to .ai/canonical/. (${result.unchangedFiles.length} unchanged)`;
      }

      case 'import': {
        const result = await this.syncService.sync({
          projectId,
          direction: 'import_only',
        });
        return `Imported ${result.importedFiles.length} modified file(s) from .ai/canonical/ into SQLite.`;
      }

      case 'status': {
        const status = await this.syncService.getStatus(projectId || 'default');
        const lines = [
          '================================================================================',
          `                     OBSIDIAN VAULT STATUS: ${status.projectId}                 `,
          '================================================================================',
          `Total Tracked:    ${status.totalSyncedFiles} file(s)`,
          '--------------------------------------------------------------------------------',
        ];

        if (status.files.length === 0) {
          lines.push('  (Vault has not been synchronized yet. Run `obsidian sync`)');
        } else {
          for (const file of status.files) {
            const icon =
              file.status === 'synced'
                ? '[✓] SYNCED'
                : file.status === 'modified_on_disk'
                ? '[!] MODIFIED'
                : '[✗] MISSING';
            lines.push(`  ${icon.padEnd(16)} : .ai/canonical/${file.filePath} (${file.entityType})`);
          }
        }
        lines.push('================================================================================');
        return lines.join('\n');
      }

      default:
        return this.renderHelp();
    }
  }

  private extractOption(args: string[], flag: string): string | undefined {
    const direct = args.find((a) => a.startsWith(`${flag}=`));
    if (direct) {
      return direct.slice(flag.length + 1);
    }
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }

  private renderHelp(): string {
    return [
      '================================================================================',
      '                          OBSIDIAN ENGINE CLI                                   ',
      '================================================================================',
      'Commands:',
      '  obsidian sync [options]    Bidirectional sync between SQLite and .ai/canonical/',
      '  obsidian export [options]  Export SQLite state to Obsidian Markdown files',
      '  obsidian import [options]  Import manual edits from Obsidian into SQLite',
      '  obsidian status [options]  Inspect sync status of vault files',
      '',
      'Options:',
      '  --project-id=<id>          Specify project ID',
      '  --force                    Force re-export ignoring cache / hash',
      '  --export-only              Only export SQLite to Markdown',
      '  --import-only              Only import Markdown to SQLite',
      '================================================================================',
    ].join('\n');
  }
}
