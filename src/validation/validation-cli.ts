import type { DatabaseSync } from 'node:sqlite';
import { ValidationService } from './validation-service.js';
import { ICommandRunner } from './command-runner.js';

export class ValidationCLI {
  private readonly validationService: ValidationService;

  constructor(db: DatabaseSync, projectRoot: string, runner?: ICommandRunner) {
    this.validationService = new ValidationService(db, projectRoot, runner);
  }

  public async run(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.renderHelp();
    }

    // Normalize: if first arg is 'validate', shift past it
    let idx = 0;
    if (args[idx]?.toLowerCase() === 'validate') {
      idx++;
    }

    const subCommand = args[idx]?.toLowerCase();
    if (subCommand === 'task') {
      const taskId = args[idx + 1];
      if (!taskId) {
        return 'Error: Task ID is required. Usage: validate task <task-id> [options]';
      }

      const skipBuild = args.includes('--skip-build');
      const skipLint = args.includes('--skip-lint');
      const skipTypecheck = args.includes('--skip-typecheck');
      const testCommand = this.extractOption(args, '--test-cmd');
      const projectId = this.extractOption(args, '--project-id');

      try {
        const result = await this.validationService.validateTask(taskId, {
          projectId,
          skipBuild,
          skipLint,
          skipTypecheck,
          testCommand,
        });

        const lines: string[] = [
          '================================================================================',
          `                     VALIDATION PIPELINE: ${taskId}                            `,
          '================================================================================',
        ];

        if (result.stale_detected) {
          lines.push(`[!] STALE WARNING: ${result.stale_reason}`);
          lines.push('--------------------------------------------------------------------------------');
        }

        for (const run of result.runs) {
          const duration = run.finished_at - run.started_at;
          const statusIcon = run.status === 'passed' ? '[✓]' : '[✗]';
          const exitInfo = run.exit_code !== 0 ? ` (exit code ${run.exit_code})` : '';
          lines.push(
            `  ${statusIcon} ${run.step.padEnd(16)} : ${run.status.toUpperCase()}${exitInfo} [${duration}ms]`
          );
          if (run.error) {
            lines.push(`      Error: ${run.error.split('\n')[0]}`);
          }
        }

        lines.push('--------------------------------------------------------------------------------');
        if (result.success) {
          lines.push('  Result: SUCCESS — All quality gates passed! Task transitioned to DONE.');
        } else {
          lines.push('  Result: FAILED — Quality gate breached. Task transitioned to BLOCKED.');
          if (result.blocker) {
            lines.push('  Blocker Created:');
            lines.push(`    - Command:         ${result.blocker.command}`);
            lines.push(`    - Error:           ${result.blocker.error.split('\n')[0]}`);
            lines.push(`    - Affected Files:  ${result.blocker.affected_files.join(', ') || 'none'}`);
            lines.push(`    - Next Hypothesis: ${result.blocker.next_hypothesis}`);
          }
        }
        lines.push('================================================================================');

        return lines.join('\n');
      } catch (err) {
        return `Validation Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (subCommand === 'stale') {
      const taskId = args[idx + 1];
      if (!taskId) {
        return 'Error: Task ID is required. Usage: validate stale <task-id>';
      }

      try {
        const stale = await this.validationService.isValidationStale(taskId);
        if (stale.isStale) {
          return `[STALE] Task ${taskId} validation is stale: ${stale.reason}\nChanged files: ${stale.changedFiles.join(', ')}`;
        }
        return `[FRESH] Task ${taskId} validation is fresh and up-to-date.`;
      } catch (err) {
        return `Validation Check Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    return this.renderHelp();
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
      '                          VALIDATION ENGINE CLI                                 ',
      '================================================================================',
      'Commands:',
      '  validate task <task-id> [options]    Run full quality gate pipeline for a task',
      '  validate stale <task-id>             Check if task validation status is stale',
      '',
      'Options:',
      '  --skip-lint                          Skip linter validation gate',
      '  --skip-typecheck                     Skip TypeScript typecheck gate',
      '  --skip-build                         Skip build compilation gate',
      '  --test-cmd=<command>                 Override default test command',
      '  --project-id=<id>                    Specify project ID',
      '================================================================================',
    ].join('\n');
  }
}
