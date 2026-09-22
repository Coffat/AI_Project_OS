import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { DoctorService } from '../../src/doctor/doctor-service.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { ExecutionSessionRepository } from '../../src/database/repositories/execution-session.repository.js';
import { ProjectInfo } from '../../src/core/types.js';

describe('DoctorService (Phase 20)', () => {
  let tempDir: string;
  let dbClient: SQLiteDatabaseClient;
  let doctorService: DoctorService;
  let projectRepo: ProjectRepository;
  let defaultProject: ProjectInfo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));

    // Create required .ai directory structure
    fs.mkdirSync(path.join(tempDir, '.ai', 'state'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.ai', 'canonical', 'DECISIONS'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.ai', 'handoff'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.ai', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.ai', 'proposals'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.ai', 'backups'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });

    // Canonical memory markdown files with required H1 headers
    fs.writeFileSync(
      path.join(tempDir, '.ai', 'canonical', 'PROJECT.md'),
      '# Project Overview\n\nComprehensive project overview for testing the doctor service.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempDir, '.ai', 'canonical', 'ARCHITECTURE.md'),
      '# Architecture Guidelines\n\nLayered modular architecture with SQLite persistence.',
      'utf-8'
    );
    fs.writeFileSync(
      path.join(tempDir, '.ai', 'canonical', 'CONSTRAINTS.md'),
      '# Technical Constraints\n\nDeterministic retrieval and strict type safety.',
      'utf-8'
    );

    // Sample source file
    fs.writeFileSync(
      path.join(tempDir, 'src', 'index.ts'),
      'export function hello(): string {\n  return "world";\n}\n',
      'utf-8'
    );

    // SQLite database
    const dbPath = path.join(tempDir, '.ai', 'state', 'project-os.sqlite');
    dbClient = new SQLiteDatabaseClient(dbPath);
    doctorService = new DoctorService(dbClient.db, tempDir);

    projectRepo = new ProjectRepository(dbClient.db);
    defaultProject = projectRepo.create({
      name: 'test-project',
      rootPath: tempDir,
    });
  });

  afterEach(() => {
    try {
      dbClient.close();
    } catch {
      // ignore
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('diagnose()', () => {
    it('should diagnose healthy state for indexed workspace', async () => {
      // Index workspace first so index freshness passes
      await doctorService.reindex();

      const report = await doctorService.diagnose();

      expect(report.overallStatus).toBe('healthy');
      expect(report.summary.errors).toBe(0);
      expect(report.checks.length).toBeGreaterThan(0);

      const dbCheck = report.checks.find((c) => c.category === 'database' && c.name.includes('Integrity'));
      expect(dbCheck?.status).toBe('ok');

      const fsCheck = report.checks.find((c) => c.category === 'filesystem');
      expect(fsCheck?.status).toBe('ok');

      const memCheck = report.checks.find((c) => c.category === 'memory');
      expect(memCheck?.status).toBe('ok');
    });

    it('should detect missing .ai directories', async () => {
      // Remove a critical directory
      fs.rmSync(path.join(tempDir, '.ai', 'tasks'), { recursive: true, force: true });

      const report = await doctorService.diagnose();
      const fsCheck = report.checks.find((c) => c.category === 'filesystem');
      expect(fsCheck?.status).not.toBe('ok');
      expect(fsCheck?.message).toContain('.ai/tasks');
    });

    it('should detect orphaned graph edges and stale sessions', async () => {
      const graphService = new GraphService(dbClient.db);
      // Insert valid source node
      const node = await graphService.addNode({
        projectId: defaultProject.id,
        entityType: 'file',
        label: 'src/index.ts',
        name: 'index.ts',
        path: 'src/index.ts',
        metadata: {},
      });

      // Insert edge referencing non-existent target node with foreign keys temporarily off
      dbClient.db.exec('PRAGMA foreign_keys = OFF;');
      dbClient.db.exec(
        `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at)
         VALUES ('edge-orphan-1', '${defaultProject.id}', '${node.id}', 'non-existent-node', 'imports', 1.0, '{}', ${Date.now()})`
      );
      dbClient.db.exec('PRAGMA foreign_keys = ON;');

      const taskRepo = new TaskRepository(dbClient.db);
      const task = taskRepo.create({
        projectId: defaultProject.id,
        title: 'test task',
        description: 'feature task',
      });

      const oldTimestamp = Date.now() - 24 * 60 * 60 * 1000;
      dbClient.db.exec(
        `INSERT INTO execution_sessions (id, project_id, task_id, provider, agent, started_at, status, created_at, updated_at)
         VALUES ('stale-session-1', '${defaultProject.id}', '${task.id}', 'claude', 'coder', ${oldTimestamp}, 'active', ${oldTimestamp}, ${oldTimestamp})`
      );

      const report = await doctorService.diagnose();
      const graphCheck = report.checks.find((c) => c.category === 'graph' && c.status !== 'ok');
      const sessionCheck = report.checks.find((c) => c.category === 'session' && c.status !== 'ok');

      expect(graphCheck).toBeDefined();
      expect(sessionCheck).toBeDefined();
      expect(report.overallStatus).not.toBe('healthy');
    });
  });

  describe('repair()', () => {
    it('should recreate missing directories, fix orphaned edges and recover stale sessions', async () => {
      // 1. Remove tasks directory
      fs.rmSync(path.join(tempDir, '.ai', 'tasks'), { recursive: true, force: true });

      // 2. Add orphaned edge with foreign keys temporarily off
      const graphService = new GraphService(dbClient.db);
      const node = await graphService.addNode({
        projectId: defaultProject.id,
        entityType: 'file',
        label: 'src/index.ts',
        name: 'index.ts',
        path: 'src/index.ts',
        metadata: {},
      });
      dbClient.db.exec('PRAGMA foreign_keys = OFF;');
      dbClient.db.exec(
        `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation_type, weight, metadata_json, created_at)
         VALUES ('edge-orphan-2', '${defaultProject.id}', '${node.id}', 'non-existent-node-2', 'imports', 1.0, '{}', ${Date.now()})`
      );
      dbClient.db.exec('PRAGMA foreign_keys = ON;');

      // 3. Add stale session
      const taskRepo = new TaskRepository(dbClient.db);
      const task = taskRepo.create({
        projectId: defaultProject.id,
        title: 'test task 2',
        description: 'feature task 2',
      });
      const oldTimestamp = Date.now() - 24 * 60 * 60 * 1000;
      dbClient.db.exec(
        `INSERT INTO execution_sessions (id, project_id, task_id, provider, agent, started_at, status, created_at, updated_at)
         VALUES ('stale-session-2', '${defaultProject.id}', '${task.id}', 'gemini', 'planner', ${oldTimestamp}, 'active', ${oldTimestamp}, ${oldTimestamp})`
      );

      const repairReport = await doctorService.repair(defaultProject.id);

      expect(repairReport.success).toBe(true);
      expect(repairReport.repairedItems.length).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(tempDir, '.ai', 'tasks'))).toBe(true);

      // Verify orphaned edge removed
      const stmt = dbClient.db.prepare(
        `SELECT id FROM graph_edges WHERE id = 'edge-orphan-2'`
      );
      const remainingEdges = stmt.all();
      expect(remainingEdges.length).toBe(0);

      // Verify stale session transitioned to ended
      const sessionRepo = new ExecutionSessionRepository(dbClient.db);
      const session = sessionRepo.findById('stale-session-2');
      expect(session?.status).toBe('ended');
    });
  });

  describe('reindex() and rebuildGraph()', () => {
    it('should reindex source code and populate code index', async () => {
      const result = await doctorService.reindex();
      expect(result.filesIndexed).toBeGreaterThanOrEqual(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should rebuild graph from AST without errors', async () => {
      const result = await doctorService.rebuildGraph();
      expect(result.projectId).toBe(defaultProject.id);
      expect(result.nodesCreated).toBeGreaterThanOrEqual(1);
    });
  });

  describe('validate()', () => {
    it('should run comprehensive system validation', async () => {
      const result = await doctorService.validate();
      expect(result.valid).toBe(true);
      expect(result.databaseValid).toBe(true);
      expect(result.graphReport.isValid).toBe(true);
      expect(result.memoryReport.isValid).toBe(true);
    });
  });

  describe('backup() and restore()', () => {
    it('should create an atomic backup and restore from it safely', async () => {
      // 1. Create canonical memory file
      fs.writeFileSync(
        path.join(tempDir, '.ai', 'canonical', 'DECISIONS', 'ADR-001.md'),
        '# ADR 001\nWe use SQLite.',
        'utf-8'
      );

      // 2. Perform backup
      const backupDir = path.join(tempDir, 'my-backups');
      const backupResult = await doctorService.backup(backupDir);

      expect(backupResult.success).toBe(true);
      expect(fs.existsSync(backupResult.backupDir)).toBe(true);
      expect(fs.existsSync(path.join(backupResult.backupDir, 'manifest.json'))).toBe(true);

      const manifestContent = JSON.parse(
        fs.readFileSync(path.join(backupResult.backupDir, 'manifest.json'), 'utf-8')
      );
      expect(manifestContent.files.length).toBeGreaterThanOrEqual(1);
      expect(manifestContent.databaseIncluded).toBe(true);

      // 3. Mutate workspace (modify ADR-001)
      fs.writeFileSync(
        path.join(tempDir, '.ai', 'canonical', 'DECISIONS', 'ADR-001.md'),
        '# ADR 001 - Corrupted/Mutated Content',
        'utf-8'
      );

      // 4. Restore from backup
      const restoreResult = await doctorService.restore(backupResult.backupDir);
      expect(restoreResult.success).toBe(true);
      expect(restoreResult.filesRestored).toBeGreaterThanOrEqual(1);
      expect(restoreResult.preRestoreBackupDir).toBeDefined();

      // 5. Verify restored file content
      const restoredAdr = fs.readFileSync(
        path.join(tempDir, '.ai', 'canonical', 'DECISIONS', 'ADR-001.md'),
        'utf-8'
      );
      expect(restoredAdr).toBe('# ADR 001\nWe use SQLite.');
    });
  });
});
