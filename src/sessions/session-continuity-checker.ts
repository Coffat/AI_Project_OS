import { DatabaseSync } from 'node:sqlite';
import { HandoffGitState } from '../core/types.js';
import { TaskRepository } from '../database/repositories/task.repository.js';
import { HandoffRepository } from '../database/repositories/handoff.repository.js';
import { ValidationRepository } from '../database/repositories/validation.repository.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import {
  ContinuityMismatch,
  SessionContinuityReport,
} from './types.js';

export class SessionContinuityChecker {
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly gitAnalyzer: GitAnalyzer;

  constructor(
    db: DatabaseSync,
    private readonly projectRoot: string = process.cwd()
  ) {
    this.taskRepo = new TaskRepository(db);
    this.handoffRepo = new HandoffRepository(db);
    this.validationRepo = new ValidationRepository(db);
    this.gitAnalyzer = new GitAnalyzer();
  }

  /**
   * Evaluates task and environment continuity:
   * Git + Task + Memory + Graph + Handoff
   */
  public async checkContinuity(
    taskId: string,
    specificHandoffId?: string
  ): Promise<SessionContinuityReport> {
    const task = this.taskRepo.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const latestHandoff = specificHandoffId
      ? this.handoffRepo.findById(specificHandoffId) ?? undefined
      : this.handoffRepo.findLatestByTaskId(taskId) ?? undefined;

    const mismatches: ContinuityMismatch[] = [];

    // 1. Capture current Git State
    let branch: string | undefined;
    let commitHash: string | undefined;
    let isDirty = false;
    let modifiedFiles: string[] = [];
    let untrackedFiles: string[] = [];

    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
    if (isGit) {
      branch = (await this.gitAnalyzer.getCurrentBranch(this.projectRoot)) ?? undefined;
      commitHash = (await this.gitAnalyzer.getCurrentCommit(this.projectRoot)) ?? undefined;
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
      modifiedFiles = changes.modified;
      untrackedFiles = changes.added;
      isDirty = changes.modified.length > 0 || changes.added.length > 0 || changes.deleted.length > 0;
    }

    const currentGitState: HandoffGitState = {
      branch,
      commitHash,
      isDirty,
      modifiedFiles,
      untrackedFiles,
    };

    // 2. Cross-check against latest Handoff
    if (latestHandoff) {
      const prevGit = latestHandoff.gitState ?? {};

      // Branch Check
      if (
        prevGit.branch &&
        branch &&
        prevGit.branch !== 'HEAD' &&
        branch !== 'HEAD' &&
        prevGit.branch !== branch
      ) {
        mismatches.push({
          code: 'GIT_BRANCH_MISMATCH',
          message: `Git branch mismatch: handoff recorded on '${prevGit.branch}', but current branch is '${branch}'.`,
          severity: 'warning',
          details: { handoffBranch: prevGit.branch, currentBranch: branch },
        });
      }

      // Commit Divergence Check
      if (
        prevGit.commitHash &&
        commitHash &&
        prevGit.commitHash !== 'HEAD' &&
        prevGit.commitHash !== 'head' &&
        commitHash !== 'HEAD' &&
        commitHash !== 'head' &&
        prevGit.commitHash !== commitHash
      ) {
        mismatches.push({
          code: 'GIT_COMMIT_MISMATCH',
          message: `Git commit changed: handoff was captured at '${prevGit.commitHash.slice(0, 7)}', current HEAD is '${commitHash.slice(0, 7)}'.`,
          severity: 'info',
          details: { handoffCommit: prevGit.commitHash, currentCommit: commitHash },
        });
      }

      // Uncommitted changes check
      if (isDirty) {
        mismatches.push({
          code: 'UNCOMMITTED_CHANGES_DETECTED',
          message: `Working tree has uncommitted changes (${modifiedFiles.length} modified files).`,
          severity: 'warning',
          details: { modifiedFiles },
        });
      }

      // Claimed modified files discrepancy
      const handoffModified = new Set(latestHandoff.modifiedFiles ?? []);
      const currentlyChanged = new Set([...modifiedFiles, ...untrackedFiles]);
      const missingChanges: string[] = [];

      for (const file of handoffModified) {
        if (!currentlyChanged.has(file)) {
          missingChanges.push(file);
        }
      }

      if (missingChanges.length > 0 && isDirty) {
        mismatches.push({
          code: 'MODIFIED_FILE_DISCREPANCY',
          message: `Files reported modified in handoff are no longer dirty or have been staged: ${missingChanges.join(', ')}`,
          severity: 'info',
          details: { missingFromDirty: missingChanges },
        });
      }
    } else if (task.status === 'in_progress' || task.status === 'handoff' || task.status === 'resumed') {
      mismatches.push({
        code: 'MISSING_PREVIOUS_HANDOFF',
        message: `Task is in state '${task.status}' but no prior handoff record was found. Continuing from task definition.`,
        severity: 'info',
      });
    }

    // 3. Task Blockers Check
    const isBlocked = task.status === 'blocked' || Boolean(latestHandoff?.blockers);
    if (isBlocked) {
      const blockerText =
        latestHandoff?.blockers ||
        task.description ||
        'Task marked blocked';
      mismatches.push({
        code: 'ACTIVE_TASK_BLOCKER',
        message: `Task has active blocker: ${blockerText}`,
        severity: 'warning',
        details: { blockerText },
      });
    }

    // 4. Validation Summary
    const validationRuns = this.validationRepo.listByTask(taskId);
    const latestRun = validationRuns.length > 0 ? validationRuns[0] : undefined;
    const failedRuns = validationRuns.filter((r) => r.status === 'failed');

    let validationSummary: SessionContinuityReport['validationSummary'];
    if (validationRuns.length > 0) {
      validationSummary = {
        totalRuns: validationRuns.length,
        latestStatus: latestRun?.status,
        failedValidators: [...new Set(failedRuns.map((r) => r.validatorType))],
      };
    }

    // 5. Expose Recommended Next Action
    let recommendedNextAction = 'Analyze requirements and begin implementation';
    if (latestHandoff && latestHandoff.nextAction) {
      recommendedNextAction = latestHandoff.nextAction;
    } else {
      const steps = this.taskRepo.listSteps(taskId);
      const pendingSteps = steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');
      if (pendingSteps.length > 0) {
        recommendedNextAction = `Execute step ${pendingSteps[0]!.stepOrder}: ${pendingSteps[0]!.title}`;
      } else if (task.goal) {
        recommendedNextAction = task.goal;
      }
    }

    const hasError = mismatches.some((m) => m.severity === 'error');

    return {
      isConsistent: !hasError,
      gitState: currentGitState,
      mismatches,
      task,
      latestHandoff,
      recommendedNextAction,
      validationSummary,
    };
  }
}
