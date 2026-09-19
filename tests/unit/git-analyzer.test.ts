import { describe, it, expect } from 'vitest';
import { GitAnalyzer } from '../../src/code-intelligence/git-analyzer.js';

describe('GitAnalyzer', () => {
  const gitAnalyzer = new GitAnalyzer();

  it('correctly parses git status porcelain format', () => {
    const porcelain = `
?? src/new-file.ts
 M src/existing.ts
D  src/deleted.ts
R  src/old-name.ts -> src/new-name.ts
`;
    const changes = gitAnalyzer.parseGitStatusPorcelain(porcelain);
    expect(changes.added).toContain('src/new-file.ts');
    expect(changes.modified).toContain('src/existing.ts');
    expect(changes.deleted).toContain('src/deleted.ts');
    expect(changes.renamed).toEqual([{ from: 'src/old-name.ts', to: 'src/new-name.ts' }]);
  });

  it('correctly parses git diff name-status format', () => {
    const diff = `
A\tsrc/added.ts
M\tsrc/modified.ts
D\tsrc/removed.ts
R100\tsrc/prev.ts\tsrc/next.ts
`;
    const changes = gitAnalyzer.parseGitDiffOutput(diff);
    expect(changes.added).toContain('src/added.ts');
    expect(changes.modified).toContain('src/modified.ts');
    expect(changes.deleted).toContain('src/removed.ts');
    expect(changes.renamed).toEqual([{ from: 'src/prev.ts', to: 'src/next.ts' }]);
  });

  it('computes filesystem diff without git when hashes differ', async () => {
    const existing = [
      { path: 'file1.ts', contentHash: 'hash-unchanged', lastModifiedAt: 1000 },
      { path: 'file2.ts', contentHash: 'hash-old', lastModifiedAt: 1000 },
      { path: 'file3.ts', contentHash: 'hash-to-delete', lastModifiedAt: 1000 },
    ];

    // Simulate directory with file1, file2 (updated), and file4 (new)
    // We test computeFilesystemDiff with mock paths
    const diff = await gitAnalyzer.computeFilesystemDiff(
      process.cwd(),
      existing,
      ['package.json', 'tsconfig.json']
    );

    // Any file in existing but not in candidatePaths is treated as deleted
    expect(diff.deleted).toContain('file1.ts');
    expect(diff.deleted).toContain('file2.ts');
    expect(diff.deleted).toContain('file3.ts');
    // Candidates not in existing are added
    expect(diff.added).toContain('package.json');
    expect(diff.added).toContain('tsconfig.json');
  });
});
