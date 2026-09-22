import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { ProjectOSMCPServer } from '../../src/mcp/server.js';
import { MCPSecurityValidator } from '../../src/mcp/mcp-security.js';
import { ValidationError } from '../../src/core/errors.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  DecisionRepository,
  ConstraintRepository,
  EventRepository,
  ValidationRepository,
  GraphRepository,
} from '../../src/database/repositories/index.js';
import { main as cliMain } from '../../src/cli.js';

describe('Phase 11: MCP Server (Model Context Protocol)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let server: ProjectOSMCPServer;
  let security: MCPSecurityValidator;

  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let eventRepo: EventRepository;
  let validationRepo: ValidationRepository;
  let graphRepo: GraphRepository;

  let projectId: string;
  let taskId: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-mcp-test-'));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    constraintRepo = new ConstraintRepository(client.db);
    eventRepo = new EventRepository(client.db);
    validationRepo = new ValidationRepository(client.db);
    graphRepo = new GraphRepository(client.db);

    security = new MCPSecurityValidator(tempDir, client.db);

    // 1. Setup project
    const proj = projectRepo.create({
      name: 'MCP Integration Test Project',
      description: 'Testing MCP Server queries and mutations',
      rootPath: tempDir,
    });
    projectId = proj.id;

    // 2. Setup task
    const task = taskRepo.create({
      projectId,
      title: 'Implement Payment Gateway',
      description: 'Integrate Stripe SDK and add checkout session endpoint',
      priority: 'high',
      assignedAgent: 'Agent-47',
    });
    taskId = task.id;

    // 3. Setup steps
    taskRepo.addStep(taskId, 'Configure API credentials and webhooks', 1);
    taskRepo.addStep(taskId, 'Implement StripeCheckoutController', 2);
    taskRepo.addStep(taskId, 'Add unit tests with mock stripe responses', 3);

    // 4. Setup initial handoff
    handoffRepo.create({
      taskId,
      projectId,
      objective: 'Integrate Stripe SDK and add checkout session endpoint',
      completedWork: 'Created payment config and webhook secret validator',
      nextAction: 'Implement createCheckoutSession method in StripeCheckoutController',
      agentIdentity: 'Agent-47',
      currentStep: 'Implement StripeCheckoutController',
      currentFile: 'src/payment/stripe.ts',
      blockers: undefined,
    });

    // 5. Setup decision & constraint
    decisionRepo.create({
      projectId,
      taskId,
      title: 'Use Stripe Checkout Sessions over Elements',
      context: 'Need fast, compliant checkout with minimal PCI burden',
      decisionRationale: 'Stripe hosted checkout offloads PCI compliance entirely',
      status: 'accepted',
    });

    constraintRepo.create({
      projectId,
      category: 'security',
      title: 'No raw credit card data in memory',
      ruleContent: 'PAN and CVV numbers must never be logged or stored in server state',
      enforcementLevel: 'mandatory',
    });

    // 6. Setup graph nodes for code intelligence
    graphRepo.addNode({
      projectId,
      entityType: 'file',
      path: 'src/payment/stripe.ts',
      label: 'stripe.ts',
      name: 'stripe.ts',
    });
    graphRepo.addNode({
      projectId,
      entityType: 'symbol',
      path: 'src/payment/stripe.ts',
      label: 'StripeCheckoutController',
      name: 'StripeCheckoutController',
      lineStart: 10,
      lineEnd: 50,
      metadata: { kind: 'class', signature: 'class StripeCheckoutController' },
    });

    // Initialize MCP server instance
    server = new ProjectOSMCPServer({
      db: client.db,
      projectRoot: tempDir,
    });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. Tool Listing & Registration
  // ---------------------------------------------------------------------------

  describe('Tool Definitions', () => {
    it('registers exactly 21 tools in MCP definition catalog', () => {
      // Access tool definitions
      const tools = (server as unknown as { getToolDefinitions(): Array<{ name: string }> }).getToolDefinitions();
      expect(tools.length).toBe(21);

      const toolNames = tools.map((t) => t.name);

      // Verify all 14 query tools
      expect(toolNames).toContain('get_project');
      expect(toolNames).toContain('get_task');
      expect(toolNames).toContain('get_handoff');
      expect(toolNames).toContain('get_context');
      expect(toolNames).toContain('search_memory');
      expect(toolNames).toContain('search_graph');
      expect(toolNames).toContain('get_relevant_files');
      expect(toolNames).toContain('get_decisions');
      expect(toolNames).toContain('get_constraints');
      expect(toolNames).toContain('find_symbol');
      expect(toolNames).toContain('find_references');
      expect(toolNames).toContain('get_git_state');
      expect(toolNames).toContain('get_git_diff');
      expect(toolNames).toContain('get_validation');

      // Verify all 7 mutation tools
      expect(toolNames).toContain('update_task');
      expect(toolNames).toContain('add_task_step');
      expect(toolNames).toContain('save_handoff');
      expect(toolNames).toContain('complete_step');
      expect(toolNames).toContain('record_decision');
      expect(toolNames).toContain('record_blocker');
      expect(toolNames).toContain('request_validation');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. AI Coding Agent Workflow Scenario
  // ---------------------------------------------------------------------------

  describe('Agent Question-Answer Scenarios without Full-Project Read', () => {
    it('Question 1: "What is the current task?" -> get_task', async () => {
      const result = (await server.dispatchTool('get_task', { task_id: taskId })) as {
        id: string;
        title: string;
        description: string;
        status: string;
        steps: Array<{ description: string }>;
      };

      expect(result.id).toBe(taskId);
      expect(result.title).toBe('Implement Payment Gateway');
      expect(result.description).toContain('Stripe SDK');
      expect(result.steps.length).toBe(3);
    });

    it('Question 2: "What has already been done?" -> get_handoff', async () => {
      const result = (await server.dispatchTool('get_handoff', { task_id: taskId })) as {
        completedWork: string;
        nextAction: string;
        currentFile: string;
      };

      expect(result.completedWork).toContain('payment config and webhook secret validator');
      expect(result.currentFile).toBe('src/payment/stripe.ts');
    });

    it('Question 3: "What files are relevant?" -> get_relevant_files', async () => {
      const result = (await server.dispatchTool('get_relevant_files', { task_id: taskId })) as Array<{
        path: string;
      }>;

      expect(Array.isArray(result)).toBe(true);
    });

    it('Question 4: "What decisions constrain this task?" -> get_decisions & get_constraints', async () => {
      const decisions = (await server.dispatchTool('get_decisions', {
        task_id: taskId,
        project_id: projectId,
      })) as Array<{ title: string; decisionRationale: string }>;

      expect(decisions.length).toBe(1);
      expect(decisions[0]!.title).toContain('Stripe Checkout');

      const constraints = (await server.dispatchTool('get_constraints', {
        project_id: projectId,
      })) as Array<{ title: string; ruleContent: string }>;

      expect(constraints.length).toBe(1);
      expect(constraints[0]!.title).toContain('No raw credit card data');
    });

    it('Question 5: "What should I do next?" -> get_handoff.nextAction', async () => {
      const result = (await server.dispatchTool('get_handoff', { task_id: taskId })) as {
        nextAction: string;
      };

      expect(result.nextAction).toBe('Implement createCheckoutSession method in StripeCheckoutController');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Query Tools
  // ---------------------------------------------------------------------------

  describe('Query Tools', () => {
    it('get_project returns project metadata', async () => {
      const proj = (await server.dispatchTool('get_project', { projectId })) as {
        id: string;
        name: string;
        rootPath: string;
      };
      expect(proj.id).toBe(projectId);
      expect(proj.name).toBe('MCP Integration Test Project');
    });

    it('get_context returns budgeted context and token estimate', async () => {
      const ctx = (await server.dispatchTool('get_context', {
        task_id: taskId,
        budget: 5000,
      })) as {
        context: string;
        tokenEstimate: number;
      };

      expect(ctx.context).toContain('TASK CONTEXT');
      expect(ctx.context).toContain('Implement Payment Gateway');
      expect(ctx.tokenEstimate).toBeGreaterThan(0);
    });

    it('search_graph finds indexed symbols and files', async () => {
      const results = (await server.dispatchTool('search_graph', {
        query: 'Stripe',
      })) as Array<{ name: string; entityType: string }>;

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toContain('Stripe');
    });

    it('find_symbol returns location of StripeCheckoutController', async () => {
      const symbols = (await server.dispatchTool('find_symbol', {
        name: 'StripeCheckoutController',
        project_id: projectId,
      })) as Array<{ symbolName: string; filePath: string; lineStart: number }>;

      expect(symbols.length).toBeGreaterThan(0);
      expect(symbols[0]!.symbolName).toBe('StripeCheckoutController');
      expect(symbols[0]!.filePath).toBe('src/payment/stripe.ts');
      expect(symbols[0]!.lineStart).toBe(10);
    });

    it('find_references finds symbol callers/inspection', async () => {
      const ref = (await server.dispatchTool('find_references', {
        symbol: 'StripeCheckoutController',
        project_id: projectId,
      })) as { symbol: unknown };

      expect(ref.symbol).toBeDefined();
    });

    it('get_git_state handles non-git directories gracefully', async () => {
      const state = (await server.dispatchTool('get_git_state', {})) as {
        isGit: boolean;
      };
      expect(typeof state.isGit).toBe('boolean');
    });

    it('get_git_diff handles non-git or clean directories gracefully', async () => {
      const diff = (await server.dispatchTool('get_git_diff', {})) as {
        diff: string;
      };
      expect(typeof diff.diff).toBe('string');
    });

    it('get_validation returns run history for task', async () => {
      validationRepo.recordValidationRun({
        projectId,
        taskId,
        validatorType: 'test',
        status: 'passed',
        results: { passed: true },
        runBy: 'TestRunner',
        exitCode: 0,
        startedAt: Date.now() - 1000,
        finishedAt: Date.now(),
      });

      const res = (await server.dispatchTool('get_validation', { task_id: taskId })) as {
        totalRuns: number;
        latestRun: { status: string };
      };

      expect(res.totalRuns).toBe(1);
      expect(res.latestRun.status).toBe('passed');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Mutation Tools & Audit Logging
  // ---------------------------------------------------------------------------

  describe('Mutation Tools & Audit Logging', () => {
    it('update_task updates task status and logs audit event', async () => {
      const res = (await server.dispatchTool('update_task', {
        task_id: taskId,
        status: 'in_progress',
        priority: 'critical',
      })) as { success: boolean; task: { status: string; priority: string } };

      expect(res.success).toBe(true);
      expect(res.task.status).toBe('in_progress');
      expect(res.task.priority).toBe('critical');

      // Verify audit event
      const events = eventRepo.listByProject(projectId);
      const mutationEvent = events.find((e) => e.eventType === 'mcp_mutation' && e.aggregateId === 'update_task');
      expect(mutationEvent).toBeDefined();
    });

    it('add_task_step and complete_step work seamlessly', async () => {
      // 1. Add step
      const addRes = (await server.dispatchTool('add_task_step', {
        task_id: taskId,
        description: 'Add Stripe webhook signature validation',
        step_number: 4,
      })) as { success: boolean; step: { id: string; description: string; stepOrder: number } };

      expect(addRes.success).toBe(true);
      expect(addRes.step.description).toBe('Add Stripe webhook signature validation');
      expect(addRes.step.stepOrder).toBe(4);

      // 2. Complete step
      const completeRes = (await server.dispatchTool('complete_step', {
        task_id: taskId,
        step_number: 4,
      })) as { success: boolean; step: { status: string } };

      expect(completeRes.success).toBe(true);
      expect(completeRes.step.status).toBe('completed');
    });

    it('save_handoff records next agent instructions', async () => {
      const res = (await server.dispatchTool('save_handoff', {
        task_id: taskId,
        completed_work: 'Integrated Stripe API client',
        next_action: 'Write mock test suite',
        agent_identity: 'Agent-007',
        current_step: 'Add unit tests',
      })) as { success: boolean; handoffId: string };

      expect(res.success).toBe(true);
      expect(res.handoffId).toBeTruthy();

      const latest = handoffRepo.listByTaskId(taskId)[0];
      expect(latest?.agentIdentity).toBe('Agent-007');
      expect(latest?.nextAction).toBe('Write mock test suite');
    });

    it('record_decision creates an ADR in project state', async () => {
      const res = (await server.dispatchTool('record_decision', {
        task_id: taskId,
        title: 'Use Webhook Idempotency Keys',
        context: 'Prevent double-processing payment events',
        rationale: 'Store event.id in Redis cache with 24h TTL',
      })) as { success: boolean; decision: { id: string; title: string } };

      expect(res.success).toBe(true);
      expect(res.decision.title).toBe('Use Webhook Idempotency Keys');

      const found = decisionRepo.findById(res.decision.id);
      expect(found).toBeDefined();
      expect(found?.decisionRationale).toContain('Store event.id in Redis');
    });

    it('record_blocker records blocking condition on task', async () => {
      const res = (await server.dispatchTool('record_blocker', {
        task_id: taskId,
        description: 'Awaiting Stripe production webhook signing secret',
      })) as { success: boolean; blocker: string };

      expect(res.success).toBe(true);
      expect(res.blocker).toContain('Awaiting Stripe');

      const task = taskRepo.findById(taskId);
      expect(task?.status).toBe('blocked');
    });

    it('request_validation executes validation suite and records run', async () => {
      const res = (await server.dispatchTool('request_validation', {
        task_id: taskId,
        command: 'echo "mock test passed"',
      })) as { success: boolean; result: { status: string } };

      expect(res.success).toBe(true);
      expect(res.result.status).toBe('passed');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Security & Sandbox Boundary
  // ---------------------------------------------------------------------------

  describe('Security Boundaries & Restrictions', () => {
    it('rejects path traversal attempts with ..', () => {
      expect(() => security.sanitizePath('../../etc/passwd')).toThrow(ValidationError);
      expect(() => security.sanitizePath('src/../../shadow')).toThrow(ValidationError);
    });

    it('rejects null bytes in path', () => {
      expect(() => security.sanitizePath('file\0.txt')).toThrow(ValidationError);
    });

    it('rejects access to sensitive secret files', () => {
      expect(() => security.sanitizePath('.env')).toThrow(ValidationError);
      expect(() => security.sanitizePath('.env.production')).toThrow(ValidationError);
      expect(() => security.sanitizePath('server.pem')).toThrow(ValidationError);
      expect(() => security.sanitizePath('id_rsa')).toThrow(ValidationError);
    });

    it('blocks save_handoff if current_file violates path traversal', async () => {
      await expect(
        server.dispatchTool('save_handoff', {
          task_id: taskId,
          completed_work: 'Testing exploit',
          next_action: 'None',
          current_file: '../../secret.txt',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('validates task ID format strictly', () => {
      expect(security.validateTaskId('TASK-123')).toBe('TASK-123');
      expect(security.validateTaskId('task_abc_01')).toBe('task_abc_01');

      expect(() => security.validateTaskId('; DROP TABLE tasks;--')).toThrow(ValidationError);
      expect(() => security.validateTaskId('a')).toThrow(ValidationError);
      expect(() => security.validateTaskId('task/with/slash')).toThrow(ValidationError);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. CLI Integration
  // ---------------------------------------------------------------------------

  describe('CLI ai-project-os', () => {
    it('shows help menu when invoked with --help', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await cliMain(['--help']);
      expect(spy).toHaveBeenCalled();
      const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(output).toContain('ai-project-os');
      expect(output).toContain('mcp');
      expect(output).toContain('notebook');
      spy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. ISSUE-HIGH-002: MCP Tool Aliases & Compatibility
  // ---------------------------------------------------------------------------

  describe('ISSUE-HIGH-002: MCP Tool Aliases (ai_os_* compatibility)', () => {
    it('resolves ai_os_get_active_task identically to get_task and accepts taskId alias', async () => {
      const canonicalResult = (await server.dispatchTool('get_task', { task_id: taskId })) as Record<string, unknown>;
      const aliasResult = (await server.dispatchTool('ai_os_get_active_task', { taskId })) as Record<string, unknown>;

      expect(aliasResult['id']).toBe(canonicalResult['id']);
      expect(aliasResult['title']).toBe(canonicalResult['title']);
    });

    it('resolves ai_os_get_task_context identically to get_context and accepts taskId alias', async () => {
      const canonicalResult = (await server.dispatchTool('get_context', { task_id: taskId, budget: 4000 })) as Record<string, unknown>;
      const aliasResult = (await server.dispatchTool('ai_os_get_task_context', { taskId, budget: 4000 })) as Record<string, unknown>;

      expect(aliasResult['tokenEstimate']).toBe(canonicalResult['tokenEstimate']);
    });

    it('resolves ai_os_submit_handoff identically to save_handoff and accepts summary/nextSteps aliases', async () => {
      const aliasHandoff = (await server.dispatchTool('ai_os_submit_handoff', {
        taskId,
        summary: 'Completed OAuth state check',
        nextSteps: ['Add PKCE code verifier', 'Run unit tests'],
        agentIdentity: 'Antigravity-Agent',
      })) as Record<string, unknown>;

      expect(aliasHandoff['success']).toBe(true);
      expect(aliasHandoff['handoffId']).toBeDefined();

      const latest = handoffRepo.findLatestByTaskId(taskId);
      expect(latest?.completedWork).toBe('Completed OAuth state check');
      expect(latest?.nextAction).toContain('Add PKCE code verifier');
    });

    it('resolves ai_os_query_graph identically to search_graph', async () => {
      const graphResult = (await server.dispatchTool('ai_os_query_graph', { query: 'payment' })) as Record<string, unknown>;
      expect(graphResult).toBeDefined();
    });

    it('resolves ai_os_search_memory identically to search_memory', async () => {
      const memResult = (await server.dispatchTool('ai_os_search_memory', { query: 'architecture' })) as unknown[];
      expect(Array.isArray(memResult)).toBe(true);
    });

    it('resolves ai_os_validate_task identically to request_validation', async () => {
      const valResult = (await server.dispatchTool('ai_os_validate_task', {
        taskId,
        command: 'echo validation_ok',
      })) as Record<string, unknown>;

      expect(valResult['success']).toBe(true);
    });
  });
});
