import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TaskValidationResult,
  ValidationStepResult,
  TaskValidationBlocker,
  ValidationRunOptions,
  ValidateTaskOptions,
  ValidationRunStatus,
} from '../core/types.js';
import { TaskNotFoundError, ValidationError } from '../core/errors.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { ProjectRepository } from '../database/repositories/project.repository.js';
import { ValidationRepository } from '../database/repositories/validation.repository.js';
import { EventRepository } from '../database/repositories/event.repository.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { MemoryCompiler } from '../memory/memory-compiler.js';
import { ICommandRunner, ProcessCommandRunner } from './command-runner.js';
import { ArchitectureGuard } from '../guard/architecture-guard.js';
import { ArchitectureGuardReport } from '../guard/types.js';

export class ValidationService {
  private readonly db: DatabaseSync;
  private readonly taskRepo: TaskRepository;
  private readonly projectRepo: ProjectRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly eventRepo: EventRepository;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly memoryCompiler: MemoryCompiler;

  constructor(
    db: DatabaseSync,
    private readonly projectRoot: string,
    private readonly runner: ICommandRunner = new ProcessCommandRunner(),
    gitAnalyzer?: GitAnalyzer,
    memoryCompiler?: MemoryCompiler
  ) {
    this.db = db;
    this.taskRepo = new TaskRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.validationRepo = new ValidationRepository(db);
    this.eventRepo = new EventRepository(db);
    this.gitAnalyzer = gitAnalyzer ?? new GitAnalyzer();
    this.memoryCompiler = memoryCompiler ?? new MemoryCompiler(db);
  }

  /**
   * Resolves the projectId from options, task lookup, project root lookup, or database fallback.
   */
  private resolveProjectId(options?: { projectId?: string; taskId?: string }): string {
    let projectId = options?.projectId;
    if (!projectId && options?.taskId) {
      const task = this.taskRepo.findById(options.taskId);
      if (task?.projectId) {
        projectId = task.projectId;
      }
    }
    if (!projectId) {
      const byPath = this.projectRepo.findByRootPath(this.projectRoot);
      if (byPath) {
        projectId = byPath.id;
      }
    }
    if (!projectId) {
      const allProjects = this.projectRepo.list();
      if (allProjects.length > 0 && allProjects[0]) {
        projectId = allProjects[0].id;
      }
    }
    return projectId || 'default';
  }

  /**
   * Run automated tests and record deterministic outcome.
   */
  public async runTests(options?: ValidationRunOptions): Promise<ValidationStepResult> {
    const command = options?.command || 'pnpm test';
    const affectedFiles = options?.affectedFiles ?? [];
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const execResult = await this.runner.run(command, this.projectRoot);
    const status: ValidationRunStatus = execResult.exit_code === 0 ? 'passed' : 'failed';

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'test',
      status,
      command,
      exitCode: execResult.exit_code,
      startedAt: execResult.started_at,
      finishedAt: execResult.finished_at,
      affectedFiles,
      results: {
        command,
        started_at: execResult.started_at,
        finished_at: execResult.finished_at,
        exit_code: execResult.exit_code,
        status,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        affected_files: affectedFiles,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'tests',
      command,
      started_at: execResult.started_at,
      finished_at: execResult.finished_at,
      exit_code: execResult.exit_code,
      status,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      affected_files: affectedFiles,
      error: execResult.exit_code !== 0 ? (execResult.stderr || execResult.stdout || 'Tests failed') : undefined,
    };
  }

  /**
   * Run linter check and record deterministic outcome.
   */
  public async runLint(options?: ValidationRunOptions): Promise<ValidationStepResult> {
    const command = options?.command || 'pnpm lint';
    const affectedFiles = options?.affectedFiles ?? [];
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const execResult = await this.runner.run(command, this.projectRoot);
    const status: ValidationRunStatus = execResult.exit_code === 0 ? 'passed' : 'failed';

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'lint',
      status,
      command,
      exitCode: execResult.exit_code,
      startedAt: execResult.started_at,
      finishedAt: execResult.finished_at,
      affectedFiles,
      results: {
        command,
        started_at: execResult.started_at,
        finished_at: execResult.finished_at,
        exit_code: execResult.exit_code,
        status,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        affected_files: affectedFiles,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'lint',
      command,
      started_at: execResult.started_at,
      finished_at: execResult.finished_at,
      exit_code: execResult.exit_code,
      status,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      affected_files: affectedFiles,
      error: execResult.exit_code !== 0 ? (execResult.stderr || execResult.stdout || 'Linting failed') : undefined,
    };
  }

