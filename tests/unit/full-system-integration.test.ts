import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  EventRepository,
  ValidationRepository,
  ExecutionSessionRepository,
  DecisionRepository,
  ConstraintRepository,
  GraphRepository,
} from '../../src/database/repositories/index.js';
import { ProjectOrchestrator } from '../../src/orchestrator/index.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { MemoryEngine } from '../../src/memory/memory-engine.js';
import { CodeIndexer } from '../../src/code-intelligence/code-indexer.js';
import { ContextService } from '../../src/context/context-service.js';
import { AntigravityAdapter, ClaudeAdapter } from '../../src/agents/adapter.js';

describe('Phase 18: Full System Integration Test (End-to-End Real Project Lifecycle)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let eventRepo: EventRepository;
  let validationRepo: ValidationRepository;
  let sessionRepo: ExecutionSessionRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let graphRepo: GraphRepository;
  let graphService: GraphService;
  let contextService: ContextService;
  let memoryEngine: MemoryEngine;
  let codeIndexer: CodeIndexer;
  let orchestrator: ProjectOrchestrator;
  let projectId: string;

  const fixtureSourceDir = path.resolve(process.cwd(), 'tests/fixtures/fullstack-project');

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-full-integration-')));

    // 1. Copy fullstack-project fixture to tempDir
    fs.cpSync(fixtureSourceDir, tempDir, { recursive: true });

    // 2. Initialize genuine git repository in tempDir
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "AI Project OS Integrator"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "integrator@cofaios.local"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git add . && git commit -m "feat: initial commit of fullstack enterprise project"', {
      cwd: tempDir,
      stdio: 'ignore',
    });

    // 3. Setup SQLite Database and Repositories
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });
    const db = client.db;

    projectRepo = new ProjectRepository(db);
    taskRepo = new TaskRepository(db);
    handoffRepo = new HandoffRepository(db);
    eventRepo = new EventRepository(db);
    validationRepo = new ValidationRepository(db);
    sessionRepo = new ExecutionSessionRepository(db);
    decisionRepo = new DecisionRepository(db);
    constraintRepo = new ConstraintRepository(db);
    graphRepo = new GraphRepository(db);

    graphService = new GraphService(db);
    memoryEngine = new MemoryEngine(db);
    codeIndexer = new CodeIndexer(db);

    const project = projectRepo.create({
      name: 'Fullstack Enterprise Platform',
      rootPath: tempDir,
      description: 'End-to-end full system integration test',
    });
    projectId = project.id;

    // 4. Index codebase into graph and sync canonical memory
    await codeIndexer.indexProject(tempDir, projectId);
    await memoryEngine.syncCanonicalDocs(tempDir, projectId);

    // Register decisions & constraints into database
    decisionRepo.create({
      projectId,
      title: 'ADR-001: OAuth 2.0 PKCE Authorization Strategy',
      context: 'Adopt OAuth 2.0 Authorization Code Flow with PKCE for secure authentication.',
      decisionRationale: 'The backend receives code and state at /api/auth/callback, validates state parameter against CSRF, and exchanges code for profile.',
    });

    decisionRepo.create({
      projectId,
      title: 'ADR-002: Repository Pattern for User Entity',
      context: 'Encapsulate user persistence in UserModel rather than raw SQL.',
      decisionRationale: 'Decouples auth routing from database driver details.',
    });

    constraintRepo.create({
      projectId,
      category: 'security',
      title: 'SEC-001: OAuth CSRF Protection',
      ruleContent: 'OAuth callback handlers MUST cryptographically validate the returned state parameter against the session cookie.',
      enforcementLevel: 'mandatory',
    });

    contextService = new ContextService(db, graphService, tempDir);

    orchestrator = new ProjectOrchestrator({
      db,
      projectRoot: tempDir,
      projectId,
      projectRepo,
      taskRepo,
      handoffRepo,
      eventRepo,
      validationRepo,
      sessionRepo,
      decisionRepo,
      contextService,
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes full 15-step scenario: Agent A modifies code -> Handoff -> Agent B resumes on SAME working tree -> completes implementation -> verifies all 7 invariants', async () => {
    const agentA = new AntigravityAdapter({ identity: { accountLabel: 'antigravity-auth-engineer' } });
    const agentB = new ClaudeAdapter({ identity: { accountLabel: 'claude-fullstack-dev' } });

    // =========================================================================
    // STEP 1: Create task
    // =========================================================================
    const execPackageA = await orchestrator.startTask({
      adapter: agentA,
      projectId,
      title: 'Implement OAuth callback handling.',
      goal: 'Validate CSRF state (SEC-001), exchange authorization code (ADR-001), and persist user profile (ADR-002) in oauth-router.ts',
      priority: 'high',
      tokenBudget: 8000,
    });

    const taskId = execPackageA.task.id;
    const sessionAId = execPackageA.session.id;

    expect(execPackageA.task.id).toBeDefined();
    expect(execPackageA.task.status).toBe('in_progress');
    expect(execPackageA.task.assignedAgent).toBe('Antigravity');
    expect(execPackageA.session.status).toBe('active');

    // Link task node to target oauth-router file node in graph
    const taskNode = graphRepo.findNodeByEntity(projectId, 'task', taskId) ?? graphRepo.addNode({
      projectId,
      entityType: 'task',
      entityId: taskId,
      label: 'Task: Implement OAuth callback handling',
      name: taskId,
    });
    const targetFileNodes = graphRepo.findNodesByPath(projectId, 'src/backend/api/oauth-router.ts');
    expect(targetFileNodes.length).toBeGreaterThan(0);

    if (taskNode && targetFileNodes[0]) {
      await graphService.addEdge({
        projectId,
        sourceNodeId: taskNode.id,
        targetNodeId: targetFileNodes[0].id,
        relationType: 'modifies',
      });
    }

    // =========================================================================
    // STEP 2: Context Engine retrieves relevant context
    // =========================================================================
    const contextResultA = await contextService.getContext(taskId, 8000);

    // Verify relevant auth files, OAuth module, user model, test, ADR, constraint
    const includedFiles = contextResultA.pack.relevant_files?.map((f) => f.path) ?? [];
    expect(includedFiles).toContain('src/backend/api/oauth-router.ts');

    const includedDecisions = contextResultA.pack.relevant_decisions?.map((d) => d.title) ?? [];
    expect(includedDecisions.some((d) => d.includes('ADR-001'))).toBe(true);

    const includedConstraints = contextResultA.pack.relevant_constraints?.map((c) => c.title) ?? [];
    expect(includedConstraints.some((c) => c.includes('SEC-001'))).toBe(true);

    // INVARIANT 4 VERIFICATION (Partial): Unrelated modules (billing, notifications) are excluded
    expect(includedFiles).not.toContain('src/backend/billing/invoice-service.ts');
    expect(includedFiles).not.toContain('src/backend/notifications/email-service.ts');

    // Token compression metrics report
    expect(contextResultA.total_project_tokens).toBeGreaterThan(0);
    expect(contextResultA.selected_context_tokens).toBeLessThan(8000);
    expect(contextResultA.compression_ratio).toBeGreaterThanOrEqual(0.5);

    // =========================================================================
    // STEP 3: Agent A modifies code
    // =========================================================================
    // Agent A records step progress
    const step1 = await orchestrator.recordProgress({
      taskId,
      addStep: { title: 'Validate OAuth state parameter against CSRF (SEC-001)' },
      decision: {
        title: 'State parameter comparison',
        rationale: 'Reject requests with 403 Forbidden if state does not match session cookie',
      },
    });

    await orchestrator.recordProgress({
      taskId,
      stepId: step1.addedStepId,
      completeStep: true,
    });

    await orchestrator.recordProgress({
      taskId,
      addStep: { title: 'Exchange code for user profile and issue session token' },
    });

    // Agent A writes partial implementation into src/backend/api/oauth-router.ts
    const oauthRouterPath = path.join(tempDir, 'src/backend/api/oauth-router.ts');
    fs.writeFileSync(
      oauthRouterPath,
      `import { OAuthService } from '../auth/oauth-service.js';
import { TokenManager } from '../auth/token-manager.js';
import { UserModel } from '../models/user.js';

export interface OAuthCallbackRequest {
  provider: string;
  query: {
    code?: string;
    state?: string;
    error?: string;
  };
  sessionState?: string;
}

export interface OAuthCallbackResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: {
    success: boolean;
    token?: string;
    userId?: string;
    error?: string;
  };
}

export class OAuthRouter {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly tokenManager: TokenManager,
    private readonly userModel: UserModel
  ) {}

  public async handleCallback(req: OAuthCallbackRequest): Promise<OAuthCallbackResponse> {
    if (req.query.error) {
      return { statusCode: 400, headers: {}, body: { success: false, error: req.query.error } };
    }

    // Step 1: Validate state parameter against CSRF (SEC-001)
    if (!req.query.state || req.query.state !== req.sessionState) {
      return {
        statusCode: 403,
        headers: {},
        body: { success: false, error: 'Invalid or missing CSRF state parameter' },
      };
    }

    if (!req.query.code) {
      return {
        statusCode: 400,
        headers: {},
        body: { success: false, error: 'Missing authorization code' },
      };
    }

    // Handed off to Agent B: Exchange code and issue token
    return {
      statusCode: 501,
      headers: {},
      body: { success: false, error: 'Token exchange pending completion by Agent B' },
    };
  }
}
`
    );

    // =========================================================================
    // STEP 4: Validation runs
    // =========================================================================
    const valResultA = await orchestrator.validateTask(taskId, {
      skipLint: true,
      skipTypecheck: true,
      skipBuild: true,
      testCommand: 'node -e "process.exit(0)"',
    });
    expect(valResultA.status).toBe('passed');

    // =========================================================================
    // STEP 5: Agent A performs handoff
    // =========================================================================
    const handoffResult = await orchestrator.handoffTask({
      taskId,
      sessionId: sessionAId,
      objective: 'Implement OAuth callback handling.',
      completedWork: 'Implemented CSRF state verification (SEC-001) returning 403 on state mismatch.',
      currentFile: 'src/backend/api/oauth-router.ts',
      modifiedFiles: ['src/backend/api/oauth-router.ts'],
      decisions: ['Validated state against session before code exchange'],
      blockers: 'Ensure OAuthService error handling handles network failure gracefully',
      nextAction: 'Exchange code via OAuthService, persist or update user in UserModel, and return JWT session token',
    });

    expect(handoffResult.task.status).toBe('handoff');
    expect(handoffResult.handoff.agentIdentity).toBe('Antigravity');
    expect(handoffResult.handoff.completedWork).toContain('CSRF state verification');
    expect(handoffResult.handoff.nextAction).toContain('Exchange code via OAuthService');

    // =========================================================================
    // STEP 6: Session A ends
    // =========================================================================
    expect(handoffResult.session.status).toBe('handoff');
    const sessionARecord = sessionRepo.findById(sessionAId);
    expect(sessionARecord?.status).toBe('handoff');

    // Verify on-disk handoff snapshot exists
    const onDiskSnapshotPath = path.join(tempDir, '.ai/handoff/CURRENT.json');
    expect(fs.existsSync(onDiskSnapshotPath)).toBe(true);
    const snapshotJson = JSON.parse(fs.readFileSync(onDiskSnapshotPath, 'utf-8'));
    expect(snapshotJson.task_id).toBe(taskId);
    expect(snapshotJson.agent_identity).toBe('Antigravity');

    // =========================================================================
    // STEP 7: Session B starts on SAME working tree
    // =========================================================================
    const continuationPackage = await orchestrator.resumeTask({
      taskId,
      adapter: agentB,
      tokenBudget: 8000,
    });

    const sessionBId = continuationPackage.session.id;
    expect(sessionBId).not.toBe(sessionAId); // Brand new session for Agent B!
    expect(continuationPackage.session.provider).toBe('claude');
    expect(continuationPackage.session.status).toBe('active');

    // =========================================================================
    // STEP 8: Project OS detects task, git state, handoff, modified files, validation state
    // =========================================================================
    expect(continuationPackage.task.id).toBe(taskId);
    expect(continuationPackage.task.status).toBe('in_progress');
    expect(continuationPackage.task.assignedAgent).toBe('ClaudeCode');
    expect(continuationPackage.continuity.isConsistent).toBe(true);
    expect(continuationPackage.handoff.agentIdentity).toBe('Antigravity');
    expect(continuationPackage.nextAction).toContain('Exchange code via OAuthService');

    // Git state detection
    const gitStatus = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(gitStatus).toContain('src/backend/api/oauth-router.ts');

    // =========================================================================
    // STEP 9: Context Engine generates continuation context
    // =========================================================================
    expect(continuationPackage.context.recentHandoff).toBeDefined();
    expect(continuationPackage.context.recentHandoff?.completedWork).toContain('CSRF state verification');
    expect(continuationPackage.context.current_state?.blockers).toContain(
      'Ensure OAuthService error handling handles network failure gracefully'
    );
    expect(continuationPackage.context.next_action).toContain('Exchange code via OAuthService');

    // =========================================================================
    // STEP 10: Agent B continues from current_step
    // =========================================================================
    const activeSteps = taskRepo.listSteps(taskId);
    const exchangeStep = activeSteps.find((s) => s.title.includes('Exchange code'));
    expect(exchangeStep).toBeDefined();

    if (exchangeStep) {
      await orchestrator.recordProgress({
        taskId,
        stepId: exchangeStep.id,
        completeStep: true,
        decision: {
          title: 'OAuth User Persistence and Token Issuance',
          rationale: 'Find or create user with UserModel, issue token via TokenManager',
        },
      });
    }

    // =========================================================================
    // STEP 11: Agent B completes implementation
    // =========================================================================
    fs.writeFileSync(
      oauthRouterPath,
      `import { OAuthService } from '../auth/oauth-service.js';
import { TokenManager } from '../auth/token-manager.js';
import { UserModel } from '../models/user.js';

export interface OAuthCallbackRequest {
  provider: string;
  query: {
    code?: string;
    state?: string;
    error?: string;
  };
  sessionState?: string;
}

export interface OAuthCallbackResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: {
    success: boolean;
    token?: string;
    userId?: string;
    error?: string;
  };
}

export class OAuthRouter {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly tokenManager: TokenManager,
    private readonly userModel: UserModel
  ) {}

  public async handleCallback(req: OAuthCallbackRequest): Promise<OAuthCallbackResponse> {
    if (req.query.error) {
      return { statusCode: 400, headers: {}, body: { success: false, error: req.query.error } };
    }

    // Step 1: Validate state parameter against CSRF (SEC-001)
    if (!req.query.state || req.query.state !== req.sessionState) {
      return {
        statusCode: 403,
        headers: {},
        body: { success: false, error: 'Invalid or missing CSRF state parameter' },
      };
    }

    if (!req.query.code) {
      return {
        statusCode: 400,
        headers: {},
        body: { success: false, error: 'Missing authorization code' },
      };
    }

    try {
      // Step 2: Exchange code for OAuth profile (ADR-001)
      const profile = await this.oauthService.exchangeCodeForProfile(req.provider, req.query.code);

      // Step 3: Find or create user via UserModel repository (ADR-002)
      let user = await this.userModel.findByProviderId(req.provider, profile.id);
      if (!user) {
        user = await this.userModel.createFromOAuth({
          email: profile.email,
          name: profile.name,
          provider: req.provider,
          providerUserId: profile.id,
        });
      }

      // Step 4: Issue JWT session token via TokenManager
      const token = this.tokenManager.generateSessionToken({
        userId: user.id,
        email: user.email,
        provider: user.provider,
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          success: true,
          token,
          userId: user.id,
        },
      };
    } catch (err) {
      return {
        statusCode: 500,
        headers: {},
        body: {
          success: false,
          error: (err as Error).message || 'Internal OAuth exchange failure',
        },
      };
    }
  }
}
`
    );

    // =========================================================================
    // STEP 12: Validation passes
    // =========================================================================
    const valResultB = await orchestrator.validateTask(taskId, {
      skipLint: true,
      skipTypecheck: true,
      skipBuild: true,
      testCommand: 'node -e "process.exit(0)"',
    });
    expect(valResultB.status).toBe('passed');

    // =========================================================================
    // STEP 13: Memory compiler updates only affected knowledge
    // =========================================================================
    const memoryCompilationResult = await memoryEngine.compiler.compileChanges(
      tempDir,
      projectId
    );
    expect(memoryCompilationResult).toBeDefined();
    expect(memoryCompilationResult.layersUpdated).toBeDefined();
    expect(memoryCompilationResult.changedFiles.modified).toContain('src/backend/api/oauth-router.ts');
    expect(memoryCompilationResult.changedFiles.modified).not.toContain('src/backend/billing/invoice-service.ts');

    // =========================================================================
    // STEP 14: Graph updates
    // =========================================================================
    const reindexResult = await codeIndexer.indexChanged(tempDir, projectId);
    expect(reindexResult.projectId).toBe(projectId);

    // =========================================================================
    // STEP 15: Task becomes DONE
    // =========================================================================
    const completeResult = await orchestrator.completeTask({
      taskId,
      sessionId: sessionBId,
      finalNotes: 'OAuth callback handling fully implemented with CSRF state check, profile exchange, and JWT issuance.',
      skipValidation: true,
    });

    expect(completeResult.task.status).toBe('done');
    expect(completeResult.session.status).toBe('ended');
    expect(completeResult.session.id).toBe(sessionBId);

    // =========================================================================
    // STRICT VERIFICATION OF ALL 7 INVARIANTS
    // =========================================================================

    // INVARIANT 1: no lost state
    const finalTask = taskRepo.findById(taskId);
    expect(finalTask).toBeDefined();
    expect(finalTask?.id).toBe(taskId);
    expect(finalTask?.status).toBe('done');

    const projectEvents = eventRepo.listByProject(projectId);
    const eventTypes = projectEvents.map((e) => e.eventType);
    expect(eventTypes).toContain('SESSION_STARTED');
    expect(eventTypes).toContain('TASK_PROGRESS_RECORDED');
    expect(eventTypes).toContain('AGENT_HANDOFF_COMPLETED');
    expect(eventTypes).toContain('TASK_RESUMED');
    expect(eventTypes).toContain('TASK_COMPLETED');

    // INVARIANT 2: no duplicate memory
    const duplicateMemoryRows = client.db.prepare(`
      SELECT key, COUNT(*) as cnt
      FROM project_memory
      WHERE project_id = ?
      GROUP BY key
      HAVING cnt > 1
    `).all(projectId) as Array<{ key: string; cnt: number }>;
    expect(duplicateMemoryRows.length).toBe(0);

    // INVARIANT 3: no duplicate graph nodes
    const stmtDuplicates = client.db.prepare(`
      SELECT entity_type, entity_id, COUNT(*) as cnt
      FROM graph_nodes
      WHERE project_id = ?
      GROUP BY entity_type, entity_id
      HAVING cnt > 1
    `);
    const duplicateRows = stmtDuplicates.all(projectId) as Array<{ entity_type: string; entity_id: string; cnt: number }>;
    expect(duplicateRows.length).toBe(0);

    const stmtFileDuplicates = client.db.prepare(`
      SELECT path, COUNT(*) as cnt
      FROM graph_nodes
      WHERE project_id = ? AND entity_type = 'file' AND path IS NOT NULL
      GROUP BY path
      HAVING cnt > 1
    `);
    const duplicateFileRows = stmtFileDuplicates.all(projectId) as Array<{ path: string; cnt: number }>;
    expect(duplicateFileRows.length).toBe(0);

    // INVARIANT 4: no unnecessary full-project context
    const finalContext = await contextService.getContext(taskId, 8000);
    const finalIncludedPaths = finalContext.pack.relevant_files?.map((f) => f.path) ?? [];
    expect(finalIncludedPaths).toContain('src/backend/api/oauth-router.ts');
    expect(finalIncludedPaths).not.toContain('src/backend/billing/invoice-service.ts');
    expect(finalIncludedPaths).not.toContain('src/backend/notifications/email-service.ts');
    expect(finalContext.compression_ratio).toBeGreaterThanOrEqual(0.5);

    // INVARIANT 5: no inconsistent handoff
    const latestDbHandoff = handoffRepo.findLatestByTaskId(taskId);
    expect(latestDbHandoff).toBeDefined();
    const diskSnapshot = JSON.parse(fs.readFileSync(onDiskSnapshotPath, 'utf-8'));
    expect(diskSnapshot.task_id).toBe(latestDbHandoff?.taskId);
    expect(diskSnapshot.agent_identity).toBe(latestDbHandoff?.agentIdentity);
    expect(diskSnapshot.next_action).toBe(latestDbHandoff?.nextAction);

    // INVARIANT 6: no stale validation
    const taskValidations = validationRepo.listByTask(taskId);
    expect(taskValidations.length).toBeGreaterThan(0);
    const latestValidation = taskValidations[0];
    expect(latestValidation).toBeDefined();
    expect(latestValidation?.status).toBe('passed');
    expect(latestValidation?.taskId).toBe(taskId);

    // INVARIANT 7: no unrelated file modifications
    const finalGitDiff = execSync('git diff --name-only', { cwd: tempDir, encoding: 'utf-8' }).trim();
    const modifiedFilesList = finalGitDiff.split('\n').filter(Boolean);
    const modifiedSourceFiles = modifiedFilesList.filter((f) => !f.startsWith('.ai/'));
    expect(modifiedSourceFiles).toEqual(['src/backend/api/oauth-router.ts']);
    expect(modifiedFilesList).not.toContain('src/backend/billing/invoice-service.ts');
    expect(modifiedFilesList).not.toContain('src/backend/notifications/email-service.ts');
    expect(modifiedFilesList).not.toContain('src/frontend/components/LoginButton.tsx');
    expect(modifiedFilesList).not.toContain('src/frontend/views/AuthCallbackView.tsx');
    expect(modifiedFilesList).not.toContain('src/backend/database/db-client.ts');
  }, 30000);
});
