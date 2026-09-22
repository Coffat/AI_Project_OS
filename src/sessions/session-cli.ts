import { DatabaseSync } from 'node:sqlite';
import { SessionManager } from './session-manager.js';

export interface SessionCLIDependencies {
  db: DatabaseSync;
  projectRoot?: string;
}

function extractOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

export class SessionCLI {
  private readonly manager: SessionManager;

  constructor(deps: SessionCLIDependencies) {
    this.manager = new SessionManager(deps, deps.projectRoot);
  }

  public async run(args: string[]): Promise<void> {
    const subCommand = args[0]?.toLowerCase();

    if (!subCommand || subCommand === '--help' || subCommand === '-h' || subCommand === 'help') {
      this.printHelp();
      return;
    }

    switch (subCommand) {
      case 'start':
        await this.handleStart(args.slice(1));
        break;
      case 'status':
        await this.handleStatus(args.slice(1));
        break;
      case 'handoff':
        await this.handleHandoff(args.slice(1));
        break;
      case 'resume':
        await this.handleResume(args.slice(1));
        break;
      case 'pause':
        await this.handlePause(args.slice(1));
        break;
      default:
        console.error(`Unknown session command: ${subCommand}`);
        this.printHelp();
        process.exitCode = 1;
    }
  }

  private async handleStart(args: string[]): Promise<void> {
    const taskId = args.find((a) => !a.startsWith('--'));
    if (!taskId) {
      console.error('Error: Task ID is required. Usage: session start <TASK-ID>');
      process.exitCode = 1;
      return;
    }

    const provider = extractOption(args, '--provider') ?? 'antigravity';
    const agent = extractOption(args, '--agent') ?? 'Agent';
    const accountLabel = extractOption(args, '--account');

    try {
      const result = await this.manager.startSession(taskId, {
        provider,
        agent,
        accountLabel,
      });

      console.log('\n=== SESSION STARTED ===');
      console.log(`Session ID:      ${result.session.id}`);
      console.log(`Task ID:        [${result.task.id}] ${result.task.title}`);
      console.log(`Provider/Agent:  ${result.session.provider} / ${result.session.agent}`);
      if (result.session.accountLabel) {
        console.log(`Account:         ${result.session.accountLabel}`);
      }
      console.log(`Git State:       branch=${result.continuity.gitState.branch ?? 'N/A'}, dirty=${result.continuity.gitState.isDirty}`);
      console.log(`Continuity:      ${result.continuity.isConsistent ? 'Consistent' : 'Mismatches Detected'}`);
      if (result.continuity.mismatches.length > 0) {
        console.log('Mismatches:');
        for (const m of result.continuity.mismatches) {
          console.log(`  - [${m.severity.toUpperCase()}] ${m.message}`);
        }
      }
      console.log(`Next Action:     ${result.nextAction}`);
      console.log('=======================\n');
    } catch (err: unknown) {
      console.error(`Failed to start session: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  private async handleStatus(args: string[]): Promise<void> {
    const sessionId = extractOption(args, '--session-id');

    try {
      const statusView = await this.manager.getStatus(sessionId);
      const session = statusView.session;

      console.log('\n=== SESSION STATUS ===');
      console.log(`Session ID:      ${session.id}`);
      console.log(`Status:          ${session.status}`);
      console.log(`Provider/Agent:  ${session.provider} / ${session.agent}`);
      if (session.accountLabel) {
        console.log(`Account:         ${session.accountLabel}`);
      }
      console.log(`Task:            ${statusView.task ? `[${statusView.task.id}] ${statusView.task.title} (${statusView.task.status})` : 'None'}`);
      console.log(`Started At:      ${new Date(session.startedAt).toISOString()}`);
      if (session.endedAt) {
        console.log(`Ended At:        ${new Date(session.endedAt).toISOString()}`);
      }
      if (statusView.latestHandoff) {
        console.log(`Latest Handoff:  ${statusView.latestHandoff.id} by ${statusView.latestHandoff.agentIdentity}`);
        console.log(`Next Action:     ${statusView.latestHandoff.nextAction}`);
      }
      if (statusView.continuity && statusView.continuity.mismatches.length > 0) {
        console.log('Continuity Warnings:');
        for (const m of statusView.continuity.mismatches) {
          console.log(`  - [${m.severity.toUpperCase()}] ${m.message}`);
        }
      }
      console.log('======================\n');
    } catch (err: unknown) {
      console.error(`Failed to get session status: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  private async handleHandoff(args: string[]): Promise<void> {
    const completed = extractOption(args, '--completed') ?? 'Work recorded via CLI session handoff';
    const next = extractOption(args, '--next') ?? 'Continue task implementation';
    const objective = extractOption(args, '--objective');
    const blockers = extractOption(args, '--blockers');
    const sessionId = extractOption(args, '--session-id');

    try {
      const result = await this.manager.endSession(
        {
          objective,
          completedWork: completed,
          nextAction: next,
          blockers,
          status: 'handoff',
        },
        sessionId
      );

      console.log('\n=== SESSION HANDOFF SAVED ===');
      console.log(`Session ID:      ${result.session.id} (status: ${result.session.status})`);
      console.log(`Handoff ID:      ${result.handoff.id}`);
      console.log(`Task ID:        [${result.task.id}] (status: ${result.task.status})`);
      console.log(`Completed:       ${result.handoff.completedWork}`);
      console.log(`Next Action:     ${result.handoff.nextAction}`);
      console.log('=============================\n');
    } catch (err: unknown) {
      console.error(`Failed to record handoff: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  private async handleResume(args: string[]): Promise<void> {
    const taskId = args.find((a) => !a.startsWith('--'));
    if (!taskId) {
      console.error('Error: Task ID is required. Usage: session resume <TASK-ID>');
      process.exitCode = 1;
      return;
    }

    const provider = extractOption(args, '--provider') ?? 'antigravity';
    const agent = extractOption(args, '--agent') ?? 'Agent';
    const accountLabel = extractOption(args, '--account');
    const handoffId = extractOption(args, '--handoff-id');

    try {
      const result = await this.manager.resumeSession(taskId, {
        provider,
        agent,
        accountLabel,
        handoffId,
      });

      console.log('\n=== SESSION RESUMED ===');
      console.log(`New Session ID:  ${result.session.id}`);
      console.log(`Task ID:        [${result.task.id}] ${result.task.title} (status: ${result.task.status})`);
      console.log(`Resuming Agent:  ${result.session.provider} / ${result.session.agent}`);
      if (result.continuity.latestHandoff) {
        console.log(`Prior Handoff:   ${result.continuity.latestHandoff.id} (by ${result.continuity.latestHandoff.agentIdentity})`);
      }
      console.log(`Next Action:     ${result.nextAction}`);
      console.log('=======================\n');
    } catch (err: unknown) {
      console.error(`Failed to resume session: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  private async handlePause(args: string[]): Promise<void> {
    const sessionId = extractOption(args, '--session-id');
    try {
      const paused = await this.manager.pauseSession(sessionId);
      console.log(`Session ${paused.id} paused.`);
    } catch (err: unknown) {
      console.error(`Failed to pause session: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }

  private printHelp(): void {
    console.log(`
AI PROJECT OS - Session Handoff Manager CLI

USAGE:
  ai-project-os session <command> [options]

COMMANDS:
  start <TASK-ID>     Start a new execution session for a task
  status              Check current active or target session status
  handoff             End session and record standard handoff report
  resume <TASK-ID>    Resume a task in a fresh session from latest handoff
  pause               Pause an active session

OPTIONS:
  --provider <p>      AI provider (antigravity, claude, gemini, openai, local)
  --agent <a>         Agent identifier / name (default: Agent)
  --account <lbl>     Account label metadata
  --completed <text>  Completed work summary for handoff
  --next <text>       Recommended next action
  --blockers <text>   Active blocker notes
  --session-id <id>   Target specific session ID

EXAMPLES:
  ai-project-os session start TASK-001 --provider claude --agent ClaudeCode
  ai-project-os session status
  ai-project-os session handoff --completed "Refactored DB" --next "Run migrations"
  ai-project-os session resume TASK-001 --provider antigravity --agent Antigravity
`);
  }
}
