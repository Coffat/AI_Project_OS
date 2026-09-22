import type { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  UIHeaderState,
  UITaskPanelState,
  UIContextPanelState,
  UIMemoryPanelState,
  UIGraphPanelState,
  UIHandoffPanelState,
  UIValidationPanelState,
  UIAgentPanelState,
  FullDashboardState,
  SaveHandoffInput,
  ResumeTaskInput,
  ValidateTaskInput,
  RecordProgressInput,
  UITaskStepItem,
  UIRelevantFileItem,
  UIRelevantSymbolItem,
  UIGraphNode,
  UIGraphEdge,
  UIValidationGateState,
  UIProjectItem,
  CreateProjectInput,
} from './types.js';
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
} from '../database/repositories/index.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { ContextService } from '../context/context-service.js';
import { GraphService } from '../graph/graph-service.js';
import { ProjectOrchestrator } from '../orchestrator/project-orchestrator.js';
import { Task, ValidationRunRecord, ProjectInfo } from '../core/types.js';
import { ValidationError } from '../core/errors.js';

import {
  ProviderAccountManager,
  ProviderType,
  CreateAccountInput,
  StartOAuthInput,
  OAuthSession,
} from '../providers/provider-account-manager.js';

export interface ControlCenterServiceDependencies {
  db: DatabaseSync;
  projectRoot?: string;
  projectId?: string;
  projectRepo?: ProjectRepository;
  taskRepo?: TaskRepository;
  handoffRepo?: HandoffRepository;
  sessionRepo?: ExecutionSessionRepository;
  validationRepo?: ValidationRepository;
  decisionRepo?: DecisionRepository;
  constraintRepo?: ConstraintRepository;
  proposalRepo?: ProposalRepository;
  graphRepo?: GraphRepository;
  gitAnalyzer?: GitAnalyzer;
  contextService?: ContextService;
  orchestrator?: ProjectOrchestrator;
  providerAccountManager?: ProviderAccountManager;
}

export class ControlCenterService {
  private readonly db: DatabaseSync;
  private projectRoot: string;
  private readonly defaultProjectId: string;
  private activeProjectId?: string;

  private readonly projectRepo: ProjectRepository;
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly sessionRepo: ExecutionSessionRepository;
  private readonly validationRepo: ValidationRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly proposalRepo: ProposalRepository;
  private readonly graphRepo: GraphRepository;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly contextService: ContextService;
  private readonly orchestrator: ProjectOrchestrator;
  private readonly providerAccountManager: ProviderAccountManager;

