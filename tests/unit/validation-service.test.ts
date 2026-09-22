import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { ValidationRepository } from '../../src/database/repositories/validation.repository.js';
import { EventRepository } from '../../src/database/repositories/event.repository.js';
import { FakeCommandRunner } from '../../src/validation/command-runner.js';
import { ValidationService } from '../../src/validation/validation-service.js';
import { ValidationCLI } from '../../src/validation/validation-cli.js';

describe('Phase 8: Validation Engine (Automated Quality Gate & Deterministic Pipeline)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let taskRepo: TaskRepository;
  let validationRepo: ValidationRepository;
  let eventRepo: EventRepository;
  let fakeRunner: FakeCommandRunner;
  let validationService: ValidationService;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-validation-test-'));

    // Create required canonical structure for git inspection and memory updates
    const canonicalDir = path.join(tempDir, '.ai', 'canonical');
    fs.mkdirSync(canonicalDir, { recursive: true });
    fs.writeFileSync(path.join(canonicalDir, 'PROJECT.md'), '# Test Project\nCanonical Project Documentation\n');
    fs.writeFileSync(path.join(canonicalDir, 'CONSTITUTION.md'), '# Constitution\nStrict Deterministic Quality Gates\n');
    fs.writeFileSync(path.join(canonicalDir, 'ARCHITECTURE.md'), '# Architecture\nLayered modular design\n');
    fs.writeFileSync(path.join(canonicalDir, 'CONSTRAINTS.md'), '# Constraints\nZero AI hallucinations on exit codes\n');

    // Sample src file
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'auth.ts'), 'export function authenticate() { return true; }\n');

    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });
    const projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    validationRepo = new ValidationRepository(client.db);
    eventRepo = new EventRepository(client.db);

    const project = projectRepo.create({
      name: 'Validation Pipeline Project',
      rootPath: tempDir,
    });
    projectId = project.id;

    fakeRunner = new FakeCommandRunner();
    // Default: all commands exit with code 0
    fakeRunner.setDefaultResponse({ exitCode: 0, stdout: 'Command executed successfully', stderr: '' });

    validationService = new ValidationService(client.db, tempDir, fakeRunner);
  });

  afterEach(() => {
    client.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('orchestrates complete validation pipeline: tests -> lint -> typecheck -> build -> git_diff -> memory -> task done', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Implement OAuth Token Refresh',
      description: 'Add refresh token rotation and revoke endpoint.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');
    taskRepo.attachFile(task.id, 'src/auth.ts');

    const result = await validationService.validateTask(task.id);

    expect(result.success).toBe(true);
    expect(result.status).toBe('passed');
    expect(result.runs.length).toBeGreaterThanOrEqual(6);

    // Verify all steps passed
    const stepNames = result.runs.map((r) => r.step);
    expect(stepNames).toContain('tests');
    expect(stepNames).toContain('lint');
    expect(stepNames).toContain('typecheck');
    expect(stepNames).toContain('build');
    expect(stepNames).toContain('git_diff');
    expect(stepNames).toContain('memory_update');

    // Verify task transitioned to done
    const updatedTask = taskRepo.findById(task.id);
    expect(updatedTask?.status).toBe('done');

    // Verify task.completed audit event was recorded
    const events = eventRepo.listByAggregate('task', task.id);
    expect(events.some((e) => e.eventType === 'task.completed')).toBe(true);

    // Verify validation_runs stored in DB
    const dbRuns = validationRepo.listByTask(task.id);
    expect(dbRuns.length).toBeGreaterThanOrEqual(6);
    const testRun = dbRuns.find((r) => r.validatorType === 'test');
    expect(testRun).toBeDefined();
    expect(testRun?.status).toBe('passed');
    expect(testRun?.exitCode).toBe(0);
    expect(testRun?.command).toBe('pnpm test');
  });

  it('blocks task completion when test suite fails and creates structured blocker', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Fix Payment Webhook Concurrency',
      description: 'Prevent double credit on duplicate webhook delivery.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');
    taskRepo.attachFile(task.id, 'src/payment.ts');

    // Simulate test failure
    fakeRunner.setCommandResult('pnpm test', {
      exitCode: 1,
      stdout: 'FAIL tests/unit/payment.test.ts',
      stderr: 'AssertionError: expected double charge to throw, but succeeded',
    });

    const result = await validationService.validateTask(task.id);

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.blocker).toBeDefined();
    expect(result.blocker?.command).toBe('pnpm test');
    expect(result.blocker?.error).toContain('AssertionError: expected double charge to throw');
    expect(result.blocker?.next_hypothesis).toContain('failing test assertions');

    // Verify task was NOT completed; transitioned testing -> blocked
    const updatedTask = taskRepo.findById(task.id);
    expect(updatedTask?.status).toBe('blocked');

    // Verify blocker recorded in task_blockers
    const blockers = taskRepo.listBlockers(task.id, true);
    expect(blockers.length).toBe(1);
    expect(blockers[0]?.reason).toContain('[Validation Gate Failed: tests]');
    expect(blockers[0]?.reason).toContain('pnpm test');
    expect(blockers[0]?.reason).toContain('JSON:');

    // Verify task.blocked audit event recorded
    const events = eventRepo.listByAggregate('task', task.id);
    expect(events.some((e) => e.eventType === 'task.blocked')).toBe(true);

    // Subsequent pipeline steps (lint, typecheck, build) must not have run after test failure
    const stepNames = result.runs.map((r) => r.step);
    expect(stepNames).toEqual(['tests']);
  });

  it('blocks task completion when typecheck fails with compiler errors', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Refactor Database Schema Models',
      description: 'Migrate legacy types to modern Pydantic/Zod schemas.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');
    taskRepo.attachFile(task.id, 'src/models.ts');

    // Tests and lint pass, but typecheck fails
    fakeRunner.setCommandResult('pnpm typecheck', {
      exitCode: 2,
      stdout: '',
      stderr: "error TS2322: Type 'string' is not assignable to type 'number'.",
    });

    const result = await validationService.validateTask(task.id);

    expect(result.success).toBe(false);
    expect(result.blocker?.command).toBe('pnpm typecheck');
    expect(result.blocker?.error).toContain('error TS2322');
    expect(result.blocker?.next_hypothesis).toContain('TypeScript compiler');

    const updatedTask = taskRepo.findById(task.id);
    expect(updatedTask?.status).toBe('blocked');

    const blockers = taskRepo.listBlockers(task.id, true);
    expect(blockers.length).toBe(1);
    expect(blockers[0]?.reason).toContain('error TS2322');
  });

  it('blocks task completion when build fails', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Compile Production Bundle',
      description: 'Build distribution artifacts.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');

    fakeRunner.setCommandResult('pnpm build', {
      exitCode: 1,
      stdout: 'Building...',
      stderr: 'Build error: Out of memory or missing entrypoint dist/index.js',
    });

    const result = await validationService.validateTask(task.id);

    expect(result.success).toBe(false);
    expect(result.blocker?.command).toBe('pnpm build');
    expect(result.blocker?.next_hypothesis).toContain('compilation errors');

    const updatedTask = taskRepo.findById(task.id);
    expect(updatedTask?.status).toBe('blocked');
  });

  it('detects stale validation when code files change after the last test run', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Real-time WebSocket Push',
      description: 'Implement WebSocket broadcaster for state updates.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');

    const filePath = path.join(tempDir, 'src', 'socket.ts');
    fs.writeFileSync(filePath, 'export const socketVersion = 1;\n');
    taskRepo.attachFile(task.id, 'src/socket.ts');

    // Step 1: Run tests and pass
    const initialTest = await validationService.runTests({
      taskId: task.id,
      projectId,
      affectedFiles: ['src/socket.ts'],
    });
    expect(initialTest.status).toBe('passed');

    // Check staleness immediately: should NOT be stale
    const freshCheck = await validationService.isValidationStale(task.id);
    expect(freshCheck.isStale).toBe(false);

    // Step 2: Code modified AFTER the test run
    // Sleep briefly and modify the file so mtime is strictly greater than test finished_at
    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.appendFileSync(filePath, 'export const socketVersion = 2; // modified!\n');

    // Step 3: Check staleness again: must detect code change!
    const staleCheck = await validationService.isValidationStale(task.id);
    expect(staleCheck.isStale).toBe(true);
    expect(staleCheck.changedFiles).toContain('src/socket.ts');
    expect(staleCheck.reason).toContain('changed after the last test run');

    // Assert that the database test run record status is now 'stale'
    const latestTestInDb = validationRepo.findLatestByTaskAndType(task.id, 'test');
    expect(latestTestInDb?.status).toBe('stale');
  });

  it('detects git conflict markers during inspectGitDiff and blocks completion', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Resolve Merge Conflicts',
      description: 'Cleanup unmerged branch state.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');

    // Introduce git conflict markers in file
    const conflictFile = path.join(tempDir, 'src', 'conflict.ts');
    fs.writeFileSync(
      conflictFile,
      `export function calculate() {\n<<<<<<< HEAD\n  return 1;\n=======\n  return 2;\n>>>>>>> branch-b\n}\n`
    );
    taskRepo.attachFile(task.id, 'src/conflict.ts');

    const gitResult = await validationService.inspectGitDiff({
      taskId: task.id,
      projectId,
      affectedFiles: ['src/conflict.ts'],
    });

    expect(gitResult.status).toBe('failed');
    expect(gitResult.error).toContain('Git conflict markers detected');
  });

  it('runs ValidationCLI: validate task <task-id> with visual summary and blocker feedback', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'CLI Task Test',
      description: 'Run through CLI runner.',
    });
    taskRepo.transitionStatus(task.id, 'in_progress');

    const cli = new ValidationCLI(client.db, tempDir, fakeRunner);

    // Run CLI on successful task
    const outputSuccess = await cli.run(['validate', 'task', task.id]);
    expect(outputSuccess).toContain('VALIDATION PIPELINE');
    expect(outputSuccess).toContain('[✓] tests');
    expect(outputSuccess).toContain('[✓] lint');
    expect(outputSuccess).toContain('[✓] typecheck');
    expect(outputSuccess).toContain('[✓] build');
    expect(outputSuccess).toContain('Result: SUCCESS');

    // Run CLI on a failing task
    const failingTask = taskRepo.create({
      projectId,
      title: 'Failing CLI Task',
      description: 'Will fail on linting.',
    });
    taskRepo.transitionStatus(failingTask.id, 'in_progress');

    fakeRunner.setCommandResult('pnpm lint', {
      exitCode: 1,
      stdout: '',
      stderr: 'ESLint: 3 unused imports found.',
    });

    const outputFail = await cli.run(['validate', 'task', failingTask.id]);
    expect(outputFail).toContain('[✗] lint');
    expect(outputFail).toContain('Result: FAILED');
    expect(outputFail).toContain('Blocker Created:');
    expect(outputFail).toContain('pnpm lint');
    expect(outputFail).toContain('Fix formatting, import order, and lint violations');
  });

  it('ISSUE-HIGH-001: automatically resolves projectId from taskId without foreign key constraint error', async () => {
    // Create a task under a valid project
    const task = taskRepo.create({
      projectId,
      title: 'Task without explicit projectId in options',
      description: 'Test automatic projectId resolution',
    });

    // Run tests with ONLY taskId provided (no projectId)
    const testResult = await validationService.runTests({ taskId: task.id });
    expect(testResult.status).toBe('passed');

    // Run lint with ONLY taskId provided
    const lintResult = await validationService.runLint({ taskId: task.id });
    expect(lintResult.status).toBe('passed');

    // Run typecheck with ONLY taskId provided
    const typecheckResult = await validationService.runTypecheck({ taskId: task.id });
    expect(typecheckResult.status).toBe('passed');

    // Run build with ONLY taskId provided
    const buildResult = await validationService.runBuild({ taskId: task.id });
    expect(buildResult.status).toBe('passed');

    // Run inspectGitDiff with ONLY taskId provided
    const gitDiffResult = await validationService.inspectGitDiff({ taskId: task.id });
    expect(gitDiffResult.status).toBe('passed');

    // Run architecture guard with ONLY taskId provided
    const guardResult = await validationService.runArchitectureGuard({ taskId: task.id });
    expect(guardResult.status).toBe('passed');

    // Verify records in validation repository have the resolved projectId
    const runs = validationRepo.listByTask(task.id);
    expect(runs.length).toBe(6);
    for (const run of runs) {
      expect(run.projectId).toBe(projectId);
    }
  });
});

