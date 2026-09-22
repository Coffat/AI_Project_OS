import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { GitChangedFiles } from '../core/types.js';
import { SecurityGuard } from '../core/security-guard.js';

const execFileAsync = promisify(execFile);

export interface FileStateInfo {
  path: string;
  contentHash: string;
  lastModifiedAt: number;
}

export class GitAnalyzer {
  /**
   * Checks whether the directory is inside a valid git repository.
   */
  public async isGitRepository(projectRoot: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: projectRoot,
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  public async getGitRoot(projectRoot: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd: projectRoot,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  public relativizeToProjectRoot(
    filePath: string,
    gitRoot: string,
    projectRoot: string
  ): string | null {
    const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(gitRoot, filePath);
    const absProjectRoot = path.resolve(projectRoot);
    const rel = path.relative(absProjectRoot, absPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return null; // outside projectRoot
    }
    return rel;
  }

  /**
   * Gets uncommitted working tree changes using `git status --porcelain -uall`.
   */
  public async getWorkingTreeChanges(projectRoot: string): Promise<GitChangedFiles> {
    const isGit = await this.isGitRepository(projectRoot);
    if (!isGit) {
      return { added: [], modified: [], deleted: [], renamed: [] };
    }

    const gitRoot = await this.getGitRoot(projectRoot);

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['status', '--porcelain', '-uall'],
        { cwd: projectRoot }
      );

      return this.parseGitStatusPorcelain(stdout, gitRoot ?? undefined, projectRoot);
    } catch {
      return { added: [], modified: [], deleted: [], renamed: [] };
    }
  }