  constructor(deps: ControlCenterServiceDependencies) {
    this.db = deps.db;
    this.projectRoot = deps.projectRoot ?? process.cwd();
    this.defaultProjectId = deps.projectId ?? 'default-project';
    if (deps.projectId) {
      this.activeProjectId = deps.projectId;
    }

    this.projectRepo = deps.projectRepo ?? new ProjectRepository(this.db);
    this.taskRepo = deps.taskRepo ?? new TaskRepository(this.db);
    this.handoffRepo = deps.handoffRepo ?? new HandoffRepository(this.db);
    this.sessionRepo = deps.sessionRepo ?? new ExecutionSessionRepository(this.db);
    this.validationRepo = deps.validationRepo ?? new ValidationRepository(this.db);
    this.decisionRepo = deps.decisionRepo ?? new DecisionRepository(this.db);
    this.constraintRepo = deps.constraintRepo ?? new ConstraintRepository(this.db);
    this.proposalRepo = deps.proposalRepo ?? new ProposalRepository(this.db);
    this.graphRepo = deps.graphRepo ?? new GraphRepository(this.db);
    this.gitAnalyzer = deps.gitAnalyzer ?? new GitAnalyzer();
    this.providerAccountManager =
      deps.providerAccountManager ??
      new ProviderAccountManager({ baseDir: this.projectRoot });

    if (deps.contextService) {
      this.contextService = deps.contextService;
    } else {
      const graphService = new GraphService(this.db);
      this.contextService = new ContextService(this.db, graphService, this.projectRoot);
    }

    if (deps.orchestrator) {
      this.orchestrator = deps.orchestrator;
    } else {
      this.orchestrator = new ProjectOrchestrator({
        db: this.db,
        projectRoot: this.projectRoot,
        projectId: this.defaultProjectId,
        projectRepo: this.projectRepo,
        taskRepo: this.taskRepo,
        handoffRepo: this.handoffRepo,
        sessionRepo: this.sessionRepo,
        validationRepo: this.validationRepo,
        decisionRepo: this.decisionRepo,
        gitAnalyzer: this.gitAnalyzer,
        contextService: this.contextService,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 0. Project Management
  // ---------------------------------------------------------------------------
  public getActiveProjectId(): string {
    return this.resolveProjectId();
  }

  public listProjects(): UIProjectItem[] {
    const activeId = this.getActiveProjectId();
    const projects = this.projectRepo.list();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      rootPath: p.rootPath,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      isActive: p.id === activeId,
    }));
  }

  public setActiveProject(projectId: string): ProjectInfo {
    const project = this.projectRepo.findById(projectId);
    if (!project) {
      throw new ValidationError(`Project with ID "${projectId}" not found`);
    }
    this.activeProjectId = project.id;
    this.projectRoot = project.rootPath;
    return project;
  }

  public createOrAddProject(input: CreateProjectInput): ProjectInfo {
    if (!input.rootPath || !input.rootPath.trim()) {
      throw new ValidationError('Project rootPath cannot be empty');
    }
    const resolvedPath = path.resolve(input.rootPath.trim());
    if (!fs.existsSync(resolvedPath)) {
      throw new ValidationError(`Directory does not exist: ${resolvedPath}`);
    }

    const existing = this.projectRepo.findByRootPath(resolvedPath);
    if (existing) {
      this.activeProjectId = existing.id;
      this.projectRoot = existing.rootPath;
      return existing;
    }

    const name = input.name && input.name.trim() ? input.name.trim() : (path.basename(resolvedPath) || 'New Project');
    const created = this.projectRepo.create({
      name,
      rootPath: resolvedPath,
      description: input.description?.trim(),
    });
    this.activeProjectId = created.id;
    this.projectRoot = created.rootPath;
    return created;
  }

  // ---------------------------------------------------------------------------
  // 1. Header State
  // ---------------------------------------------------------------------------
  public async getHeaderState(projectId?: string): Promise<UIHeaderState> {
    const projId = this.resolveProjectId(projectId);
    const project = this.projectRepo.findById(projId) ?? {
      id: projId,
      name: path.basename(this.projectRoot) || 'AI Project OS',
      rootPath: this.projectRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const currentRoot = project.rootPath;

    // Git Status
    let branch = 'unknown';
    let commitHash = 'unknown';
    let isDirty = false;
    let modifiedCount = 0;
    let untrackedCount = 0;

    const isGit = await this.gitAnalyzer.isGitRepository(currentRoot);
    if (isGit) {
      branch = (await this.gitAnalyzer.getCurrentBranch(currentRoot)) ?? 'detached';
      commitHash = (await this.gitAnalyzer.getCurrentCommit(currentRoot)) ?? 'unknown';
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(currentRoot);
      modifiedCount = changes.modified.length;
      untrackedCount = changes.added.length;
      isDirty = modifiedCount > 0 || untrackedCount > 0 || changes.deleted.length > 0;
    }


    // Current Task & Agent & Session
    const activeTask = this.resolveActiveTask(projId);
    let currentAgent: { name: string; provider: string } | undefined;
    let currentSession: { id: string; status: string; startedAt: number; accountLabel?: string } | undefined;

    if (activeTask) {
      const session = this.sessionRepo.findActiveByTask(activeTask.id) ?? this.sessionRepo.listByTask(activeTask.id)[0];
      if (session) {
        currentAgent = {
          name: session.agent,
          provider: session.provider,
        };
        currentSession = {
          id: session.id,
          status: session.status,
          startedAt: session.startedAt,
          accountLabel: session.accountLabel,
        };
      } else if (activeTask.assignedAgent) {
        currentAgent = {
          name: activeTask.assignedAgent,
          provider: 'local',
        };
      }
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        rootPath: project.rootPath,
        description: project.description,
      },
      git: {
        branch,
        commitHash,
        isDirty,
        modifiedCount,
        untrackedCount,
      },
      currentTask: activeTask
        ? {
            id: activeTask.id,
            title: activeTask.title,
            status: activeTask.status,
            priority: activeTask.priority,
          }
        : undefined,
      currentAgent,
      currentSession,
    };
  }

  // ---------------------------------------------------------------------------
  // 2. Task Panel State
  // ---------------------------------------------------------------------------
  public async getTaskPanelState(taskId?: string, projectId?: string): Promise<UITaskPanelState> {
    const projId = this.resolveProjectId(projectId);
    const allTasks = this.taskRepo.listByProject(projId).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
    }));

    const task = taskId
      ? this.taskRepo.findById(taskId)
      : this.resolveActiveTask(projId);

    if (!task) {
      return {
        progressPercentage: 0,
        steps: [],
        blockers: [],
        nextAction: 'Create or select a task to begin execution',
        allTasks,
      };
    }

    const stepsRaw = this.taskRepo.listSteps(task.id);
    const steps: UITaskStepItem[] = stepsRaw.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      stepOrder: s.stepOrder,
    }));

    const completedCount = steps.filter((s) => s.status === 'completed').length;
    const progressPercentage = steps.length > 0
      ? Math.round((completedCount / steps.length) * 100)
      : task.status === 'done'
      ? 100
      : task.status === 'in_progress'
      ? 25
      : 0;

    const currentStepItem = steps.find((s) => s.status === 'in_progress' || s.status === 'pending');
    const currentStep = currentStepItem?.title ?? task.currentStep ?? (steps.length > 0 ? steps[0]?.title : undefined);

    // Extract blockers
    const blockers: string[] = [];
    if (task.description && task.description.includes('[BLOCKER]:')) {
      const matches = task.description.matchAll(/\[BLOCKER\]:\s*([^\n]+)/g);
      for (const m of matches) {
        if (m[1]) blockers.push(m[1].trim());
      }
    }

    const latestHandoff = this.handoffRepo.findLatestByTaskId(task.id);
    if (latestHandoff?.blockers && !blockers.includes(latestHandoff.blockers)) {
      blockers.push(latestHandoff.blockers);
    }

    const nextAction = latestHandoff?.nextAction
      ?? currentStep
      ?? task.goal
      ?? 'Continue implementation';

    return {
      task: {
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        goal: task.goal,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assignedAgent: task.assignedAgent,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
      currentStep,
      progressPercentage,
      steps,
      blockers,
      nextAction,
      allTasks,
    };
  }

  // ---------------------------------------------------------------------------
  // 3. Context Panel State
  // ---------------------------------------------------------------------------
  public async getContextPanelState(taskId?: string, tokenBudget = 8000, projectId?: string): Promise<UIContextPanelState> {
    const projId = this.resolveProjectId(projectId);
    const task = taskId ? this.taskRepo.findById(taskId) : this.resolveActiveTask(projId);

    if (!task) {
      return {
        contextBudget: tokenBudget,
        tokensUsed: 0,
        utilizationPercentage: 0,
        relevantFiles: [],
        relevantSymbols: [],
        relevantDecisions: [],
        relevantConstraints: [],
      };
    }

    let tokensUsed = 0;
    const relevantFiles: UIRelevantFileItem[] = [];
    const relevantSymbols: UIRelevantSymbolItem[] = [];

    try {
      const result = await this.contextService.getContext(task.id, tokenBudget);
      const contextPack = result.pack;
      tokensUsed = contextPack.tokenBudget ?? Math.min(tokenBudget, 1200);

      if (contextPack.relevant_files) {
        for (const file of contextPack.relevant_files) {
          relevantFiles.push({
            path: file.path,
            relevance: file.relevanceScore ?? 0.8,
            reason: file.reason ?? 'Direct task dependency',
            tokenCount: 150,
          });
        }
      }
    } catch {
      // Graceful fallback if context pack build fails
      tokensUsed = 250;
    }

    // Fetch relevant symbols from graph
    const symbolNodes = this.graphRepo.getAllNodes(projId).filter((n) => n.entityType === 'symbol').slice(0, 10);
    for (const s of symbolNodes) {
      let meta: Record<string, unknown> = {};
      try {
        meta = s.metadataJson ? JSON.parse(s.metadataJson) as Record<string, unknown> : {};
      } catch {
        // ignore parse error
      }
      relevantSymbols.push({
        name: s.name ?? s.label,
        kind: String(meta['kind'] ?? 'symbol'),
        filePath: s.path ?? 'unknown',
        line: s.lineStart ?? 1,
        signature: meta['signature'] ? String(meta['signature']) : undefined,
      });
    }

    // Decisions & Constraints
    const decisions = this.decisionRepo.listByProject(projId).slice(0, 5).map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      rationale: d.decisionRationale,
    }));

    const constraints = this.constraintRepo.listByProject(projId).slice(0, 5).map((c) => ({
      id: c.id,
      title: c.title,
      type: c.category,
      severity: c.enforcementLevel,
      description: c.ruleContent,
    }));

    const utilizationPercentage = Math.min(100, Math.round((tokensUsed / tokenBudget) * 100));

    return {
      contextBudget: tokenBudget,
      tokensUsed,
      utilizationPercentage,
      relevantFiles,
      relevantSymbols,
      relevantDecisions: decisions,
      relevantConstraints: constraints,
    };
  }

  // ---------------------------------------------------------------------------
  // 4. Memory Panel State
  // ---------------------------------------------------------------------------
  public async getMemoryPanelState(projectId?: string): Promise<UIMemoryPanelState> {
    const projId = this.resolveProjectId(projectId);

    // Read canonical files or defaults
    const projectKnowledgePath = path.join(this.projectRoot, '.ai', 'notebook', 'PROJECT-KNOWLEDGE.md');
    const fallbackKnowledgePath = path.join(this.projectRoot, 'PROJECT.md');
    let projectKnowledge = 'Project overview not yet compiled.';
    if (fs.existsSync(projectKnowledgePath)) {
      projectKnowledge = fs.readFileSync(projectKnowledgePath, 'utf-8');
    } else if (fs.existsSync(fallbackKnowledgePath)) {
      projectKnowledge = fs.readFileSync(fallbackKnowledgePath, 'utf-8');
    }

    const archPath = path.join(this.projectRoot, '.ai', 'notebook', 'ARCHITECTURE.md');
    const fallbackArchPath = path.join(this.projectRoot, 'ARCHITECTURE.md');
    let architecture = 'Architecture specification not yet compiled.';
    if (fs.existsSync(archPath)) {
      architecture = fs.readFileSync(archPath, 'utf-8');
    } else if (fs.existsSync(fallbackArchPath)) {
      architecture = fs.readFileSync(fallbackArchPath, 'utf-8');
    }

    const decisions = this.decisionRepo.listByProject(projId);
    const constraints = this.constraintRepo.listByProject(projId);
    const proposals = this.proposalRepo.listByProject(projId).map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      question: p.question,
      createdAt: p.createdAt,
    }));

    return {
      projectKnowledge,
      architecture,
      decisions,
      constraints,
      research: proposals,
    };
  }

  // ---------------------------------------------------------------------------
  // 5. Graph Panel State
  // ---------------------------------------------------------------------------
  public async getGraphPanelState(projectId?: string): Promise<UIGraphPanelState> {
    const projId = this.resolveProjectId(projectId);
    const rawNodes = this.graphRepo.getAllNodes(projId);
    const rawEdges = this.graphRepo.getAllEdges(projId);

    const byType: Record<string, number> = {};
    const nodes: UIGraphNode[] = rawNodes.map((n) => {
      let type: 'file' | 'symbol' | 'task' | 'decision' | 'constraint' = 'file';
      if (n.entityType === 'symbol') type = 'symbol';
      else if (n.entityType === 'task') type = 'task';
      else if (n.entityType === 'decision') type = 'decision';
      else if (n.entityType === 'constraint') type = 'constraint';

      byType[type] = (byType[type] ?? 0) + 1;

      let meta: Record<string, unknown> = {};
      try {
        meta = n.metadataJson ? JSON.parse(n.metadataJson) as Record<string, unknown> : {};
      } catch {
        // ignore parse error
      }

      return {
        id: n.id,
        label: n.label,
        type,
        metadata: {
          path: n.path,
          name: n.name,
          lineStart: n.lineStart,
          lineEnd: n.lineEnd,
          ...meta,
        },
      };
    });

    const edges: UIGraphEdge[] = rawEdges.map((e) => {
      let type: 'imports' | 'calls' | 'implements' | 'depends_on' | 'defines' = 'depends_on';
      if (e.relationType === 'imports') type = 'imports';
      else if (e.relationType === 'calls') type = 'calls';
      else if (e.relationType === 'implements') type = 'implements';
      else if (e.relationType === 'exports' || e.relationType === 'contains') type = 'defines';

      return {
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        type,
        weight: e.weight,
      };
    });

    return {
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        byType,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // 6. Handoff Panel State
  // ---------------------------------------------------------------------------
  public async getHandoffPanelState(taskId?: string, projectId?: string): Promise<UIHandoffPanelState> {
    const projId = this.resolveProjectId(projectId);
    const task = taskId ? this.taskRepo.findById(taskId) : this.resolveActiveTask(projId);

    if (!task) {
      return {
        previousSessions: [],
      };
    }

    const handoff = this.handoffRepo.findLatestByTaskId(task.id);
    const sessions = this.sessionRepo.listByTask(task.id);
    const lastSession = sessions.length > 0 ? sessions[0] : undefined;

    return {
      currentHandoff: handoff
        ? {
            id: handoff.id,
            taskId: handoff.taskId,
            objective: handoff.objective,
            completedWork: handoff.completedWork,
            nextAction: handoff.nextAction,
            blockers: handoff.blockers,
            agentIdentity: handoff.agentIdentity,
            createdAt: handoff.createdAt,
            gitState: handoff.gitState
              ? {
                  branch: handoff.gitState.branch,
                  commitHash: handoff.gitState.commitHash,
                  isDirty: handoff.gitState.isDirty,
                }
              : undefined,
          }
        : undefined,
      lastSession,
      previousSessions: sessions,
    };
  }

  // ---------------------------------------------------------------------------
  // 7. Validation Panel State
  // ---------------------------------------------------------------------------
  public async getValidationPanelState(taskId?: string, projectId?: string): Promise<UIValidationPanelState> {
    const projId = this.resolveProjectId(projectId);
    const task = taskId ? this.taskRepo.findById(taskId) : this.resolveActiveTask(projId);

    const runs: ValidationRunRecord[] = task
      ? this.validationRepo.listByTask(task.id)
      : this.validationRepo.listByProject(projId);

    const mapGate = (type: string): UIValidationGateState => {
      const match = runs.find((r) => r.validatorType === type || r.validatorType.includes(type));
      if (!match) {
        return { status: 'none' };
      }
      let results: Record<string, unknown> = {};
      try {
        results = match.resultsJson ? JSON.parse(match.resultsJson) as Record<string, unknown> : {};
      } catch {
        // ignore parse error
      }
      return {
        status: match.status === 'passed' ? 'passed' : match.status === 'failed' ? 'failed' : 'pending',
        durationMs: match.finishedAt && match.startedAt ? match.finishedAt - match.startedAt : undefined,
        stdout: results['stdout'] ? String(results['stdout']) : undefined,
        stderr: results['stderr'] ? String(results['stderr']) : undefined,
        exitCode: match.exitCode,
        lastRunAt: match.finishedAt ?? match.startedAt,
      };
    };

    const tests = mapGate('test');
    const lint = mapGate('lint');
    const typecheck = mapGate('typecheck');
    const build = mapGate('build');

    // Git Diff summary
    let modified: string[] = [];
    let added: string[] = [];
    let deleted: string[] = [];
    let summary = 'Clean working tree';

    const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
    if (isGit) {
      const changes = await this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot);
      modified = changes.modified;
      added = changes.added;
      deleted = changes.deleted;
      summary = await this.gitAnalyzer.getDiffSummary(this.projectRoot);
    }

    const anyFailed = [tests, lint, typecheck, build].some((g) => g.status === 'failed');
    const anyPassed = [tests, lint, typecheck, build].some((g) => g.status === 'passed');
    const overallStatus = anyFailed ? 'failed' : anyPassed ? 'passed' : 'none';

    return {
      tests,
      lint,
      typecheck,
      build,
      gitDiff: {
        modified,
        added,
        deleted,
        summary,
      },
      overallStatus,
    };
  }

  // ---------------------------------------------------------------------------
  // 8. Agent Panel State
  // ---------------------------------------------------------------------------
  public async getAgentPanelState(projectId?: string): Promise<UIAgentPanelState> {
    const projId = this.resolveProjectId(projectId);
    const sessions = this.sessionRepo.listByProject(projId);
    const activeSession = sessions.find((s) => s.status === 'active') ?? (sessions.length > 0 ? sessions[0] : undefined);

    return {
      currentProvider: activeSession?.provider ?? 'antigravity',
      agent: activeSession?.agent ?? 'AntigravityCoder',
      session: activeSession?.id,
      accountLabel: activeSession?.accountLabel ?? 'dev-tier',
      sessions: sessions.map((s) => ({
        id: s.id,
        provider: s.provider,
        agent: s.agent,
        accountLabel: s.accountLabel,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // 9. Combined Full Dashboard State
  // ---------------------------------------------------------------------------
  public async getFullDashboardState(taskId?: string, projectId?: string): Promise<FullDashboardState> {
    const projId = this.resolveProjectId(projectId);
    const [
      header,
      taskPanel,
      contextPanel,
      memoryPanel,
      graphPanel,
      handoffPanel,
      validationPanel,
      agentPanel,
    ] = await Promise.all([
      this.getHeaderState(projId),
      this.getTaskPanelState(taskId, projId),
      this.getContextPanelState(taskId, 8000, projId),
      this.getMemoryPanelState(projId),
      this.getGraphPanelState(projId),
      this.getHandoffPanelState(taskId, projId),
      this.getValidationPanelState(taskId, projId),
      this.getAgentPanelState(projId),
    ]);

    return {
      header,
      taskPanel,
      contextPanel,
      memoryPanel,
      graphPanel,
      handoffPanel,
      validationPanel,
      agentPanel,
    };
  }

  // ---------------------------------------------------------------------------
  // 10. Mutation Actions
  // ---------------------------------------------------------------------------
  public async resumeTask(input: ResumeTaskInput) {
    return this.orchestrator.resumeTask({
      taskId: input.taskId,
      provider: input.provider,
      agent: input.agent,
      accountLabel: input.accountLabel,
    });
  }

  public async saveHandoff(input: SaveHandoffInput) {
    return this.orchestrator.handoffTask({
      taskId: input.taskId,
      completedWork: input.completedWork,
      nextAction: input.nextAction,
      blockers: input.blockers,
      currentFile: input.currentFile,
      decisions: input.decisions,
    });
  }

  public async runValidation(input: ValidateTaskInput) {
    return this.orchestrator.validateTask(input.taskId, {
      testCommand: input.testCommand,
      lintCommand: input.lintCommand,
      typecheckCommand: input.typecheckCommand,
      autoCompleteOnPass: false,
    });
  }

  public async recordProgress(input: RecordProgressInput) {
    return this.orchestrator.recordProgress({
      taskId: input.taskId,
      stepId: input.stepId,
      addStep: input.addStep,
      completeStep: input.completeStep,
      blocker: input.blocker,
    });
  }

  // ---------------------------------------------------------------------------
  // 11. Provider & Account Cockpit
  // ---------------------------------------------------------------------------
  public getProviderCockpitState() {
    const allAccounts = this.providerAccountManager.listAccounts();
    const providersList: Array<{
      id: ProviderType;
      name: string;
      description: string;
      isInstalled: boolean;
      totalAccounts: number;
      activeAccount?: (typeof allAccounts)[0];
    }> = [
      {
        id: 'antigravity',
        name: 'Google Antigravity',
        description: 'Next-gen Agentic AI IDE for full-stack software development',
        isInstalled: Boolean(this.providerAccountManager.getIdeDataPath('antigravity')),
        totalAccounts: allAccounts.filter((a) => a.provider === 'antigravity').length,
        activeAccount: this.providerAccountManager.getActiveAccount('antigravity'),
      },
      {
        id: 'cursor',
        name: 'Cursor IDE',
        description: 'AI-first code editor built on VS Code with deep composer support',
        isInstalled: Boolean(this.providerAccountManager.getIdeDataPath('cursor')),
        totalAccounts: allAccounts.filter((a) => a.provider === 'cursor').length,
        activeAccount: this.providerAccountManager.getActiveAccount('cursor'),
      },
      {
        id: 'windsurf',
        name: 'Windsurf',
        description: 'Agentic IDE by Codeium with Flows and Cascade intelligence',
        isInstalled: Boolean(this.providerAccountManager.getIdeDataPath('windsurf')),
        totalAccounts: allAccounts.filter((a) => a.provider === 'windsurf').length,
        activeAccount: this.providerAccountManager.getActiveAccount('windsurf'),
      },
      {
        id: 'copilot',
        name: 'GitHub Copilot / VS Code',
        description: 'Standard Visual Studio Code with GitHub Copilot Chat & Completion',
        isInstalled: Boolean(this.providerAccountManager.getIdeDataPath('copilot')),
        totalAccounts: allAccounts.filter((a) => a.provider === 'copilot').length,
        activeAccount: this.providerAccountManager.getActiveAccount('copilot'),
      },
      {
        id: 'claude',
        name: 'Claude Code',
        description: 'Anthropic Claude CLI for autonomous agentic reasoning and refactoring',
        isInstalled: true,
        totalAccounts: allAccounts.filter((a) => a.provider === 'claude').length,
        activeAccount: this.providerAccountManager.getActiveAccount('claude'),
      },
      {
        id: 'openai',
        name: 'OpenAI / Codex',
        description: 'OpenAI models and Codex CLI runner integration',
        isInstalled: true,
        totalAccounts: allAccounts.filter((a) => a.provider === 'openai').length,
        activeAccount: this.providerAccountManager.getActiveAccount('openai'),
      },
    ];

    const activeAccountsByProvider: Record<string, (typeof allAccounts)[0] | undefined> = {};
    for (const p of providersList) {
      activeAccountsByProvider[p.id] = p.activeAccount;
    }

    return {
      accounts: allAccounts,
      activeAccountsByProvider,
      providers: providersList,
    };
  }

  public listProviderAccounts(provider?: ProviderType) {
    return this.providerAccountManager.listAccounts(provider);
  }

  public captureProviderAccount(input: CreateAccountInput) {
    return this.providerAccountManager.captureCurrentAccount(input);
  }

  public addProviderAccountManual(input: CreateAccountInput) {
    return this.providerAccountManager.addAccountManual(input);
  }

  public switchProviderAccount(accountId: string, forceClose?: boolean) {
    const result = this.providerAccountManager.switchAccount(accountId, forceClose);
    if (result.success) {
      const targetAcc = this.providerAccountManager.getAccount(accountId);
      if (targetAcc) {
        const projId = this.resolveProjectId();
        const activeTask = this.resolveActiveTask(projId);
        try {
          this.sessionRepo.createSession({
            projectId: projId,
            taskId: activeTask?.id,
            provider: targetAcc.provider,
            agent: targetAcc.name,
            accountLabel: targetAcc.accountLabel,
            status: 'active',
          });
        } catch {
          // Ignore
        }
      }
    }
    return result;
  }

  public refreshProviderQuota(accountId: string) {
    return this.providerAccountManager.refreshQuota(accountId);
  }

  public deleteProviderAccount(accountId: string) {
    return this.providerAccountManager.deleteAccount(accountId);
  }

  public launchProviderInstance(provider: ProviderType) {
    return this.providerAccountManager.launchInstance(provider);
  }

  public startOAuthLogin(input: StartOAuthInput): OAuthSession {
    return this.providerAccountManager.startOAuthLogin(input);
  }

  public getOAuthSession(state: string): OAuthSession | undefined {
    return this.providerAccountManager.getOAuthSession(state);
  }

  public async completeOAuthCallback(state: string, code?: string, email?: string) {
    return await this.providerAccountManager.completeOAuthCallback(state, code, email);
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------
  private resolveProjectId(projectId?: string): string {
    if (projectId) {
      this.activeProjectId = projectId;
      return projectId;
    }
    if (this.activeProjectId) return this.activeProjectId;
    const all = this.projectRepo.list();
    const first = all[0];
    if (first) {
      this.activeProjectId = first.id;
      return first.id;
    }
    try {
      const created = this.projectRepo.create({
        name: path.basename(this.projectRoot) || 'AI Project OS',
        rootPath: this.projectRoot,
        description: 'AI Project OS Workspace',
      });
      this.activeProjectId = created.id;
      return created.id;
    } catch {
      return this.defaultProjectId;
    }
  }

  private resolveActiveTask(projectId: string): Task | null {
    const tasks = this.taskRepo.listByProject(projectId);
    if (tasks.length === 0) return null;

    // Prefer in_progress, testing, handoff, resumed in order
    const priorityStatuses = ['in_progress', 'testing', 'handoff', 'resumed'];
    for (const status of priorityStatuses) {
      const match = tasks.find((t) => t.status === status);
      if (match) return match;
    }

    return tasks[0] ?? null;
  }
}
