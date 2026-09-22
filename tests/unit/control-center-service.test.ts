import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  ExecutionSessionRepository,
  ValidationRepository,
  DecisionRepository,
  ConstraintRepository,
  ProposalRepository,
  GraphRepository,
} from '../../src/database/repositories/index.js';
import { ControlCenterService } from '../../src/ui/control-center-service.js';

describe('Phase 15: ControlCenterService (UI Application Service Layer)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let sessionRepo: ExecutionSessionRepository;
  let validationRepo: ValidationRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let proposalRepo: ProposalRepository;
  let graphRepo: GraphRepository;
  let service: ControlCenterService;
  let projectId: string;
  let taskId: string;

  beforeEach(() => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-control-center-test-')));

    // Initialize genuine git repository in tempDir
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Control Center Test"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "ui@cofaios.local"', { cwd: tempDir, stdio: 'ignore' });

    // Initial files and commit
    const srcDir = path.join(tempDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'app.ts'), 'export const greeting = "hello";\n');
    execSync('git add . && git commit -m "initial commit"', { cwd: tempDir, stdio: 'ignore' });

    // Database & Repositories
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });
    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    sessionRepo = new ExecutionSessionRepository(client.db);
    validationRepo = new ValidationRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    constraintRepo = new ConstraintRepository(client.db);
    proposalRepo = new ProposalRepository(client.db);
    graphRepo = new GraphRepository(client.db);

    const project = projectRepo.create({
      name: 'Desktop Control Center Project',
      rootPath: tempDir,
      description: 'Testing safe UI Application Service',
    });
    projectId = project.id;

    // Seed task with steps
    const task = taskRepo.create({
      projectId,
      title: 'Build Control Center Panels',
      goal: 'Deliver responsive panels for Task, Context, Memory, Graph, Handoff, Validation, Agent',
      priority: 'high',
    });
    taskId = task.id;
    taskRepo.transitionStatus(taskId, 'in_progress');

    taskRepo.addStep(taskId, 'Design DTO contracts', 1);
    taskRepo.addStep(taskId, 'Implement ControlCenterService', 2);
    taskRepo.addStep(taskId, 'Build React UI components', 3);

    // Seed graph
    const fileNode = graphRepo.addNode({
      projectId,
      entityType: 'file',
      label: 'src/app.ts',
      path: 'src/app.ts',
    });
    const symbolNode = graphRepo.addNode({
      projectId,
      entityType: 'symbol',
      label: 'greeting',
      name: 'greeting',
      path: 'src/app.ts',
      metadata: { kind: 'variable' },
    });
    graphRepo.addEdge({
      projectId,
      sourceNodeId: fileNode.id,
      targetNodeId: symbolNode.id,
      relationType: 'exports',
    });

    // Seed session
    sessionRepo.createSession({
      projectId,
      taskId,
      provider: 'antigravity',
      agent: 'AntigravityDev',
      accountLabel: 'pro-tier',
      status: 'active',
    });

    // Seed decision & constraint
    decisionRepo.create({
      projectId,
      taskId,
      title: 'No Direct DB Access From UI',
      context: 'Security and architectural separation',
      decisionRationale: 'UI must only call application services / API',
      status: 'accepted',
    });

    constraintRepo.create({
      projectId,
      category: 'architecture',
      title: 'Local First Architecture',
      ruleContent: 'Data must be stored in local SQLite and canonical markdown',
      enforcementLevel: 'mandatory',
    });

    // Seed proposal
    proposalRepo.create({
      projectId,
      taskId,
      title: 'Tauri Native Bridge Proposal',
      question: 'Should the UI communicate over HTTP or native IPC?',
      status: 'under_review',
    });

    service = new ControlCenterService({
      db: client.db,
      projectRoot: tempDir,
      projectId,
      projectRepo,
      taskRepo,
      handoffRepo,
      sessionRepo,
      validationRepo,
      decisionRepo,
      constraintRepo,
      proposalRepo,
      graphRepo,
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. Header State
  // ---------------------------------------------------------------------------
  it('resolves Header state with project, git status, active task, agent, and session', async () => {
    const header = await service.getHeaderState();

    expect(header.project.name).toBe('Desktop Control Center Project');
    expect(header.project.rootPath).toBe(tempDir);
    expect(header.git.branch).toBeDefined();
    expect(header.git.commitHash).toBeDefined();
    expect(header.git.isDirty).toBe(false);

    expect(header.currentTask).toBeDefined();
    expect(header.currentTask?.id).toBe(taskId);
    expect(header.currentTask?.status).toBe('in_progress');

    expect(header.currentAgent).toBeDefined();
    expect(header.currentAgent?.name).toBe('AntigravityDev');
    expect(header.currentAgent?.provider).toBe('antigravity');

    expect(header.currentSession).toBeDefined();
    expect(header.currentSession?.status).toBe('active');
    expect(header.currentSession?.accountLabel).toBe('pro-tier');
  });

  // ---------------------------------------------------------------------------
  // 2. Task Panel State
  // ---------------------------------------------------------------------------
  it('resolves Task panel with progress, steps checklist, blockers, and next action', async () => {
    // Complete first step
    const steps = taskRepo.listSteps(taskId);
    taskRepo.updateStepStatus(steps[0]!.id, 'completed');

    const taskPanel = await service.getTaskPanelState(taskId);

    expect(taskPanel.task?.id).toBe(taskId);
    expect(taskPanel.task?.title).toBe('Build Control Center Panels');
    expect(taskPanel.steps.length).toBe(3);
    expect(taskPanel.steps[0]?.status).toBe('completed');
    expect(taskPanel.steps[1]?.status).toBe('pending');
    expect(taskPanel.progressPercentage).toBe(33);
    expect(taskPanel.currentStep).toBe('Implement ControlCenterService');
    expect(taskPanel.allTasks.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Context Panel State
  // ---------------------------------------------------------------------------
  it('resolves Context panel with budget utilization, symbols, decisions, and constraints', async () => {
    const contextPanel = await service.getContextPanelState(taskId, 5000);

    expect(contextPanel.contextBudget).toBe(5000);
    expect(contextPanel.tokensUsed).toBeGreaterThan(0);
    expect(contextPanel.utilizationPercentage).toBeGreaterThanOrEqual(0);
    expect(contextPanel.relevantSymbols.length).toBeGreaterThan(0);
    expect(contextPanel.relevantSymbols.some((s) => s.name === 'greeting')).toBe(true);
    expect(contextPanel.relevantDecisions.some((d) => d.title.includes('No Direct DB Access'))).toBe(true);
    expect(contextPanel.relevantConstraints.some((c) => c.title.includes('Local First'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Memory Panel State
  // ---------------------------------------------------------------------------
  it('resolves Memory panel with project knowledge, architecture, decisions, constraints, and research', async () => {
    // Create mock notebook file
    const notebookDir = path.join(tempDir, '.ai', 'notebook');
    fs.mkdirSync(notebookDir, { recursive: true });
    fs.writeFileSync(path.join(notebookDir, 'PROJECT-KNOWLEDGE.md'), '# Canonical Project Knowledge\n');

    const memoryPanel = await service.getMemoryPanelState();

    expect(memoryPanel.projectKnowledge).toContain('Canonical Project Knowledge');
    expect(memoryPanel.decisions.length).toBeGreaterThan(0);
    expect(memoryPanel.constraints.length).toBeGreaterThan(0);
    expect(memoryPanel.research.length).toBeGreaterThan(0);
    expect(memoryPanel.research[0]?.title).toBe('Tauri Native Bridge Proposal');
  });

  // ---------------------------------------------------------------------------
  // 5. Graph Panel State
  // ---------------------------------------------------------------------------
  it('resolves Graph panel with nodes, edges, and statistics', async () => {
    const graphPanel = await service.getGraphPanelState();

    expect(graphPanel.stats.totalNodes).toBe(2);
    expect(graphPanel.stats.totalEdges).toBe(1);
    expect(graphPanel.nodes.some((n) => n.label === 'src/app.ts')).toBe(true);
    expect(graphPanel.nodes.some((n) => n.label === 'greeting')).toBe(true);
    expect(graphPanel.edges[0]?.type).toBe('defines');
  });

  // ---------------------------------------------------------------------------
  // 6. Handoff Panel State
  // ---------------------------------------------------------------------------
  it('resolves Handoff panel with recent handoff and session timeline', async () => {
    handoffRepo.create({
      taskId,
      projectId,
      objective: 'Finish panel contracts',
      completedWork: 'Created ControlCenterService implementation',
      nextAction: 'Build React frontend',
      gitState: { branch: 'main', isDirty: false },
      agentIdentity: 'AntigravityDev',
    });

    const handoffPanel = await service.getHandoffPanelState(taskId);

    expect(handoffPanel.currentHandoff).toBeDefined();
    expect(handoffPanel.currentHandoff?.completedWork).toContain('ControlCenterService');
    expect(handoffPanel.currentHandoff?.nextAction).toBe('Build React frontend');
    expect(handoffPanel.previousSessions.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Validation Panel State
  // ---------------------------------------------------------------------------
  it('resolves Validation panel with gates status and git diff', async () => {
    validationRepo.recordValidationRun({
      projectId,
      taskId,
      validatorType: 'test',
      status: 'passed',
      results: { stdout: 'All 15 tests passed' },
      runBy: 'AntigravityDev',
    });

    // Make an uncommitted file change
    fs.appendFileSync(path.join(tempDir, 'src', 'app.ts'), '\nexport const extra = true;');

    const valPanel = await service.getValidationPanelState(taskId);

    expect(valPanel.tests.status).toBe('passed');
    expect(valPanel.tests.stdout).toContain('All 15 tests passed');
    expect(valPanel.gitDiff.modified).toContain('src/app.ts');
  });

  // ---------------------------------------------------------------------------
  // 8. Agent Panel State
  // ---------------------------------------------------------------------------
  it('resolves Agent panel with current provider, agent, and session list', async () => {
    const agentPanel = await service.getAgentPanelState();

    expect(agentPanel.currentProvider).toBe('antigravity');
    expect(agentPanel.agent).toBe('AntigravityDev');
    expect(agentPanel.accountLabel).toBe('pro-tier');
    expect(agentPanel.sessions.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 9. Full Combined Dashboard State
  // ---------------------------------------------------------------------------
  it('returns comprehensive full dashboard state in a single call', async () => {
    const full = await service.getFullDashboardState(taskId);

    expect(full.header).toBeDefined();
    expect(full.taskPanel).toBeDefined();
    expect(full.contextPanel).toBeDefined();
    expect(full.memoryPanel).toBeDefined();
    expect(full.graphPanel).toBeDefined();
    expect(full.handoffPanel).toBeDefined();
    expect(full.validationPanel).toBeDefined();
    expect(full.agentPanel).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // 10. Mutation Actions
  // ---------------------------------------------------------------------------
  it('records progress and executes handoff via safe application service layer', async () => {
    // 1. Record Progress
    const progressResult = await service.recordProgress({
      taskId,
      addStep: { title: 'Implement Vitest UI tests' },
    });
    expect(progressResult.task.id).toBe(taskId);

    // 2. Save Handoff
    const handoffResult = await service.saveHandoff({
      taskId,
      completedWork: 'Service layer complete and verified with tests',
      nextAction: 'Assemble React UI components',
      decisions: ['Keep service decoupled from HTTP transport'],
    });

    expect(handoffResult.handoff.taskId).toBe(taskId);
    expect(handoffResult.task.status).toBe('handoff');

    // 3. Resume Task
    const resumeResult = await service.resumeTask({
      taskId,
      provider: 'claude',
      agent: 'ClaudeCode',
    });

    expect(resumeResult.task.status).toBe('in_progress');
    expect(resumeResult.session.provider).toBe('claude');
    expect(resumeResult.session.agent).toBe('ClaudeCode');
  });

  // ---------------------------------------------------------------------------
  // 11. Project Management
  // ---------------------------------------------------------------------------
  it('lists projects, adds new project, and switches active project', async () => {
    // 1. List projects
    const initialList = service.listProjects();
    expect(initialList.length).toBe(1);
    expect(initialList[0]!.isActive).toBe(true);
    expect(initialList[0]!.id).toBe(projectId);

    // 2. Add new project
    const secondProjectDir = path.join(tempDir, 'sub-workspace');
    fs.mkdirSync(secondProjectDir, { recursive: true });

    const newProject = service.createOrAddProject({
      name: 'Second Workspace',
      rootPath: secondProjectDir,
      description: 'Secondary project workspace',
    });
    expect(newProject.name).toBe('Second Workspace');
    expect(newProject.rootPath).toBe(secondProjectDir);
    expect(service.getActiveProjectId()).toBe(newProject.id);

    const updatedList = service.listProjects();
    expect(updatedList.length).toBe(2);
    const activeItem = updatedList.find((p) => p.isActive);
    expect(activeItem?.id).toBe(newProject.id);

    // 3. Switch back to initial project
    const switched = service.setActiveProject(projectId);
    expect(switched.id).toBe(projectId);
    expect(service.getActiveProjectId()).toBe(projectId);

    // 4. getFullDashboardState with explicit projectId
    const secondDash = await service.getFullDashboardState(undefined, newProject.id);
    expect(secondDash.header.project.id).toBe(newProject.id);
    expect(secondDash.header.project.name).toBe('Second Workspace');
  });
});