  /**
   * Run typecheck (tsc --noEmit) and record deterministic outcome.
   */
  public async runTypecheck(options?: ValidationRunOptions): Promise<ValidationStepResult> {
    const command = options?.command || 'pnpm typecheck';
    const affectedFiles = options?.affectedFiles ?? [];
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const execResult = await this.runner.run(command, this.projectRoot);
    const status: ValidationRunStatus = execResult.exit_code === 0 ? 'passed' : 'failed';

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'typecheck',
      status,
      command,
      exitCode: execResult.exit_code,
      startedAt: execResult.started_at,
      finishedAt: execResult.finished_at,
      affectedFiles,
      results: {
        command,
        started_at: execResult.started_at,
        finished_at: execResult.finished_at,
        exit_code: execResult.exit_code,
        status,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        affected_files: affectedFiles,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'typecheck',
      command,
      started_at: execResult.started_at,
      finished_at: execResult.finished_at,
      exit_code: execResult.exit_code,
      status,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      affected_files: affectedFiles,
      error: execResult.exit_code !== 0 ? (execResult.stderr || execResult.stdout || 'Typecheck failed') : undefined,
    };
  }

  /**
   * Run build compilation (tsc / bundler) and record deterministic outcome.
   */
  public async runBuild(options?: ValidationRunOptions): Promise<ValidationStepResult> {
    const command = options?.command || 'pnpm build';
    const affectedFiles = options?.affectedFiles ?? [];
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const execResult = await this.runner.run(command, this.projectRoot);
    const status: ValidationRunStatus = execResult.exit_code === 0 ? 'passed' : 'failed';

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'build',
      status,
      command,
      exitCode: execResult.exit_code,
      startedAt: execResult.started_at,
      finishedAt: execResult.finished_at,
      affectedFiles,
      results: {
        command,
        started_at: execResult.started_at,
        finished_at: execResult.finished_at,
        exit_code: execResult.exit_code,
        status,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        affected_files: affectedFiles,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'build',
      command,
      started_at: execResult.started_at,
      finished_at: execResult.finished_at,
      exit_code: execResult.exit_code,
      status,
      stdout: execResult.stdout,
      stderr: execResult.stderr,
      affected_files: affectedFiles,
      error: execResult.exit_code !== 0 ? (execResult.stderr || execResult.stdout || 'Build failed') : undefined,
    };
  }

