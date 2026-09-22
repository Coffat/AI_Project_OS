import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  HandoffSnapshotData,
  HandoffConsistencyReport,
  HandoffConsistencyWarning,
} from '../core/types.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';

export class HandoffValidator {
  private readonly gitAnalyzer: GitAnalyzer;

  constructor(private readonly projectRoot: string = process.cwd()) {
    this.gitAnalyzer = new GitAnalyzer();
  }

  /**
   * Validates runtime consistency between a handoff snapshot and the actual working tree / git state.
   */
  public async validateConsistency(snapshot: HandoffSnapshotData): Promise<HandoffConsistencyReport> {
    const warnings: HandoffConsistencyWarning[] = [];
    let validationStale = false;
    let gitMismatch = false;

    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);

    if (isGit) {
      const currentBranch = await this.gitAnalyzer.getCurrentBranch(this.projectRoot);
      const currentCommit = await this.gitAnalyzer.getCurrentCommit(this.projectRoot);
      const workingTreeChanges = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);

      // 1. Check Working Tree / Git Mismatch (Branch & Commit)
      if (snapshot.git.branch && currentBranch && snapshot.git.branch !== currentBranch) {
        gitMismatch = true;
        warnings.push({
          code: 'GIT_STATE_MISMATCH',
          message: `Git branch mismatch: handoff was recorded on '${snapshot.git.branch}', but current branch is '${currentBranch}'.`,
          severity: 'warning',
        });
      }

      if (
        snapshot.git.commitHash &&
        currentCommit &&
        snapshot.git.commitHash !== 'HEAD' &&
        currentCommit !== 'HEAD' &&
        snapshot.git.commitHash !== currentCommit
      ) {
        gitMismatch = true;
        warnings.push({
          code: 'GIT_STATE_MISMATCH',
          message: `Git commit mismatch: handoff was recorded at commit '${snapshot.git.commitHash}', but current commit is '${currentCommit}'.`,
          severity: 'warning',
        });
      }

      // 2. Check Modified Files Consistency:
      // "Nếu handoff nói file X modified nhưng Git không thấy X modified: → warning."
      const currentChangedSet = new Set<string>([
        ...workingTreeChanges.modified,
        ...workingTreeChanges.added,
        ...workingTreeChanges.deleted,
        ...workingTreeChanges.renamed.map((r) => r.to),
      ]);

      for (const claimedFile of snapshot.modified_files) {
        // Only warn if the commit hash hasn't moved (so the change wasn't committed) and file is not changed
        if (!currentChangedSet.has(claimedFile)) {
          // Check if file exists on disk
          const fullPath = path.isAbsolute(claimedFile)
            ? claimedFile
            : path.join(this.projectRoot, claimedFile);

          if (fs.existsSync(fullPath)) {
            warnings.push({
              code: 'FILE_NOT_MODIFIED_IN_GIT',
              message: `Handoff claims file '${claimedFile}' was modified, but Git working tree shows it unmodified.`,
              severity: 'warning',
              file: claimedFile,
            });
          }
        }
      }

      // 3. Check Test Validation Staleness:
      // "Nếu task nói tests passed nhưng latest code changed sau test: → mark validation stale."
      if (snapshot.validation?.status === 'passed') {
        const testTimestamp = snapshot.validation.timestamp ?? 0;
        let codeChangedAfterTest = false;

        // Check if any claimed modified file has mtime > testTimestamp
        for (const file of snapshot.modified_files) {
          const fullPath = path.isAbsolute(file) ? file : path.join(this.projectRoot, file);
          try {
            if (fs.existsSync(fullPath)) {
              const stat = fs.statSync(fullPath);
              if (stat.mtimeMs > testTimestamp + 100) {
                codeChangedAfterTest = true;
                break;
              }
            }
          } catch {
            // Ignored
          }
        }

        // Also check if commit hash moved past last tested commit
        if (
          snapshot.validation.lastTestedCommit &&
          currentCommit &&
          currentCommit !== 'HEAD' &&
          snapshot.validation.lastTestedCommit !== currentCommit
        ) {
          codeChangedAfterTest = true;
        }

        if (codeChangedAfterTest) {
          validationStale = true;
          warnings.push({
            code: 'TESTS_STALE_CODE_CHANGED',
            message:
              'Tests were previously marked as passed, but code files or git commits have changed since the last test run. Re-validation is recommended.',
            severity: 'warning',
          });
        }
      }
    }

    const isConsistent = warnings.filter((w) => w.severity === 'error').length === 0;

    return {
      isConsistent,
      validationStale,
      gitMismatch,
      warnings,
      checkedAt: Date.now(),
    };
  }
}