  /**
   * Gets changes between two git references using `git diff --name-status -M`.
   */
  public async getDiffChanges(
    projectRoot: string,
    baseRef: string,
    targetRef = 'HEAD'
  ): Promise<GitChangedFiles> {
    const isGit = await this.isGitRepository(projectRoot);
    if (!isGit) {
      return { added: [], modified: [], deleted: [], renamed: [] };
    }

    const safeBaseRef = SecurityGuard.validateGitRef(baseRef, 'baseRef');
    const safeTargetRef = SecurityGuard.validateGitRef(targetRef, 'targetRef');

    const gitRoot = await this.getGitRoot(projectRoot);

    try {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--name-status', '-M', safeBaseRef, safeTargetRef],
        { cwd: projectRoot }
      );

      return this.parseGitDiffOutput(stdout, gitRoot ?? undefined, projectRoot);
    } catch {
      return { added: [], modified: [], deleted: [], renamed: [] };
    }
  }

  /**
   * Parses output of `git status --porcelain -uall`.
   */
  public parseGitStatusPorcelain(
    output: string,
    gitRoot?: string,
    projectRoot?: string
  ): GitChangedFiles {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const renamed: Array<{ from: string; to: string }> = [];

    const lines = output.split('\n').filter((l) => l.trim() !== '');

    const mapPath = (p: string): string | null => {
      const clean = this.cleanPath(p);
      if (gitRoot && projectRoot) {
        return this.relativizeToProjectRoot(clean, gitRoot, projectRoot);
      }
      return clean;
    };

    for (const line of lines) {
      const status = line.substring(0, 2);
      const filePathPart = line.substring(3).trim();

      // Renamed format: R  old/path.ts -> new/path.ts
      if (status.startsWith('R') || status.endsWith('R') || filePathPart.includes(' -> ')) {
        const parts = filePathPart.split(' -> ');
        if (parts.length === 2 && parts[0] && parts[1]) {
          const from = mapPath(parts[0]);
          const to = mapPath(parts[1]);
          if (from && to) {
            renamed.push({ from, to });
          }
          continue;
        }
      }

      const filePath = mapPath(filePathPart);
      if (!filePath) continue;

      // Untracked or staged added
      if (status === '??' || status.startsWith('A') || status.endsWith('A')) {
        added.push(filePath);
      } else if (status.startsWith('D') || status.endsWith('D')) {
        deleted.push(filePath);
      } else if (status.includes('M')) {
        modified.push(filePath);
      }
    }

    return {
      added: Array.from(new Set(added)),
      modified: Array.from(new Set(modified)),
      deleted: Array.from(new Set(deleted)),
      renamed,
    };
  }

  /**
   * Parses output of `git diff --name-status -M`.
   */
  public parseGitDiffOutput(
    output: string,
    gitRoot?: string,
    projectRoot?: string
  ): GitChangedFiles {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const renamed: Array<{ from: string; to: string }> = [];

    const lines = output.split('\n').filter((l) => l.trim() !== '');

    const mapPath = (p: string): string | null => {
      const clean = this.cleanPath(p);
      if (gitRoot && projectRoot) {
        return this.relativizeToProjectRoot(clean, gitRoot, projectRoot);
      }
      return clean;
    };

    for (const line of lines) {
      const parts = line.split('\t');
      const statusCode = parts[0]?.trim() ?? '';

      if (statusCode.startsWith('R')) {
        if (parts.length >= 3 && parts[1] && parts[2]) {
          const from = mapPath(parts[1]);
          const to = mapPath(parts[2]);
          if (from && to) {
            renamed.push({ from, to });
          }
        }
      } else if (statusCode === 'A' && parts[1]) {
        const p = mapPath(parts[1]);
        if (p) added.push(p);
      } else if (statusCode === 'D' && parts[1]) {
        const p = mapPath(parts[1]);
        if (p) deleted.push(p);
      } else if (statusCode === 'M' && parts[1]) {
        const p = mapPath(parts[1]);
        if (p) modified.push(p);
      }
    }

    return {
      added: Array.from(new Set(added)),
      modified: Array.from(new Set(modified)),
      deleted: Array.from(new Set(deleted)),
      renamed,
    };
  }

  /**
   * Non-git fallback: Compares existing indexed files with current filesystem files.
   */
  public async computeFilesystemDiff(
    projectRoot: string,
    existingFiles: FileStateInfo[],
    candidatePaths: string[]
  ): Promise<GitChangedFiles> {
    const existingMap = new Map<string, FileStateInfo>();
    for (const ef of existingFiles) {
      existingMap.set(ef.path, ef);
    }

    const currentMap = new Map<string, FileStateInfo>();
    for (const relPath of candidatePaths) {
      const fullPath = path.join(projectRoot, relPath);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          const content = await fs.readFile(fullPath);
          const hash = crypto.createHash('sha256').update(content).digest('hex');
          currentMap.set(relPath, {
            path: relPath,
            contentHash: hash,
            lastModifiedAt: stat.mtimeMs,
          });
        }
      } catch {
        // file inaccessible or deleted
      }
    }

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    for (const [p, curr] of currentMap.entries()) {
      const prev = existingMap.get(p);
      if (!prev) {
        added.push(p);
      } else if (prev.contentHash !== curr.contentHash) {
        modified.push(p);
      }
    }

    for (const [p] of existingMap.entries()) {
      if (!currentMap.has(p)) {
        deleted.push(p);
      }
    }

    return {
      added,
      modified,
      deleted,
      renamed: [],
    };
  }

  public async getCurrentBranch(projectRoot: string): Promise<string | null> {
    const isGit = await this.isGitRepository(projectRoot);
    if (!isGit) return null;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectRoot,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async getCurrentCommit(projectRoot: string): Promise<string | null> {
    const isGit = await this.isGitRepository(projectRoot);
    if (!isGit) return null;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: projectRoot,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  public async getDiffSummary(projectRoot: string): Promise<string> {
    const isGit = await this.isGitRepository(projectRoot);
    if (!isGit) return '';
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat'], {
        cwd: projectRoot,
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }

  public async isWorkingTreeDirty(projectRoot: string): Promise<boolean> {
    const changes = await this.getWorkingTreeChanges(projectRoot);
    return (
      changes.added.length > 0 ||
      changes.modified.length > 0 ||
      changes.deleted.length > 0 ||
      changes.renamed.length > 0
    );
  }

  /**
   * Flags working tree changes that fall outside the expected task scope or allowed directories.
   */
  public async detectUnexpectedModifications(
    projectRoot: string,
    expectedScope: {
      declaredFiles?: string[];
      allowedDirectories?: string[];
    } = {}
  ): Promise<{
    allChanged: string[];
    expected: string[];
    unexpected: string[];
    isUnexpectedDetected: boolean;
  }> {
    const changes = await this.getWorkingTreeChanges(projectRoot);
    const allChanged = [
      ...changes.added,
      ...changes.modified,
      ...changes.deleted,
      ...changes.renamed.map((r) => r.to),
    ];

    const declaredSet = new Set(
      (expectedScope.declaredFiles || []).map((f) => path.normalize(f))
    );
    const allowedDirs = (expectedScope.allowedDirectories || []).map((d) =>
      path.normalize(d)
    );

    const expected: string[] = [];
    const unexpected: string[] = [];

    for (const changed of allChanged) {
      const normalized = path.normalize(changed);
      const isDirectlyDeclared = declaredSet.has(normalized);
      const isInAllowedDir = allowedDirs.some(
        (dir) => dir !== '.' && normalized.startsWith(dir)
      );

      if (isDirectlyDeclared || isInAllowedDir) {
        expected.push(changed);
      } else {
        unexpected.push(changed);
      }
    }

    return {
      allChanged,
      expected,
      unexpected,
      isUnexpectedDetected: unexpected.length > 0,
    };
  }

  private cleanPath(p: string): string {
    return p.replace(/^"|"$/g, '').trim();
  }
}

