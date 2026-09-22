import { exec } from 'node:child_process';
import { CommandRunResult } from '../core/types.js';
import { SecurityGuard } from '../core/security-guard.js';

export interface ICommandRunner {
  run(command: string, cwd: string, env?: Record<string, string>): Promise<CommandRunResult>;
}

export class ProcessCommandRunner implements ICommandRunner {
  constructor(private readonly defaultTimeoutMs = 120_000) {}

  public run(
    command: string,
    cwd: string,
    env?: Record<string, string>
  ): Promise<CommandRunResult> {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      // Validate command safety against injection and prohibited binaries
      try {
        SecurityGuard.validateCommand(command);
      } catch (validationErr) {
        const finishedAt = Date.now();
        const errMessage = validationErr instanceof Error ? validationErr.message : String(validationErr);
        resolve({
          command,
          started_at: startedAt,
          finished_at: finishedAt,
          exit_code: 126, // Command invoked cannot execute / permission denied
          stdout: '',
          stderr: `Security violation: ${errMessage}`,
        });
        return;
      }

      exec(
        command,
        {
          cwd,
          env: { ...process.env, ...env },
          timeout: this.defaultTimeoutMs,
          maxBuffer: 20 * 1024 * 1024, // 20MB buffer
        },
        (error, stdout, stderr) => {
          const finishedAt = Date.now();
          const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          const rawStdout = stdout ? stdout.toString() : '';
          const rawStderr = stderr ? stderr.toString() : (error ? error.message : '');

          resolve({
            command,
            started_at: startedAt,
            finished_at: finishedAt,
            exit_code: exitCode,
            stdout: SecurityGuard.scrubSecrets(rawStdout),
            stderr: SecurityGuard.scrubSecrets(rawStderr),
          });
        }
      );
    });
  }
}

export interface FakeCommandResponse {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  delayMs?: number;
}

export type FakeCommandHandler = (
  command: string,
  cwd: string
) => Promise<FakeCommandResponse | null> | FakeCommandResponse | null;

export class FakeCommandRunner implements ICommandRunner {
  private commandMap = new Map<string, FakeCommandResponse>();
  private defaultResponse: FakeCommandResponse = { exitCode: 0, stdout: 'OK', stderr: '' };
  private customHandler?: FakeCommandHandler;
  private history: { command: string; cwd: string; result: CommandRunResult }[] = [];

  public setCommandResult(commandOrPrefix: string, response: FakeCommandResponse): this {
    this.commandMap.set(commandOrPrefix, response);
    return this;
  }

  public setDefaultResponse(response: FakeCommandResponse): this {
    this.defaultResponse = response;
    return this;
  }

  public setHandler(handler: FakeCommandHandler): this {
    this.customHandler = handler;
    return this;
  }

  public getHistory(): { command: string; cwd: string; result: CommandRunResult }[] {
    return [...this.history];
  }

  public clearHistory(): void {
    this.history = [];
  }

  public async run(
    command: string,
    cwd: string,
    _env?: Record<string, string>
  ): Promise<CommandRunResult> {
    const startedAt = Date.now();

    let resp: FakeCommandResponse = this.defaultResponse;

    if (this.customHandler) {
      const handlerResp = await this.customHandler(command, cwd);
      if (handlerResp !== null && handlerResp !== undefined) {
        resp = handlerResp;
      }
    } else {
      // Check exact match first
      if (this.commandMap.has(command)) {
        resp = this.commandMap.get(command)!;
      } else {
        // Check prefix match
        for (const [prefix, mappedResp] of this.commandMap.entries()) {
          if (command.startsWith(prefix)) {
            resp = mappedResp;
            break;
          }
        }
      }
    }

    if (resp.delayMs && resp.delayMs > 0) {
      await new Promise((r) => setTimeout(r, resp.delayMs));
    }

    const finishedAt = Date.now();
    const result: CommandRunResult = {
      command,
      started_at: startedAt,
      finished_at: finishedAt,
      exit_code: resp.exitCode ?? 0,
      stdout: resp.stdout ?? '',
      stderr: resp.stderr ?? '',
    };

    this.history.push({ command, cwd, result });
    return result;
  }
}
