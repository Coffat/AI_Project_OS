import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { ConstraintRepository } from '../../src/database/repositories/constraint.repository.js';
import { ProposalRepository } from '../../src/database/repositories/proposal.repository.js';
import { NotebookFirewall } from '../../src/notebook/notebook-firewall.js';
import { NotebookManifestBuilder } from '../../src/notebook/notebook-manifest.js';
import { NotebookExporter } from '../../src/notebook/notebook-exporter.js';
import { NotebookProposalService } from '../../src/notebook/notebook-proposal-service.js';
import { NotebookCLI } from '../../src/notebook/notebook-cli.js';
import { FirewallViolationError } from '../../src/core/errors.js';

describe('Phase 10: NotebookLM Knowledge Bridge', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let proposalRepo: ProposalRepository;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-notebook-test-'));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    projectRepo = new ProjectRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    constraintRepo = new ConstraintRepository(client.db);
    proposalRepo = new ProposalRepository(client.db);

    const project = projectRepo.create({
      name: 'Notebook Test Project',
      description: 'Integration test project for Phase 10',
      rootPath: tempDir,
    });
    projectId = project.id;

    decisionRepo.create({
      id: 'DECISION-001',
      projectId,
      title: 'Use SQLite as machine state',
      context: 'Need a reliable, local-first storage layer.',
      decisionRationale: 'SQLite is embedded, zero-config, and battle-tested.',
      consequences: 'All state queries must go through the repository layer.',
      status: 'accepted',
    });

    constraintRepo.create({
      projectId,
      category: 'security',
      title: 'No secrets in NotebookLM',
      ruleContent: 'API keys, tokens, and .env files must never be exported.',
      enforcementLevel: 'mandatory',
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. NotebookFirewall
  // ---------------------------------------------------------------------------

  describe('NotebookFirewall', () => {
    it('blocks source code extensions', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('src/index.ts')).toThrow(FirewallViolationError);
      expect(() => fw.validate('server.py')).toThrow(FirewallViolationError);
      expect(() => fw.validate('main.go')).toThrow(FirewallViolationError);
    });

    it('blocks node_modules and build subtrees', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('node_modules/lodash/index.js')).toThrow(FirewallViolationError);
      expect(() => fw.validate('dist/bundle.js')).toThrow(FirewallViolationError);
      expect(() => fw.validate('build/output.js')).toThrow(FirewallViolationError);
    });

    it('blocks secrets and env files', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('.env')).toThrow(FirewallViolationError);
      expect(() => fw.validate('.env.local')).toThrow(FirewallViolationError);
      expect(() => fw.validate('server.pem')).toThrow(FirewallViolationError);
      expect(() => fw.validate('private.key')).toThrow(FirewallViolationError);
    });

    it('blocks .ai/handoff, .ai/state, and .ai/tasks runtime directories', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('.ai/handoff/CURRENT.json')).toThrow(FirewallViolationError);
      expect(() => fw.validate('.ai/state/session.json')).toThrow(FirewallViolationError);
      expect(() => fw.validate('.ai/tasks/TASK-001.json')).toThrow(FirewallViolationError);
    });

    it('blocks log files and temporary files', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('app.log')).toThrow(FirewallViolationError);
      expect(() => fw.validate('logs/error.log')).toThrow(FirewallViolationError);
      expect(() => fw.validate('cache.tmp')).toThrow(FirewallViolationError);
      expect(() => fw.validate('backup.bak')).toThrow(FirewallViolationError);
      expect(() => fw.validate('editor.swp')).toThrow(FirewallViolationError);
      expect(() => fw.validate('data.temp')).toThrow(FirewallViolationError);
    });

    it('allows canonical Markdown documents', () => {
      const fw = new NotebookFirewall();
      expect(() => fw.validate('.ai/canonical/PROJECT.md')).not.toThrow();
      expect(() => fw.validate('.ai/canonical/DECISIONS/DECISION-001.md')).not.toThrow();
      expect(() => fw.validate('.ai/notebook/ARCHITECTURE.md')).not.toThrow();
      expect(() => fw.validate('README.md')).not.toThrow();
    });

    it('blocks oversized files via check()', () => {
      const fw = new NotebookFirewall();
      const result = fw.check('docs/huge.md', 600 * 1024); // 600 KB
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/500 KB/);
    });

    it('filterAllowed removes blocked paths without throwing', () => {
      const fw = new NotebookFirewall();
      const filtered = fw.filterAllowed([
        '.ai/canonical/PROJECT.md',
        'src/index.ts',
        '.env',
        '.ai/notebook/DECISIONS.md',
      ]);
      expect(filtered).toEqual(['.ai/canonical/PROJECT.md', '.ai/notebook/DECISIONS.md']);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. NotebookManifestBuilder
  // ---------------------------------------------------------------------------

  describe('NotebookManifestBuilder', () => {
    it('builds a manifest for an empty project root', () => {
      const builder = new NotebookManifestBuilder(tempDir);
      const manifest = builder.build({ projectId });

      expect(manifest.projectId).toBe(projectId);
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.firewallVerified).toBe(true);
      expect(Array.isArray(manifest.sources)).toBe(true);
      expect(Array.isArray(manifest.excludedPatterns)).toBe(true);
      expect(manifest.excludedPatterns.length).toBeGreaterThan(0);
    });

    it('includes canonical files that exist', () => {
      const canonicalDir = path.join(tempDir, '.ai', 'canonical');
      fs.mkdirSync(canonicalDir, { recursive: true });
      fs.writeFileSync(
        path.join(canonicalDir, 'PROJECT.md'),
        '# My Project\n\nThis is the project knowledge.\n'
      );

      const builder = new NotebookManifestBuilder(tempDir);
      const manifest = builder.build({ projectId });

      const projectSource = manifest.sources.find((s) =>
        s.relativePath.includes('PROJECT.md')
      );
      expect(projectSource).toBeDefined();
      expect(projectSource!.wordCount).toBeGreaterThan(0);
      expect(projectSource!.sha256).toHaveLength(64);
      expect(projectSource!.category).toBe('canonical_project');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. NotebookExporter
  // ---------------------------------------------------------------------------

  describe('NotebookExporter', () => {
    it('exports knowledge pack with all required files', async () => {
      const outDir = path.join(tempDir, '.ai', 'notebook');
      const exporter = new NotebookExporter(client.db, tempDir);

      const result = await exporter.export({ projectId, outDir });

      expect(result.projectId).toBe(projectId);
      expect(result.exportedFiles.length).toBeGreaterThan(0);

      // PROJECT-KNOWLEDGE.md
      const projectFile = path.join(outDir, 'PROJECT-KNOWLEDGE.md');
      expect(fs.existsSync(projectFile)).toBe(true);
      const projectContent = fs.readFileSync(projectFile, 'utf8');
      expect(projectContent).toContain('Notebook Test Project');

      // DECISIONS.md
      const decisionsFile = path.join(outDir, 'DECISIONS.md');
      expect(fs.existsSync(decisionsFile)).toBe(true);
      const decisionsContent = fs.readFileSync(decisionsFile, 'utf8');
      expect(decisionsContent).toContain('DECISION-001');
      expect(decisionsContent).toContain('Use SQLite as machine state');

      // SOURCES.md
      expect(fs.existsSync(path.join(outDir, 'SOURCES.md'))).toBe(true);

      // README.md
      const readmeFile = path.join(outDir, 'README.md');
      expect(fs.existsSync(readmeFile)).toBe(true);
      const readmeContent = fs.readFileSync(readmeFile, 'utf8');
      expect(readmeContent).toContain('Google Drive & NotebookLM Workflow');

      // manifest.json
      const manifestFile = path.join(outDir, 'manifest.json');
      expect(fs.existsSync(manifestFile)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      expect(manifest.firewallVerified).toBe(true);
    });

    it('PROJECT-KNOWLEDGE.md includes constraints section', async () => {
      const exporter = new NotebookExporter(client.db, tempDir);
      const result = await exporter.export({ projectId });
      const projectFile = result.exportedFiles.find((f) => f.endsWith('PROJECT-KNOWLEDGE.md'));
      expect(projectFile).toBeDefined();
      const content = fs.readFileSync(projectFile!, 'utf8');
      expect(content).toContain('No secrets in NotebookLM');
    });

    it('falls back to project root ARCHITECTURE.md when .ai/canonical is absent', async () => {
      fs.writeFileSync(
        path.join(tempDir, 'ARCHITECTURE.md'),
        '# Root Architecture\n\nFallback architecture doc.'
      );
      const exporter = new NotebookExporter(client.db, tempDir);
      const outDir = path.join(tempDir, '.ai', 'notebook');
      const result = await exporter.export({ projectId, outDir });
      const archFile = path.join(outDir, 'ARCHITECTURE.md');
      expect(fs.existsSync(archFile)).toBe(true);
      expect(fs.readFileSync(archFile, 'utf8')).toContain('Fallback architecture doc');
      expect(result.warnings.length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ProposalRepository
  // ---------------------------------------------------------------------------

  describe('ProposalRepository', () => {
    it('creates and retrieves a proposal', () => {
      const proposal = proposalRepo.create({
        projectId,
        title: 'Should we adopt LLM-based code review?',
        question: 'Can AI code review improve our defect detection rate?',
        sources: ['https://arxiv.org/abs/2302.00000'],
        confidence: 'medium',
      });

      expect(proposal.id).toBeTruthy();
      expect(proposal.status).toBe('draft');
      expect(proposal.sources).toEqual(['https://arxiv.org/abs/2302.00000']);

      const found = proposalRepo.findById(proposal.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Should we adopt LLM-based code review?');
    });

    it('lists proposals by project and status', () => {
      proposalRepo.create({ projectId, title: 'P1', question: 'Q1' });
      proposalRepo.create({ projectId, title: 'P2', question: 'Q2', status: 'approved' });

      const all = proposalRepo.listByProject(projectId);
      expect(all.length).toBe(2);

      const drafts = proposalRepo.listByProject(projectId, 'draft');
      expect(drafts.length).toBe(1);
      expect(drafts[0]!.title).toBe('P1');
    });

    it('updates a proposal', () => {
      const p = proposalRepo.create({ projectId, title: 'Old Title', question: 'Q' });
      const updated = proposalRepo.update(p.id, { title: 'New Title', findings: 'Found something.' });
      expect(updated.title).toBe('New Title');
      expect(updated.findings).toBe('Found something.');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. NotebookProposalService — lifecycle
  // ---------------------------------------------------------------------------

  describe('NotebookProposalService', () => {
    let service: NotebookProposalService;

    beforeEach(() => {
      service = new NotebookProposalService(client.db, tempDir);
    });

    it('creates a proposal and writes PROPOSAL-XXX.md to disk immediately', () => {
      const p = service.createProposal({
        projectId,
        title: 'Adopt vector embeddings for semantic search',
        question: 'Will vector search improve retrieval quality vs BM25?',
        confidence: 'high',
      });
      expect(p.id).toMatch(/^PROPOSAL-/);
      expect(p.status).toBe('draft');
      const proposalFile = path.join(tempDir, '.ai', 'proposals', `${p.id}.md`);
      expect(fs.existsSync(proposalFile)).toBe(true);
      const content = fs.readFileSync(proposalFile, 'utf8');
      expect(content).toContain('Adopt vector embeddings');
      expect(content).toContain('Will vector search improve');
    });

    it('approves a proposal and creates an ADR', () => {
      const p = service.createProposal({
        projectId,
        title: 'Switch to HNSW indexing',
        question: 'Which ANN algorithm gives best precision/recall trade-off?',
        findings: 'HNSW achieves 97% recall at 10ms p99 on our dataset.',
        proposedChanges: 'Replace FAISS flat index with HNSW in vector store.',
        confidence: 'high',
      });

      const approved = service.approveProposal(p.id, 'lead-engineer');

      expect(approved.status).toBe('approved');
      expect(approved.promotedDecisionId).toMatch(/^DECISION-/);
      expect(approved.reviewedBy).toBe('lead-engineer');

      // ADR must exist in decisions table
      const decision = decisionRepo.findById(approved.promotedDecisionId!);
      expect(decision).toBeDefined();
      expect(decision!.title).toBe('Switch to HNSW indexing');
      expect(decision!.status).toBe('accepted');
      expect(decision!.decisionRationale).toContain('HNSW achieves 97%');

      // PROPOSAL-XXX.md must be written to disk
      const proposalFile = path.join(tempDir, '.ai', 'proposals', `${p.id}.md`);
      expect(fs.existsSync(proposalFile)).toBe(true);
      const content = fs.readFileSync(proposalFile, 'utf8');
      expect(content).toContain('HNSW indexing');
      expect(content).toContain(approved.promotedDecisionId!);
    });

    it('rejects a proposal', () => {
      const p = service.createProposal({
        projectId,
        title: 'Abandon type safety',
        question: 'Should we remove TypeScript?',
      });
      const rejected = service.rejectProposal(p.id, 'TypeScript is a hard constraint', 'architect');
      expect(rejected.status).toBe('rejected');
      expect(rejected.reviewComment).toBe('TypeScript is a hard constraint');
    });

    it('fails to approve a proposal with no findings', () => {
      const p = service.createProposal({
        projectId,
        title: 'Empty proposal',
        question: 'Does this work?',
      });
      expect(() => service.approveProposal(p.id)).toThrow(/findings/i);
    });

    it('parses proposal Markdown correctly', () => {
      const md = [
        '# My Research Proposal',
        '',
        '**Confidence:** high',
        '',
        '## Question',
        '',
        'Is LLM-driven review feasible?',
        '',
        '## Sources',
        '',
        '- https://arxiv.org/abc',
        '- https://papers.cool/xyz',
        '',
        '## Findings',
        '',
        'Early results show 40% defect reduction.',
        '',
        '## Proposed Changes',
        '',
        'Integrate GPT-4 review step into CI pipeline.',
        '',
        '## Open Questions',
        '',
        '- Cost implications?',
        '- False positive rate?',
      ].join('\n');

      const parsed = service.parseMarkdown(md);
      expect(parsed.title).toBe('My Research Proposal');
      expect(parsed.question).toBe('Is LLM-driven review feasible?');
      expect(parsed.sources).toEqual(['https://arxiv.org/abc', 'https://papers.cool/xyz']);
      expect(parsed.findings).toBe('Early results show 40% defect reduction.');
      expect(parsed.confidence).toBe('high');
      expect(parsed.openQuestions).toContain('Cost implications?');
    });

    it('ingests a proposal from a Markdown file', () => {
      const proposalMd = [
        '# Vector DB Evaluation',
        '',
        '**Confidence:** medium',
        '',
        '## Question',
        '',
        'Which vector DB should we use?',
        '',
        '## Findings',
        '',
        'Qdrant has the best Rust-native client.',
        '',
        '## Proposed Changes',
        '',
        'Switch from pgvector to Qdrant.',
      ].join('\n');

      const mdPath = path.join(tempDir, 'vector-db-proposal.md');
      fs.writeFileSync(mdPath, proposalMd, 'utf8');

      const ingested = service.ingestFromMarkdown(mdPath, projectId);
      expect(ingested.title).toBe('Vector DB Evaluation');
      expect(ingested.status).toBe('under_review');
      expect(ingested.findings).toBe('Qdrant has the best Rust-native client.');
      const proposalFile = path.join(tempDir, '.ai', 'proposals', `${ingested.id}.md`);
      expect(fs.existsSync(proposalFile)).toBe(true);
      expect(fs.readFileSync(proposalFile, 'utf8')).toContain('Qdrant has the best');
    });

    it('rejects ingesting a source code file', () => {
      const tsPath = path.join(tempDir, 'something.ts');
      fs.writeFileSync(tsPath, 'export const x = 1;', 'utf8');
      expect(() => service.ingestFromMarkdown(tsPath, projectId)).toThrow(FirewallViolationError);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. NotebookCLI
  // ---------------------------------------------------------------------------

  describe('NotebookCLI', () => {
    let cli: NotebookCLI;

    beforeEach(() => {
      cli = new NotebookCLI(client.db, tempDir);
    });

    it('shows help when no args', async () => {
      const out = await cli.run([]);
      expect(out).toContain('notebook');
      expect(out).toContain('export');
      expect(out).toContain('manifest');
      expect(out).toContain('proposal');
    });

    it('exports knowledge pack via CLI', async () => {
      const outDir = path.join(tempDir, '.ai', 'notebook');
      const out = await cli.run([
        'notebook', 'export',
        '--project-id', projectId,
        '--out-dir', outDir,
      ]);
      expect(out).toContain('NOTEBOOKLM KNOWLEDGE PACK EXPORT');
      expect(out).toContain(projectId);
      expect(fs.existsSync(path.join(outDir, 'PROJECT-KNOWLEDGE.md'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'README.md'))).toBe(true);
    });

    it('displays formatted manifest table via CLI', async () => {
      const out = await cli.run([
        'notebook', 'manifest',
        '--project-id', projectId,
      ]);
      expect(out).toContain('NOTEBOOKLM KNOWLEDGE MANIFEST');
      expect(out).toContain(projectId);
      expect(out).toContain('Firewall');
      expect(out).toContain('VERIFIED');
    });

    it('outputs manifest JSON via CLI --json', async () => {
      const out = await cli.run([
        'notebook', 'manifest',
        '--project-id', projectId,
        '--json',
      ]);
      const parsed = JSON.parse(out);
      expect(parsed.projectId).toBe(projectId);
      expect(parsed.firewallVerified).toBe(true);
      expect(Array.isArray(parsed.sources)).toBe(true);
    });

    it('writes manifest.json to disk via CLI --write', async () => {
      const outDir = path.join(tempDir, '.ai', 'notebook');
      const out = await cli.run([
        'notebook', 'manifest',
        '--project-id', projectId,
        '--write',
        '--out-dir', outDir,
      ]);
      expect(out).toContain('Manifest written to');
      const manifestFile = path.join(outDir, 'manifest.json');
      expect(fs.existsSync(manifestFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      expect(content.projectId).toBe(projectId);
    });

    it('creates and lists proposals via CLI', async () => {
      const createOut = await cli.run([
        'notebook', 'proposal', 'create',
        '--project-id', projectId,
        '--title', 'CLI Test Proposal',
        '--question', 'Does the CLI work?',
      ]);
      expect(createOut).toContain('CLI Test Proposal');

      const listOut = await cli.run([
        'notebook', 'proposal', 'list',
        '--project-id', projectId,
      ]);
      expect(listOut).toContain('CLI Test Proposal');
      expect(listOut).toContain('draft');
    });
  });
});