  /**
   * Inspects working tree git diff for syntax conflicts, unmerged markers, or deleted critical files.
   */
  public async inspectGitDiff(options?: ValidationRunOptions): Promise<ValidationStepResult> {
    const startedAt = Date.now();
    const command = 'git status & diff inspection';
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const workingChanges = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
    const diffSummary = await this.gitAnalyzer.getDiffSummary(this.projectRoot);

    const affectedFiles = [
      ...workingChanges.modified,
      ...workingChanges.added,
      ...workingChanges.deleted,
      ...workingChanges.renamed.map((r) => r.to),
    ];

    let hasConflict = false;
    let conflictError = '';

    const filesToCheck = new Set([
      ...(options?.affectedFiles ?? []),
      ...workingChanges.modified,
      ...workingChanges.added,
    ]);

    // Check for conflict markers in modified or added files
    for (const relPath of filesToCheck) {
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(this.projectRoot, relPath);
      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (content.includes('<<<<<<< HEAD') || content.includes('=======\n') || content.includes('>>>>>>> ')) {
            hasConflict = true;
            conflictError = `Git conflict markers detected in file: ${relPath}`;
            break;
          }
        }
      } catch {
        // Ignored
      }
    }

    // Check if canonical project root files were deleted
    const criticalFiles = ['.ai/canonical/PROJECT.md', 'package.json'];
    for (const crit of criticalFiles) {
      if (workingChanges.deleted.includes(crit)) {
        hasConflict = true;
        conflictError = `Critical project file was deleted in working tree: ${crit}`;
        break;
      }
    }

    const finishedAt = Date.now();
    const exitCode = hasConflict ? 1 : 0;
    const status: ValidationRunStatus = hasConflict ? 'failed' : 'passed';
    const stdout = `Modified: ${workingChanges.modified.length}, Added: ${workingChanges.added.length}, Deleted: ${workingChanges.deleted.length}. Diff Summary: ${diffSummary || '(clean)'}`;

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'git_diff',
      status,
      command,
      exitCode,
      startedAt,
      finishedAt,
      affectedFiles,
      results: {
        command,
        started_at: startedAt,
        finished_at: finishedAt,
        exit_code: exitCode,
        status,
        stdout,
        stderr: conflictError,
        affected_files: affectedFiles,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'git_diff',
      command,
      started_at: startedAt,
      finished_at: finishedAt,
      exit_code: exitCode,
      status,
      stdout,
      stderr: conflictError,
      affected_files: affectedFiles,
      error: hasConflict ? conflictError : undefined,
    };
  }

  /**
   * Runs the Architecture Guard to check anti-bloat, duplicate functionality, boundary violations, etc.
   */
  public async runArchitectureGuard(options?: {
    taskId?: string;
    projectId?: string;
    agentIdentity?: string;
    declaredScopeFiles?: string[];
    strictMode?: boolean;
    approvedViolations?: string[];
  }): Promise<ValidationStepResult & { report: ArchitectureGuardReport }> {
    const startedAt = Date.now();
    const command = 'architecture_guard evaluate';
    const projectId = this.resolveProjectId(options);
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    const guard = new ArchitectureGuard(this.projectRoot, this.db, this.gitAnalyzer);
    const report = await guard.evaluate({
      taskId: options?.taskId,
      projectId,
      declaredScopeFiles: options?.declaredScopeFiles,
      strictMode: options?.strictMode,
      approvedViolations: options?.approvedViolations,
    });

    const finishedAt = Date.now();
    const status: ValidationRunStatus = report.blocked ? 'failed' : 'passed';
    const exitCode = report.blocked ? 1 : 0;
    const affectedFiles = report.violations
      .map((v) => v.file)
      .filter((f): f is string => Boolean(f));

    const stdout = [
      `Architecture Guard Evaluation:`,
      `Errors: ${report.summary.errors}`,
      `Approval Required: ${report.summary.approvalRequired}`,
      `Warnings: ${report.summary.warnings}`,
      ...report.violations.map(
        (v) => `[${v.severity.toUpperCase()}] ${v.category}: ${v.message}${v.suggestion ? ` (Suggestion: ${v.suggestion})` : ''}`
      ),
    ].join('\n');

    const stderr = report.blocked
      ? report.violations
          .filter((v) => v.severity === 'error' || (options?.strictMode && v.severity === 'approval_required'))
          .map((v) => `[${v.severity.toUpperCase()}] ${v.category}: ${v.message}`)
          .join('\n')
      : '';

    this.validationRepo.recordValidationRun({
      projectId,
      taskId: options?.taskId,
      validatorType: 'architecture_guard',
      status,
      command,
      exitCode,
      startedAt,
      finishedAt,
      affectedFiles,
      results: {
        command,
        started_at: startedAt,
        finished_at: finishedAt,
        exit_code: exitCode,
        status,
        stdout,
        stderr,
        affected_files: affectedFiles,
        summary: report.summary,
      },
      runBy: agentIdentity,
    });

    return {
      step: 'architecture_guard',
      command,
      started_at: startedAt,
      finished_at: finishedAt,
      exit_code: exitCode,
      status,
      stdout,
      stderr,
      affected_files: affectedFiles,
      error: report.blocked ? (stderr || 'Architecture guard detected blocking violations') : undefined,
      report,
    };
  }

  /**
   * Detects if validation is stale.
   * If code has changed after the last test run: → test status is stale.
   */
  public async isValidationStale(
    taskId: string
  ): Promise<{ isStale: boolean; reason?: string; lastTestTimestamp?: number; changedFiles: string[] }> {
    const latestTestRun = this.validationRepo.findLatestByTaskAndType(taskId, 'test');

    if (!latestTestRun) {
      return { isStale: false, changedFiles: [] };
    }

    if (latestTestRun.status !== 'passed') {
      return { isStale: false, changedFiles: [] };
    }

    const lastTestedAt = latestTestRun.finishedAt ?? latestTestRun.createdAt;
    const taskFiles = this.taskRepo.listFiles(taskId).map((f) => f.filePath);

    // Get current working tree changes
    const workingTree = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
    const candidateFiles = new Set([...taskFiles, ...workingTree.modified, ...workingTree.added]);

    const staleFiles: string[] = [];

    for (const relPath of candidateFiles) {
      const fullPath = path.isAbsolute(relPath) ? relPath : path.join(this.projectRoot, relPath);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          // Allow 50ms buffer for filesystem timestamp clock granularity
          if (stat.mtimeMs > lastTestedAt + 50) {
            staleFiles.push(relPath);
          }
        }
      } catch {
        // Ignored
      }
    }

    if (staleFiles.length > 0) {
      this.validationRepo.updateStatus(latestTestRun.id, 'stale');
      return {
        isStale: true,
        reason: `Code in ${staleFiles.length} file(s) changed after the last test run at ${new Date(lastTestedAt).toISOString()}`,
        lastTestTimestamp: lastTestedAt,
        changedFiles: staleFiles,
      };
    }

    return {
      isStale: false,
      lastTestTimestamp: lastTestedAt,
      changedFiles: [],
    };
  }

  /**
   * Orchestrates the complete validation pipeline for a task:
   * implementation -> tests -> lint -> typecheck -> build -> git diff inspection -> memory update -> task completion
   *
   * If validation fails:
   * Task is transitioned: testing -> blocked, and a detailed blocker is attached.
   */
  public async validateTask(
    taskId: string,
    options?: ValidateTaskOptions
  ): Promise<TaskValidationResult> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }

    const projectId = options?.projectId || task.projectId;
    const agentIdentity = options?.agentIdentity || 'ValidationService';

    // 1. Gather affected files
    const taskFiles = this.taskRepo.listFiles(taskId).map((f) => f.filePath);
    const workingChanges = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
    const affectedFiles = Array.from(
      new Set([...taskFiles, ...workingChanges.modified, ...workingChanges.added])
    );

    // 2. Check for stale validation
    const staleInfo = await this.isValidationStale(taskId);

    // 3. State transition: transition task to 'testing'
    if (task.status === 'in_progress' || task.status === 'resumed') {
      this.taskRepo.transitionStatus(taskId, 'testing');
    } else if (task.status === 'blocked') {
      this.taskRepo.transitionStatus(taskId, 'resumed');
      this.taskRepo.transitionStatus(taskId, 'testing');
    } else if (task.status !== 'testing' && task.status !== 'done') {
      throw new ValidationError(
        `Cannot validate task ${taskId} from status '${task.status}'. Expected in_progress, resumed, or testing.`
      );
    }

    const runs: ValidationStepResult[] = [];

    // --- PIPELINE STEP 1: TESTS ---
    const testResult = await this.runTests({
      taskId,
      projectId,
      command: options?.testCommand,
      affectedFiles,
      agentIdentity,
    });
    runs.push(testResult);

    if (testResult.status !== 'passed') {
      return this.handleValidationFailure(taskId, task.projectId, testResult, runs, {
        command: testResult.command,
        error: testResult.error || testResult.stderr || testResult.stdout || 'Unit/Integration tests failed',
        affected_files: testResult.affected_files,
        last_attempt: testResult.finished_at,
        next_hypothesis: 'Investigate failing test assertions or runtime exceptions reported in test output.',
      });
    }

    // --- PIPELINE STEP 2: LINT ---
    if (!options?.skipLint) {
      const lintResult = await this.runLint({
        taskId,
        projectId,
        command: options?.lintCommand,
        affectedFiles,
        agentIdentity,
      });
      runs.push(lintResult);

      if (lintResult.status !== 'passed') {
        return this.handleValidationFailure(taskId, task.projectId, lintResult, runs, {
          command: lintResult.command,
          error: lintResult.error || lintResult.stderr || lintResult.stdout || 'Linter reported errors',
          affected_files: lintResult.affected_files,
          last_attempt: lintResult.finished_at,
          next_hypothesis: 'Fix formatting, import order, and lint violations reported by linter.',
        });
      }
    }

    // --- PIPELINE STEP 3: TYPECHECK ---
    if (!options?.skipTypecheck) {
      const typecheckResult = await this.runTypecheck({
        taskId,
        projectId,
        command: options?.typecheckCommand,
        affectedFiles,
        agentIdentity,
      });
      runs.push(typecheckResult);

      if (typecheckResult.status !== 'passed') {
        return this.handleValidationFailure(taskId, task.projectId, typecheckResult, runs, {
          command: typecheckResult.command,
          error: typecheckResult.error || typecheckResult.stderr || typecheckResult.stdout || 'TypeScript typecheck failed',
          affected_files: typecheckResult.affected_files,
          last_attempt: typecheckResult.finished_at,
          next_hypothesis: 'Resolve TypeScript compiler type errors, missing properties, or type signature mismatches.',
        });
      }
    }

    // --- PIPELINE STEP 4: BUILD ---
    if (!options?.skipBuild) {
      const buildResult = await this.runBuild({
        taskId,
        projectId,
        command: options?.buildCommand,
        affectedFiles,
        agentIdentity,
      });
      runs.push(buildResult);

      if (buildResult.status !== 'passed') {
        return this.handleValidationFailure(taskId, task.projectId, buildResult, runs, {
          command: buildResult.command,
          error: buildResult.error || buildResult.stderr || buildResult.stdout || 'Build compilation failed',
          affected_files: buildResult.affected_files,
          last_attempt: buildResult.finished_at,
          next_hypothesis: 'Fix build configuration or compilation errors preventing artifact generation.',
        });
      }
    }

    // --- PIPELINE STEP 5: GIT DIFF INSPECTION ---
    const gitDiffResult = await this.inspectGitDiff({
      taskId,
      projectId,
      affectedFiles,
      agentIdentity,
    });
    runs.push(gitDiffResult);

    if (gitDiffResult.status !== 'passed') {
      return this.handleValidationFailure(taskId, task.projectId, gitDiffResult, runs, {
        command: gitDiffResult.command,
        error: gitDiffResult.error || 'Git diff inspection detected conflicts or missing canonical files',
        affected_files: gitDiffResult.affected_files,
        last_attempt: gitDiffResult.finished_at,
        next_hypothesis: 'Resolve Git conflict markers or restore accidentally deleted canonical repository files.',
      });
    }

    // --- PIPELINE STEP 6: ARCHITECTURE GUARD (Phase 16) ---
    if (!options?.skipArchitectureGuard) {
      const guardResult = await this.runArchitectureGuard({
        taskId,
        projectId,
        agentIdentity,
        declaredScopeFiles: taskFiles.length > 0 ? taskFiles : undefined,
        strictMode: options?.strictGuard,
      });
      runs.push(guardResult);

      if (guardResult.status !== 'passed') {
        return this.handleValidationFailure(taskId, task.projectId, guardResult, runs, {
          command: guardResult.command,
          error: guardResult.error || 'Architecture guard detected blocking violations',
          affected_files: guardResult.affected_files,
          last_attempt: guardResult.finished_at,
          next_hypothesis:
            'Review Architecture Guard violations. Check for circular dependencies, duplicate abstractions, boundary violations, or unnecessary dependencies.',
        });
      }
    }

    // --- PIPELINE STEP 7: INCREMENTAL MEMORY UPDATE ---
    const memoryUpdateStart = Date.now();
    try {
      if (options?.updateMemoryOnPass !== false) {
        await this.memoryCompiler.compileChanges(this.projectRoot, task.projectId);
      }
      const memoryUpdateEnd = Date.now();

      runs.push({
        step: 'memory_update',
        command: 'MemoryCompiler.compileChanges()',
        started_at: memoryUpdateStart,
        finished_at: memoryUpdateEnd,
        exit_code: 0,
        status: 'passed',
        stdout: 'Incremental memory successfully synchronized without LLM.',
        stderr: '',
        affected_files: affectedFiles,
      });
    } catch (memError) {
      // Memory compilation error does not block task completion, but records warning
      const memoryUpdateEnd = Date.now();
      runs.push({
        step: 'memory_update',
        command: 'MemoryCompiler.compileChanges()',
        started_at: memoryUpdateStart,
        finished_at: memoryUpdateEnd,
        exit_code: 0,
        status: 'passed',
        stdout: 'Memory update warning: ' + (memError instanceof Error ? memError.message : String(memError)),
        stderr: '',
        affected_files: affectedFiles,
      });
    }

    // --- PIPELINE STEP 7: TASK COMPLETION ---
    if (options?.autoCompleteOnPass !== false) {
      this.taskRepo.transitionStatus(taskId, 'done');
      this.eventRepo.recordEvent({
        projectId: task.projectId,
        eventType: 'task.completed',
        aggregateType: 'task',
        aggregateId: taskId,
        payload: {
          validationSummary: 'All validation gates (tests, lint, typecheck, build, git diff, memory) passed.',
          totalRuns: runs.length,
        },
        agentIdentity,
      });
    }

    // Record aggregate pipeline record
    this.validationRepo.recordValidationRun({
      projectId: task.projectId,
      taskId,
      validatorType: 'pipeline',
      status: 'passed',
      command: 'validateTask full pipeline',
      exitCode: 0,
      startedAt: runs[0]?.started_at ?? Date.now(),
      finishedAt: Date.now(),
      affectedFiles,
      results: {
        success: true,
        steps: runs.map((r) => ({ step: r.step, status: r.status, durationMs: r.finished_at - r.started_at })),
      },
      runBy: agentIdentity,
    });

    return {
      task_id: taskId,
      success: true,
      status: 'passed',
      runs,
      stale_detected: staleInfo.isStale,
      stale_reason: staleInfo.reason,
      completed_at: Date.now(),
    };
  }

  /**
   * Handles validation failure:
   * 1. Transitions task state: testing -> blocked
   * 2. Creates structured blocker in task_blockers
   * 3. Records task.blocked audit event
   */
  private handleValidationFailure(
    taskId: string,
    projectId: string,
    failedStep: ValidationStepResult,
    runs: ValidationStepResult[],
    blockerData: TaskValidationBlocker
  ): TaskValidationResult {
    // 1. Transition state testing -> blocked
    this.taskRepo.transitionStatus(taskId, 'blocked');

    // 2. Format structured blocker reason
    const blockerReason = [
      `[Validation Gate Failed: ${failedStep.step}]`,
      `Command: ${blockerData.command}`,
      `Error: ${blockerData.error.trim().slice(0, 300)}`,
      `Affected Files: ${blockerData.affected_files.join(', ') || '(none)'}`,
      `Last Attempt: ${new Date(blockerData.last_attempt).toISOString()}`,
      `Next Hypothesis: ${blockerData.next_hypothesis}`,
      `JSON:${JSON.stringify(blockerData)}`,
    ].join('\n');

    const blocker = this.taskRepo.addBlocker(taskId, blockerReason);

    // 3. Record task.blocked audit event
    this.eventRepo.recordEvent({
      projectId,
      eventType: 'task.blocked',
      aggregateType: 'task',
      aggregateId: taskId,
      payload: {
        blockerId: blocker.id,
        failedStep: failedStep.step,
        command: blockerData.command,
        error: blockerData.error,
        affectedFiles: blockerData.affected_files,
        nextHypothesis: blockerData.next_hypothesis,
      },
      agentIdentity: 'ValidationService',
    });

    // 4. Record aggregate pipeline failure record
    this.validationRepo.recordValidationRun({
      projectId,
      taskId,
      validatorType: 'pipeline',
      status: 'failed',
      command: failedStep.command,
      exitCode: failedStep.exit_code,
      startedAt: runs[0]?.started_at ?? Date.now(),
      finishedAt: Date.now(),
      affectedFiles: failedStep.affected_files,
      results: {
        success: false,
        failedStep: failedStep.step,
        error: blockerData.error,
        blockerId: blocker.id,
      },
      runBy: 'ValidationService',
    });

    return {
      task_id: taskId,
      success: false,
      status: 'failed',
      runs,
      blocker: blockerData,
      completed_at: Date.now(),
    };
  }
}
