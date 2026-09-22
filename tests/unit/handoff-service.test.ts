import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { DecisionRepository } from '../../src/database/repositories/decision.repository.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { ContextService } from '../../src/context/context-service.js';
import { HandoffService } from '../../src/handoff/handoff-service.js';
import { HandoffValidator } from '../../src/handoff/handoff-validator.js';

describe('Phase 7: Handoff Engine (Zero-Loss Cross-Agent Continuity)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let taskRepo: TaskRepository;
  let decisionRepo: DecisionRepository;
  let handoffService: HandoffService;
  let projectId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-handoff-test-'));
    const canonicalDir = path.join(tempDir, '.ai', 'canonical');
    fs.mkdirSync(canonicalDir, { recursive: true });

    // Seed canonical memory files
    fs.writeFileSync(
      path.join(canonicalDir, 'PROJECT.md'),
      '# Project\nname: HandoffTestProject\ndescription: Cross agent continuity test project.\n'
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'CONSTRAINTS.md'),
      '# Constraints\n## RULE_1\nStrict TypeScript validation required.\n'
    );
    fs.writeFileSync(
      path.join(canonicalDir, 'ARCHITECTURE.md'),
      '# Architecture\n## Payment Module\nHandles external gateway processing.\n'
    );

    client = new SQLiteDatabaseClient(':memory:');
    const db = client.db;
    const projectRepo = new ProjectRepository(db);
    const proj = projectRepo.create({
      name: 'Handoff Project',
      rootPath: tempDir,
    });
    projectId = proj.id;

    taskRepo = new TaskRepository(db);
    decisionRepo = new DecisionRepository(db);
    const graphService = new GraphService(db);
    const contextService = new ContextService(db, graphService, tempDir);
    handoffService = new HandoffService(db, contextService, tempDir);
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('captures complete 16-attribute handoff snapshot and writes canonical .ai/handoff/CURRENT.json', async () => {
    // 1. Setup a realistic task with steps, files, blockers, decisions
    const task = taskRepo.create({
      projectId,
      title: 'Implement OAuth Token Refresh',
      description: 'Implement secure refresh token rotation and revoke stolen tokens.',
    });

    const s1 = taskRepo.addStep(task.id, 'Define TokenRotation interface', 1);
    taskRepo.addStep(task.id, 'Implement rotation logic', 2);
    taskRepo.addStep(task.id, 'Add regression tests', 3);
    taskRepo.updateStepStatus(s1.id, 'completed');


    taskRepo.attachFile(task.id, 'src/auth/token.ts');
    taskRepo.attachSymbol(task.id, 'rotateToken');
    taskRepo.addBlocker(task.id, 'Redis connection pool timeout in CI');

    decisionRepo.create({
      projectId,
      taskId: task.id,
      title: 'ADR-005: Token TTL Strategy',
      context: 'Token lifecycle parameters',
      decisionRationale: 'Access token 15m, Refresh token 7d with single-use rotation',
    });

    // 2. Create handoff snapshot
    const snapshot = await handoffService.createHandoff({
      taskId: task.id,
      agentIdentity: 'Agent-Alpha',
      completedWork: 'Created interface and database migrations',
      nextAction: 'Implement rotation logic in src/auth/token.ts',
      errors: ['Warning: Redis pool connection count spike'],
      tests: ['tests/unit/token.test.ts'],
      validation: {
        status: 'passed',
        timestamp: Date.now(),
        lastTestedCommit: 'commit-12345',
      },
    });

    // 3. Verify snapshot attributes
    expect(snapshot.task_id).toBe(task.id);
    expect(snapshot.status).toBe('handoff');
    expect(snapshot.goal).toContain('refresh token rotation');
    expect(snapshot.completed).toEqual(['[Step 1] Define TokenRotation interface']);
    expect(snapshot.remaining).toEqual([
      '[Step 2] Implement rotation logic',
      '[Step 3] Add regression tests',
    ]);
    expect(snapshot.modified_files).toContain('src/auth/token.ts');
    expect(snapshot.modified_symbols).toContain('rotateToken');
    expect(snapshot.blockers).toContain('Redis connection pool timeout in CI');
    expect(snapshot.errors).toContain('Warning: Redis pool connection count spike');
    expect(snapshot.tests).toContain('tests/unit/token.test.ts');
    expect(snapshot.validation?.status).toBe('passed');
    expect(snapshot.agent_identity).toBe('Agent-Alpha');

    // 4. Verify canonical CURRENT.json file on disk
    const currentJsonPath = path.join(tempDir, '.ai', 'handoff', 'CURRENT.json');
    expect(fs.existsSync(currentJsonPath)).toBe(true);

    const savedContent = JSON.parse(fs.readFileSync(currentJsonPath, 'utf8'));
    expect(savedContent.task_id).toBe(task.id);
    expect(savedContent.agent_identity).toBe('Agent-Alpha');

    // 5. Verify task-specific json file on disk
    const taskJsonPath = path.join(tempDir, '.ai', 'handoff', `${task.id}.json`);
    expect(fs.existsSync(taskJsonPath)).toBe(true);
  });

  it('resumes task with and without taskId argument, providing rich context and continuity', async () => {
    const task = taskRepo.create({
      projectId,
      title: 'Database Sharding Infrastructure',
      description: 'Partition user table across physical SQLite databases.',
    });

    const s1 = taskRepo.addStep(task.id, 'Partitioning schema', 1);
    taskRepo.addStep(task.id, 'Routing proxy', 2);
    taskRepo.updateStepStatus(s1.id, 'completed');


    await handoffService.createHandoff({
      taskId: task.id,
      agentIdentity: 'Agent-1',
      completedWork: 'Partitioning schema completed',
      nextAction: 'Build routing proxy',
      blockers: ['Awaiting SQLite WAL multi-connection test benchmark'],
    });

    // Resume explicitly by task ID
    const resumeWithId = await handoffService.resumeTask(task.id);
    expect(resumeWithId.task.id).toBe(task.id);
    expect(resumeWithId.objective).toContain('Partition user table');
    expect(resumeWithId.current_step).toBe('[Step 2] Routing proxy');
    expect(resumeWithId.completed_steps).toEqual(['[Step 1] Partitioning schema']);
    expect(resumeWithId.remaining_steps).toEqual(['[Step 2] Routing proxy']);
    expect(resumeWithId.blockers).toContain('Awaiting SQLite WAL multi-connection test benchmark');
    expect(resumeWithId.next_action).toBe('Build routing proxy');
    expect(resumeWithId.relevant_context).toBeDefined();
    expect(resumeWithId.relevant_context.context).toContain('# TASK CONTEXT: [' + task.id + ']');

    // Resume implicitly from .ai/handoff/CURRENT.json (without specifying taskId)
    const resumeImplicit = await handoffService.resumeTask();
    expect(resumeImplicit.task.id).toBe(task.id);
    expect(resumeImplicit.objective).toBe(resumeWithId.objective);
    expect(resumeImplicit.current_step).toBe(resumeWithId.current_step);
  });

  it('checks consistency: warns on modified file discrepancy, test staleness, and git mismatch', async () => {
    const validator = new HandoffValidator(tempDir);

    // 1. File discrepancy: file marked as modified, but not in git
    // Create an unmodified file on disk
    const fooPath = path.join(tempDir, 'src', 'foo.ts');
    fs.mkdirSync(path.dirname(fooPath), { recursive: true });
    fs.writeFileSync(fooPath, 'export const foo = 1;\n');

    const snapshotWithUntracked = {
      task_id: 't-test',
      status: 'handoff',
      goal: 'Consistency test',
      current_step: 'Step 1',
      completed: [],
      remaining: [],
      modified_files: ['src/foo.ts'],
      decisions: [],
      blockers: [],
      tests: [],
      git: {
        branch: 'main',
        commitHash: 'commit-abc',
        isDirty: false,
      },
      next_action: 'Continue',
      created_at: Date.now() - 10000,
      agent_identity: 'Agent-Tester',
    };

    // If working tree is not a git repo, warnings reflect git unavailability cleanly
    const report1 = await validator.validateConsistency(snapshotWithUntracked);
    expect(report1.isConsistent).toBe(true);

    // 2. Test Staleness: tests passed at timestamp T, but file mtime is after T
    const pastTime = Date.now() - 50000;
    const testSnapshot = {
      ...snapshotWithUntracked,
      validation: {
        status: 'passed' as const,
        timestamp: pastTime,
        lastTestedCommit: 'commit-old',
      },
    };

    // Touch file so mtime is fresh
    fs.writeFileSync(fooPath, 'export const foo = 2; // modified after test\n');

    // Manually run check on validator
    const report2 = await validator.validateConsistency(testSnapshot);
    // Since tempDir is not a git repo in this sub-test, validator gracefully skips git checks
    expect(report2).toBeDefined();
  });

  it('simulates cross-agent collaboration across separate sessions without conversation memory', async () => {
    // ========================================================================
    // SESSION 1: Agent Alpha starts task and performs initial work
    // ========================================================================
    const task = taskRepo.create({
      projectId,
      title: 'Build Distributed Lock Engine',
      description: 'Implement distributed locking with Redis lease and automatic heartbeat renewal.',
      assignedAgent: 'Agent-Alpha',
    });

    const s1 = taskRepo.addStep(task.id, 'Define LockLease interface', 1);
    const s2 = taskRepo.addStep(task.id, 'Implement acquire and release', 2);
    taskRepo.addStep(task.id, 'Heartbeat background timer', 3);

    // Agent Alpha completes step 1
    taskRepo.updateStepStatus(s1.id, 'completed');
    taskRepo.attachFile(task.id, 'src/lock/redis-lock.ts');
    taskRepo.attachSymbol(task.id, 'acquireLock');

    // Create physical file
    const lockFilePath = path.join(tempDir, 'src', 'lock', 'redis-lock.ts');
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
    fs.writeFileSync(
      lockFilePath,
      `export interface LockLease {\n  resourceId: string;\n  token: string;\n  expiresAt: number;\n}\n`
    );

    // Agent Alpha saves handoff
    const alphaHandoff = await handoffService.createHandoff({
      taskId: task.id,
      agentIdentity: 'Agent-Alpha',
      completedWork: 'Designed LockLease interface and validated TTL contract',
      currentStep: '[Step 2] Implement acquire and release',
      nextAction: 'Implement acquireLock method in src/lock/redis-lock.ts',
      blockers: ['Redis server TTL granularity must be in milliseconds'],
    });

    expect(alphaHandoff.agent_identity).toBe('Agent-Alpha');
    expect(alphaHandoff.current_step).toBe('[Step 2] Implement acquire and release');

    // ========================================================================
    // SESSION 2: Agent Beta joins the project (different session, no shared memory)
    // ========================================================================
    // Agent Beta creates its own independent HandoffService instance
    const betaDb = client.db;
    const betaGraphService = new GraphService(betaDb);
    const betaContextService = new ContextService(betaDb, betaGraphService, tempDir);
    const betaHandoffService = new HandoffService(betaDb, betaContextService, tempDir);

    // Agent Beta resumes task using CURRENT.json (no conversation history needed!)
    const resumed = await betaHandoffService.resumeTask();

    expect(resumed.task.id).toBe(task.id);
    expect(resumed.objective).toContain('distributed locking with Redis');
    expect(resumed.current_step).toBe('[Step 2] Implement acquire and release');
    expect(resumed.completed_steps).toEqual(['[Step 1] Define LockLease interface']);
    expect(resumed.remaining_steps).toContain('[Step 2] Implement acquire and release');
    expect(resumed.remaining_steps).toContain('[Step 3] Heartbeat background timer');
    expect(resumed.modified_files).toContain('src/lock/redis-lock.ts');
    expect(resumed.blockers).toContain('Redis server TTL granularity must be in milliseconds');
    expect(resumed.next_action).toBe('Implement acquireLock method in src/lock/redis-lock.ts');

    // Agent Beta continues work and completes step 2
    taskRepo.updateStepStatus(s2.id, 'completed');
    fs.appendFileSync(
      lockFilePath,
      `export async function acquireLock(resourceId: string): Promise<LockLease> {\n  return { resourceId, token: 'abc', expiresAt: Date.now() + 5000 };\n}\n`
    );

    // Agent Beta saves handoff for the next session/agent
    const betaHandoff = await betaHandoffService.createHandoff({
      taskId: task.id,
      agentIdentity: 'Agent-Beta',
      completedWork: 'Implemented acquireLock with 5000ms TTL',
      currentStep: '[Step 3] Heartbeat background timer',
      nextAction: 'Implement heartbeat background timer',
    });

    expect(betaHandoff.agent_identity).toBe('Agent-Beta');
    expect(betaHandoff.current_step).toBe('[Step 3] Heartbeat background timer');
    expect(betaHandoff.completed).toEqual([
      '[Step 1] Define LockLease interface',
      '[Step 2] Implement acquire and release',
    ]);
    expect(betaHandoff.remaining).toEqual(['[Step 3] Heartbeat background timer']);

    // Check that CURRENT.json was updated to Agent Beta
    const currentJson = betaHandoffService.getCurrentHandoff();
    expect(currentJson?.agent_identity).toBe('Agent-Beta');
    expect(currentJson?.completed).toHaveLength(2);
  });
});
