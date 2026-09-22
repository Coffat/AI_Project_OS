#!/usr/bin/env node

/**
 * AI PROJECT OS - Unified CLI Entrypoint
 *
 * Usage:
 *   ai-project-os mcp [--project-root <path>] [--db-path <path>]
 *   ai-project-os notebook <command> [...]
 *   ai-project-os tasks <command> [...]
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import { SQLiteDatabaseClient } from './database/client.js';
import { ProjectOSMCPServer } from './mcp/server.js';
import { NotebookCLI } from './notebook/notebook-cli.js';
import { TaskCliAPI } from './tasks/task-cli.js';
import { SessionCLI } from './sessions/session-cli.js';
import { ControlCenterService, ApiServer } from './ui/index.js';
import { ArchitectureGuard } from './guard/index.js';
import { DoctorService } from './doctor/index.js';
import { ContextService } from './context/context-service.js';
import { GraphService } from './graph/graph-service.js';
import { ProjectRepository } from './database/repositories/project.repository.js';
import { TaskRepository } from './database/repositories/task.repository.js';

function extractOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

function resolveDbPath(projectRoot: string, explicitDbPath?: string): string {
  if (explicitDbPath) return explicitDbPath;
  const stateDir = path.join(projectRoot, '.ai', 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, 'project-os.sqlite');
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const command = argv[0]?.toLowerCase();

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(`
AI PROJECT OS - Production CLI

USAGE:
  ai-project-os <command> [options]

COMMANDS:
  init           Initialize .ai/ workspace, database schema, and project metadata
  context        Generate token-budgeted L0-L4 context pack for a task
  doctor         Comprehensive health diagnostics and consistency audit
  repair         Self-healing repair for corrupted state, orphaned nodes & sessions
  reindex        Rebuild code intelligence, AST symbol, and module dependency index
  rebuild-graph  Deterministically reconstruct unified 4-graph from project state
  validate       Run complete validation across database, canonical memory & graph
  backup         Create atomic point-in-time state backup with manifest
  restore        Restore project state from a verified backup archive
  session        Session Handoff Manager (start, status, handoff, resume)
  handoff        Convenience shorthand for session handoff and resume
  guard          Anti-Bloat & Architecture Guard evaluation
  ui             Launch Desktop Control Center API server and interface
  mcp            Start the Model Context Protocol (MCP) server over stdio
  notebook       NotebookLM Knowledge Bridge CLI (export, manifest, proposal)
  tasks / task   Task state engine and dev inspection CLI (create, list, inspect)

OPTIONS FOR 'doctor':
  --json                 Output diagnostic report in JSON format
  --project-id <id>      Explicit project ID to diagnose

OPTIONS FOR 'backup':
  --output <dir>         Target directory for backup archive (default: .ai/backups/backup-<timestamp>)

OPTIONS FOR 'restore':
  ai-project-os restore <backupPath>

OPTIONS FOR 'guard':
  --task <id>            Evaluate changes specific to a given task ID
  --strict               Treat 'approval_required' violations as blocking errors
  --json                 Output result in JSON format

OPTIONS FOR 'mcp':
  --project-root <dir>   Path to the project workspace root (default: current directory)
  --db-path <path>       Path to the SQLite database file (default: .ai/state/project-os.sqlite)

EXAMPLES:
  ai-project-os doctor
  ai-project-os repair
  ai-project-os reindex
  ai-project-os rebuild-graph
  ai-project-os validate
  ai-project-os backup
  ai-project-os restore .ai/backups/backup-1710000000000
`);
    return;
  }

  const projectRoot = extractOption(argv, '--project-root') ?? process.cwd();

  switch (command) {
    case 'init': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const dirs = [
        path.join(projectRoot, '.ai'),
        path.join(projectRoot, '.ai', 'canonical'),
        path.join(projectRoot, '.ai', 'canonical', 'decisions'),
        path.join(projectRoot, '.ai', 'state'),
        path.join(projectRoot, '.ai', 'handoff'),
        path.join(projectRoot, '.ai', 'backups'),
      ];
      for (const d of dirs) {
        fs.mkdirSync(d, { recursive: true });
      }
      const client = new SQLiteDatabaseClient(dbPath);
      const projectRepo = new ProjectRepository(client.db);
      let project = projectRepo.findByRootPath(projectRoot);
      if (!project) {
        const projectName = path.basename(projectRoot);
        project = projectRepo.create({
          name: projectName,
          rootPath: projectRoot,
          description: 'AI Project OS Workspace',
        });
      }
      console.log(`\n✓ AI PROJECT OS initialized successfully.`);
      console.log(`Workspace:      ${projectRoot}`);
      console.log(`Project ID:     ${project.id}`);
      console.log(`State Database: ${dbPath}\n`);
      client.close();
      break;
    }

    case 'context': {
      const taskId = argv.find((a, i) => i > 0 && !a.startsWith('--'));
      if (!taskId) {
        console.error('Usage: ai-project-os context <taskId> [--budget <number>]');
        process.exitCode = 1;
        break;
      }
      const budgetStr = extractOption(argv, '--budget');
      const budget = budgetStr ? parseInt(budgetStr, 10) : 8000;
      const explicitDbPath = extractOption(argv, '--db-path');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);
      const graphService = new GraphService(client.db);
      const contextService = new ContextService(client.db, graphService, projectRoot);
      try {
        const pack = await contextService.getContext(taskId, budget);
        console.log(`\n=== TASK CONTEXT: ${taskId} ===`);
        console.log(`Budget Tokens: ${budget} (Selected: ${pack.selected_context_tokens}, Estimated: ${pack.token_estimate})`);
        const compRatio = pack.compression_ratio !== undefined ? `${(pack.compression_ratio * 100).toFixed(2)}%` : 'N/A';
        console.log(`Compression:   ${compRatio}`);
        console.log('--------------------------------------------------');
        console.log(pack.context);
        console.log('==================================================\n');
      } catch (err: unknown) {
        console.error(`Failed to generate context: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
      client.close();
      break;
    }

    case 'mcp': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const server = new ProjectOSMCPServer({
        db: client.db,
        projectRoot,
      });

      // Start MCP JSON-RPC server on stdio
      await server.start();
      break;
    }

    case 'session': {
      const dbPath = resolveDbPath(projectRoot);
      const client = new SQLiteDatabaseClient(dbPath);
      const cli = new SessionCLI({
        db: client.db,
        projectRoot,
      });
      await cli.run(argv.slice(1));
      client.close();
      break;
    }

    case 'handoff': {
      const dbPath = resolveDbPath(projectRoot);
      const client = new SQLiteDatabaseClient(dbPath);
      const cli = new SessionCLI({
        db: client.db,
        projectRoot,
      });
      const sub = argv[1]?.toLowerCase();
      if (sub === 'submit') {
        await cli.run(['handoff', ...argv.slice(2)]);
      } else if (sub === 'resume') {
        await cli.run(['resume', ...argv.slice(2)]);
      } else {
        await cli.run(['handoff', ...argv.slice(1)]);
      }
      client.close();
      break;
    }

    case 'notebook': {
      const dbPath = resolveDbPath(projectRoot);
      const client = new SQLiteDatabaseClient(dbPath);
      const cli = new NotebookCLI(client.db, projectRoot);
      const output = await cli.run(argv.slice(1));
      console.log(output);
      client.close();
      break;
    }

    case 'task':
    case 'tasks': {
      const dbPath = resolveDbPath(projectRoot);
      const client = new SQLiteDatabaseClient(dbPath);
      const cli = new TaskCliAPI(client.db);
      const projectRepo = new ProjectRepository(client.db);
      const taskRepo = new TaskRepository(client.db);
      const sub = argv[1]?.toLowerCase();

      if (sub === 'inspect' && argv[2]) {
        const output = await cli.inspectTask(argv[2]);
        console.log(output);
      } else if (sub === 'create') {
        const title = extractOption(argv, '--title') || argv.find((a, i) => i > 1 && !a.startsWith('--'));
        if (!title) {
          console.error('Error: Task title is required. Usage: ai-project-os task create --title "Title"');
          process.exitCode = 1;
        } else {
          const goal = extractOption(argv, '--goal');
          const description = extractOption(argv, '--description');
          const priority = (extractOption(argv, '--priority') as 'low' | 'medium' | 'high' | 'critical') || 'medium';
          const assignedAgent = extractOption(argv, '--agent') || extractOption(argv, '--assigned-agent');

          let projectId = extractOption(argv, '--project-id');
          if (!projectId) {
            const project = projectRepo.findByRootPath(projectRoot) || projectRepo.list()[0];
            if (project) {
              projectId = project.id;
            } else {
              const created = projectRepo.create({
                name: path.basename(projectRoot),
                rootPath: projectRoot,
                description: 'Active workspace',
              });
              projectId = created.id;
            }
          }

          const output = await cli.createTask({
            projectId,
            title,
            goal,
            description,
            priority,
            assignedAgent,
          });
          console.log(output);
        }
      } else if (sub === 'list') {
        const statusFilter = extractOption(argv, '--status') as any;
        const project = projectRepo.findByRootPath(projectRoot) || projectRepo.list()[0];
        const tasks = project ? taskRepo.listByProject(project.id, { status: statusFilter }) : [];

        console.log('\n=== TASKS ===');
        if (tasks.length === 0) {
          console.log('No tasks found.');
        } else {
          for (const t of tasks) {
            console.log(`[${t.status.toUpperCase()}] [${t.priority.toUpperCase()}] ${t.id}: ${t.title}`);
          }
        }
        console.log('=============\n');
      } else if (sub === 'start' && argv[2]) {
        const sessionCli = new SessionCLI({ db: client.db, projectRoot });
        await sessionCli.run(['start', ...argv.slice(2)]);
      } else if (sub === 'complete' && argv[2]) {
        try {
          taskRepo.transitionStatus(argv[2], 'done');
          console.log(`\n✓ Task '${argv[2]}' marked as COMPLETED.\n`);
        } catch (err: unknown) {
          console.error(`Failed to complete task: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
      } else {
        console.log('Usage:');
        console.log('  ai-project-os task create --title <title> [--goal <goal>] [--priority <p>]');
        console.log('  ai-project-os task list [--status <status>]');
        console.log('  ai-project-os task inspect <taskId>');
        console.log('  ai-project-os task start <taskId>');
        console.log('  ai-project-os task complete <taskId>');
      }
      client.close();
      break;
    }

    case 'ui':
    case 'desktop': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const portStr = extractOption(argv, '--port');
      const port = portStr ? parseInt(portStr, 10) : 4173;
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const service = new ControlCenterService({
        db: client.db,
        projectRoot,
      });

      const staticDir = path.join(projectRoot, 'ui', 'dist');
      const server = new ApiServer(service, {
        port,
        staticDir: fs.existsSync(staticDir) ? staticDir : undefined,
      });

      const { url } = await server.start();
      console.log(`\n AI PROJECT OS - Desktop Control Center\n Server active at: ${url}`);
      console.log(` API endpoints available at: ${url}/api/dashboard\n`);

      const noOpen = argv.includes('--no-open');
      if (!noOpen) {
        import('node:child_process').then(({ exec }) => {
          const startCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
          exec(`${startCmd} ${url}`);
        }).catch(() => {});
      }
      break;
    }

    case 'guard': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const taskId = extractOption(argv, '--task');
      const strictMode = argv.includes('--strict');
      const jsonMode = argv.includes('--json');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const guard = new ArchitectureGuard(projectRoot, client.db);
      const report = await guard.evaluate({
        taskId,
        strictMode,
      });

      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n=== AI PROJECT OS: ARCHITECTURE GUARD REPORT ===');
        console.log(`Status: ${report.passed ? 'PASSED' : report.blocked ? 'BLOCKED' : 'NEEDS APPROVAL'}`);
        console.log(
          `Summary: ${report.summary.errors} Error(s), ${report.summary.approvalRequired} Approval Required, ${report.summary.warnings} Warning(s)`
        );
        console.log('--------------------------------------------------');
        if (report.violations.length === 0) {
          console.log('No architecture or anti-bloat violations detected.');
        } else {
          for (const v of report.violations) {
            console.log(`[${v.severity.toUpperCase()}] ${v.category}: ${v.message}`);
            if (v.suggestion) {
              console.log(`   Suggestion: ${v.suggestion}`);
            }
          }
        }
        console.log('==================================================\n');
      }

      client.close();
      if (report.blocked) {
        process.exitCode = 1;
      }
      break;
    }

    case 'doctor': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const explicitProjectId = extractOption(argv, '--project-id');
      const jsonMode = argv.includes('--json');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      const report = await doctor.diagnose(explicitProjectId);

      if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('\n=== AI PROJECT OS: DOCTOR DIAGNOSTIC REPORT ===');
        console.log(`Overall Health: ${report.overallStatus.toUpperCase()}`);
        console.log(
          `Summary: ${report.summary.passed} Passed, ${report.summary.warnings} Warning(s), ${report.summary.errors} Error(s)`
        );
        console.log('--------------------------------------------------');
        for (const check of report.checks) {
          const icon = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
          console.log(`${icon} [${check.category.toUpperCase()}] ${check.name}: ${check.message}`);
          if (check.remedy) {
            console.log(`    → Remedy: ${check.remedy}`);
          }
        }
        if (report.recommendations.length > 0) {
          console.log('\nRecommendations:');
          for (const rec of report.recommendations) {
            console.log(` - ${rec}`);
          }
        }
        console.log('==================================================\n');
      }

      client.close();
      if (report.overallStatus === 'corrupted') {
        process.exitCode = 1;
      }
      break;
    }

    case 'repair': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const explicitProjectId = extractOption(argv, '--project-id');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      console.log('\nRunning self-healing state repair routines...');
      const report = await doctor.repair(explicitProjectId);

      console.log('=== AI PROJECT OS: REPAIR COMPLETED ===');
      if (report.repairedItems.length === 0) {
        console.log('No repair actions required; all state is intact.');
      } else {
        for (const item of report.repairedItems) {
          console.log(`✓ ${item}`);
        }
      }
      if (report.warnings.length > 0) {
        console.log('\nWarnings:');
        for (const w of report.warnings) {
          console.log(`⚠ ${w}`);
        }
      }
      console.log('=======================================\n');

      client.close();
      break;
    }

    case 'reindex': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const explicitProjectId = extractOption(argv, '--project-id');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      console.log('\nScanning and reindexing project codebase...');
      const res = await doctor.reindex(explicitProjectId);

      console.log(`\n=== REINDEX COMPLETE ===`);
      console.log(`Files Indexed:    ${res.filesIndexed}`);
      console.log(`Symbols Indexed:  ${res.symbolsIndexed}`);
      console.log(`Edges Created:    ${res.edgesCreated}`);
      console.log(`Duration:         ${res.durationMs.toFixed(2)}ms`);
      console.log(`========================\n`);

      client.close();
      break;
    }

    case 'rebuild-graph': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const explicitProjectId = extractOption(argv, '--project-id');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      console.log('\nReconstructing unified 4-graph from project state...');
      const res = await doctor.rebuildGraph(explicitProjectId);

      console.log(`\n=== GRAPH REBUILD COMPLETE ===`);
      console.log(`Nodes Created:  ${res.nodesCreated}`);
      console.log(`Edges Created:  ${res.edgesCreated}`);
      console.log(`Duration:       ${res.durationMs.toFixed(2)}ms`);
      console.log(`==============================\n`);

      client.close();
      break;
    }

    case 'validate': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const explicitProjectId = extractOption(argv, '--project-id');
      const jsonMode = argv.includes('--json');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      const res = await doctor.validate(explicitProjectId);

      if (jsonMode) {
        console.log(JSON.stringify(res, null, 2));
      } else {
        console.log(`\n=== PROJECT STATE VALIDATION ===`);
        console.log(`Status: ${res.valid ? 'VALID (PASSED)' : 'INVALID (FAILED)'}`);
        console.log(`Database Integrity: ${res.databaseValid ? 'OK' : 'FAILED'}`);
        console.log(`Canonical Memory:   ${res.memoryReport.isValid ? 'OK' : 'ISSUES DETECTED'}`);
        console.log(`Knowledge Graph:    ${res.graphReport.isValid ? 'OK' : 'ISSUES DETECTED'}`);
        if (res.issues.length > 0) {
          console.log('\nIssues:');
          for (const issue of res.issues) {
            console.log(` - ${issue}`);
          }
        }
        console.log(`================================\n`);
      }

      client.close();
      if (!res.valid) {
        process.exitCode = 1;
      }
      break;
    }

    case 'backup': {
      const explicitDbPath = extractOption(argv, '--db-path');
      const outputDir = extractOption(argv, '--output');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      console.log('\nCreating atomic snapshot backup...');
      const res = await doctor.backup(outputDir);

      console.log(`\n=== BACKUP ARCHIVE CREATED ===`);
      console.log(`Target:       ${res.backupDir}`);
      console.log(`Files Saved:  ${res.manifest.files.length}`);
      console.log(`Database:     ${res.manifest.databaseIncluded ? 'Included (VACUUM INTO)' : 'Not included'}`);
      console.log(`Duration:     ${res.durationMs.toFixed(2)}ms`);
      console.log(`==============================\n`);

      client.close();
      break;
    }

    case 'restore': {
      const backupPath = argv[1];
      if (!backupPath) {
        console.error('Usage: ai-project-os restore <backupPath>');
        process.exitCode = 1;
        break;
      }

      const explicitDbPath = extractOption(argv, '--db-path');
      const dbPath = resolveDbPath(projectRoot, explicitDbPath);
      const client = new SQLiteDatabaseClient(dbPath);

      const doctor = new DoctorService(client.db, projectRoot);
      console.log(`\nRestoring project state from '${backupPath}'...`);
      const res = await doctor.restore(backupPath);

      console.log(`\n=== RESTORE COMPLETED ===`);
      console.log(`Status:              ${res.success ? 'SUCCESS' : 'FAILED'}`);
      console.log(`Files Restored:      ${res.filesRestored}`);
      console.log(`Database Integrity:  ${res.databaseIntegrity}`);
      if (res.preRestoreBackupDir) {
        console.log(`Pre-restore Safety:  ${res.preRestoreBackupDir}`);
      }
      console.log(`=========================\n`);

      client.close();
      if (!res.success) {
        process.exitCode = 1;
      }
      break;
    }

    default: {
      console.error(`Unknown command: ${command}. Run 'ai-project-os --help' for available commands.`);
      process.exitCode = 1;
    }
  }
}

// If invoked directly from terminal
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
