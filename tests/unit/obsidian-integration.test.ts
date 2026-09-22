import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { ConstraintRepository } from '../../src/database/repositories/constraint.repository.js';
import { ObsidianLedgerRepository } from '../../src/database/repositories/obsidian-ledger.repository.js';
import { ObsidianLinker } from '../../src/obsidian/obsidian-linker.js';
import { ObsidianSyncService } from '../../src/obsidian/obsidian-sync-service.js';
import { ObsidianCLI } from '../../src/obsidian/obsidian-cli.js';

describe('Phase 9: Obsidian Integration (Human Knowledge Interface & Loop-Safe Sync)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let ledgerRepo: ObsidianLedgerRepository;
  let syncService: ObsidianSyncService;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-obsidian-test-'));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    constraintRepo = new ConstraintRepository(client.db);
    ledgerRepo = new ObsidianLedgerRepository(client.db);

    const project = projectRepo.create({
      name: 'Knowledge Vault Project',
      rootPath: tempDir,
    });
    projectId = project.id;

    // Seed test decision
    decisionRepo.create({
      id: 'DECISION-012',
      projectId,
      title: 'Adopt Hybrid Logical Clocks for Distributed Events',
      status: 'accepted',
      context: 'Physical clocks drift across distributed worker nodes.',
      decisionRationale: 'Implement Hybrid Logical Clock (HLC) with 64-bit integer timestamp ordering.',
      consequences: 'Requires causal metadata propagation in all message envelopes.',
      sourceFile: 'src/clocks/hlc.ts',
    });

    // Seed test constraint
    constraintRepo.create({
      id: 'CONSTRAINT-003',
      projectId,
      title: 'Deterministic State Replay',
      category: 'technology',
      enforcementLevel: 'mandatory',
      ruleContent: 'Zero AI hallucinations allowed for exit codes or state transitions.',
    });

    // Seed test task with steps and blockers
    const task = taskRepo.create({
      id: 'TASK-042',
      projectId,
      title: 'Build Clock Synchronizer Module',
      description: 'Implement HLC algorithm based on DECISION-012.',
      goal: 'Produce reliable monotonic timestamps for distributed event logs.',
      priority: 'high',
      assignedAgent: 'Agent-Cronos',
    });

    const step1 = taskRepo.addStep(task.id, 'Define HLC clock interface', 1);
    taskRepo.addStep(task.id, 'Implement clock tick and receive update', 2);
    taskRepo.updateStepStatus(step1.id, 'completed');
    taskRepo.attachFile(task.id, 'src/clocks/hlc.ts');

    syncService = new ObsidianSyncService(client.db, tempDir);
  });

  afterEach(() => {
    client.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  it('exports complete Obsidian vault structure to .ai/canonical/ with Wikilinks and Dataview frontmatter', async () => {
    const result = await syncService.sync({ projectId, direction: 'export_only' });

    expect(result.exportedFiles.length).toBeGreaterThanOrEqual(7);
    expect(result.conflicts).toHaveLength(0);

    const canonicalDir = path.join(tempDir, '.ai', 'canonical');

    // 1. Verify core pages exist
    expect(fs.existsSync(path.join(canonicalDir, 'INDEX.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'PROJECT.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'ARCHITECTURE.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'CONSTRAINTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'DECISIONS.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'TASKS.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'RESEARCH.md'))).toBe(true);

    // 2. Verify individual entity pages exist
    expect(fs.existsSync(path.join(canonicalDir, 'DECISIONS', 'DECISION-012.md'))).toBe(true);
    expect(fs.existsSync(path.join(canonicalDir, 'TASKS', 'TASK-042.md'))).toBe(true);

    // 3. Inspect INDEX.md
    const indexContent = fs.readFileSync(path.join(canonicalDir, 'INDEX.md'), 'utf8');
    expect(indexContent).toContain('---');
    expect(indexContent).toContain('title: "Knowledge Vault Project Knowledge Hub"');
    expect(indexContent).toContain('type: "index"');
    expect(indexContent).toContain('[[PROJECT]]');
    expect(indexContent).toContain('[[ARCHITECTURE]]');
    expect(indexContent).toContain('[[CONSTRAINTS]]');
    expect(indexContent).toContain('[[DECISIONS]]');
    expect(indexContent).toContain('[[TASKS]]');
    expect(indexContent).toContain('[[TASK-042]]');

    // 4. Inspect TASKS/TASK-042.md
    const taskContent = fs.readFileSync(path.join(canonicalDir, 'TASKS', 'TASK-042.md'), 'utf8');
    expect(taskContent).toContain('id: "TASK-042"');
    expect(taskContent).toContain('type: "task"');
    expect(taskContent).toContain('priority: "high"');
    expect(taskContent).toContain('tags: ["task", "planned", "high"]');
    expect(taskContent).toContain('## 🪜 Execution Plan & Steps');
    expect(taskContent).toContain('- [x] **Step 1**: Define HLC clock interface');
    expect(taskContent).toContain('- [ ] **Step 2**: Implement clock tick and receive update');
    expect(taskContent).toContain('[[CONSTRAINTS]]');
    expect(taskContent).toContain('[[TASKS]]');

    // 5. Inspect DECISIONS/DECISION-012.md
    const decisionContent = fs.readFileSync(path.join(canonicalDir, 'DECISIONS', 'DECISION-012.md'), 'utf8');
    expect(decisionContent).toContain('id: "DECISION-012"');
    expect(decisionContent).toContain('status: "accepted"');
    expect(decisionContent).toContain('## 📋 Context & Problem Statement');
    expect(decisionContent).toContain('Physical clocks drift across distributed worker nodes.');
    expect(decisionContent).toContain('## 🎯 Decision');
    expect(decisionContent).toContain('Implement Hybrid Logical Clock (HLC)');

    // 6. Verify sync ledger records in SQLite
    const ledgerEntries = ledgerRepo.listAll(projectId);
    expect(ledgerEntries.length).toBeGreaterThanOrEqual(7);
  });

  it('prevents infinite sync loops by verifying content hash against the sync ledger', async () => {
    // Initial sync
    const firstSync = await syncService.sync({ projectId });
    expect(firstSync.exportedFiles.length).toBeGreaterThan(0);
    expect(firstSync.unchangedFiles.length).toBe(0);

    // Immediate second sync without modifications
    const secondSync = await syncService.sync({ projectId });
    expect(secondSync.exportedFiles.length).toBe(0);
    expect(secondSync.importedFiles.length).toBe(0);
    expect(secondSync.unchangedFiles.length).toBe(firstSync.exportedFiles.length);
    expect(secondSync.conflicts).toHaveLength(0);
  });

  it('detects external manual edits in Obsidian and updates SQLite machine state', async () => {
    // Initial export to create markdown files
    await syncService.sync({ projectId, direction: 'export_only' });

    const taskFilePath = path.join(tempDir, '.ai', 'canonical', 'TASKS', 'TASK-042.md');
    expect(fs.existsSync(taskFilePath)).toBe(true);

    // Simulate Human editing in Obsidian:
    // Human marks task as done, checks step 2, and updates the title
    const originalContent = fs.readFileSync(taskFilePath, 'utf8');
    const humanEditedContent = originalContent
      .replace('title: "Build Clock Synchronizer Module"', 'title: "Build Production Clock Engine"')
      .replace('status: "planned"', 'status: "done"')
      .replace('- [ ] **Step 2**', '- [x] **Step 2**');

    fs.writeFileSync(taskFilePath, humanEditedContent, 'utf8');

    // Run sync (which triggers importModified)
    const syncResult = await syncService.sync({ projectId });

    expect(syncResult.importedFiles).toContain(path.join('TASKS', 'TASK-042.md'));

    // Check that SQLite was updated with human changes!
    const updatedTask = taskRepo.findById('TASK-042');
    expect(updatedTask?.title).toBe('Build Production Clock Engine');
    expect(updatedTask?.status).toBe('done');

    const updatedSteps = taskRepo.listSteps('TASK-042');
    const step2 = updatedSteps.find((s) => s.stepOrder === 2);
    expect(step2?.status).toBe('completed');
  });

  it('detects concurrent edits (conflict) and generates .conflict-<timestamp>.md without data loss', async () => {
    // Initial sync
    await syncService.sync({ projectId });

    const taskFilePath = path.join(tempDir, '.ai', 'canonical', 'TASKS', 'TASK-042.md');

    // 1. Human modifies Markdown in Obsidian
    const humanContent = fs.readFileSync(taskFilePath, 'utf8').replace(
      'Produce reliable',
      '[Human Note] We must also benchmark clock skew under high CPU load.\nProduce reliable'
    );
    fs.writeFileSync(taskFilePath, humanContent, 'utf8');

    // 2. Machine Agent modifies SQLite record concurrently
    taskRepo.update('TASK-042', {
      title: 'Agent Concurrent Title Update',
      priority: 'critical',
    });

    // 3. Trigger sync: must detect conflict!
    const syncResult = await syncService.sync({ projectId });

    expect(syncResult.conflicts.length).toBe(1);
    const conflict = syncResult.conflicts[0]!;
    expect(conflict.filePath).toBe(path.join('TASKS', 'TASK-042.md'));
    expect(conflict.message).toContain('Concurrent edit detected');

    // Verify conflict file was generated on disk
    const conflictFullPath = path.join(tempDir, '.ai', 'canonical', conflict.conflictFilePath);
    expect(fs.existsSync(conflictFullPath)).toBe(true);

    const savedConflictContent = fs.readFileSync(conflictFullPath, 'utf8');
    expect(savedConflictContent).toContain('[Human Note] We must also benchmark clock skew');

    // Verify primary file has agent's updated state
    const primaryContent = fs.readFileSync(taskFilePath, 'utf8');
    expect(primaryContent).toContain('Agent Concurrent Title Update');
  });

  it('runs ObsidianLinker methods: toWikilink, extractWikilinks, and linkEntities', () => {
    // toWikilink
    expect(ObsidianLinker.toWikilink('TASK-042')).toBe('[[TASK-042]]');
    expect(ObsidianLinker.toWikilink('TASK-042', 'Custom Label')).toBe('[[TASK-042|Custom Label]]');

    // extractWikilinks
    const doc = 'Check [[ARCHITECTURE]] and [[DECISION-012|ADR 12]] before working on [[TASK-042]].';
    const extracted = ObsidianLinker.extractWikilinks(doc);
    expect(extracted).toHaveLength(3);
    expect(extracted[0]!.target).toBe('ARCHITECTURE');
    expect(extracted[1]!.target).toBe('DECISION-012');
    expect(extracted[1]!.alias).toBe('ADR 12');
    expect(extracted[2]!.target).toBe('TASK-042');

    // linkEntities
    const rawText = 'We need to implement TASK-042 according to DECISION-012 guidelines.';
    const linked = ObsidianLinker.linkEntities(rawText, [
      { id: 'TASK-042', target: 'TASK-042' },
      { id: 'DECISION-012', target: 'DECISION-012', alias: 'ADR-012' },
    ]);
    expect(linked).toBe('We need to implement [[TASK-042]] according to [[DECISION-012|ADR-012]] guidelines.');
  });

  it('runs ObsidianCLI commands: status, export, import, and sync', async () => {
    const cli = new ObsidianCLI(client.db, tempDir);

    // 1. Initial status before sync
    const preStatus = await cli.run(['obsidian', 'status', `--project-id=${projectId}`]);
    expect(preStatus).toContain('Total Tracked:    0 file(s)');

    // 2. CLI Export
    const exportOutput = await cli.run(['obsidian', 'export', `--project-id=${projectId}`]);
    expect(exportOutput).toContain('Exported');

    // 3. CLI Status after export
    const postStatus = await cli.run(['obsidian', 'status', `--project-id=${projectId}`]);
    expect(postStatus).toContain('[✓] SYNCED');
    expect(postStatus).toContain('PROJECT.md');
    expect(postStatus).toContain('INDEX.md');

    // 4. CLI Sync
    const syncOutput = await cli.run(['obsidian', 'sync', `--project-id=${projectId}`]);
    expect(syncOutput).toContain('OBSIDIAN VAULT SYNCHRONIZATION');
    expect(syncOutput).toContain('Status: SUCCESS');
  });
});
