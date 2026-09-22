import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MCPSecurityValidator } from './mcp-security.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  DecisionRepository,
  ConstraintRepository,
  ValidationRepository,
} from '../database/repositories/index.js';
import { TaskService } from '../tasks/task-service.js';
import { ITaskEngine } from '../tasks/task-engine.js';
import { HandoffEngine, IHandoffEngine } from '../handoff/handoff-engine.js';
import { MemoryEngine, IMemoryEngine } from '../memory/memory-engine.js';
import { ContextService } from '../context/context-service.js';
import { ContextEngine } from '../context/context-engine.js';
import { GraphService } from '../graph/graph-service.js';
import { CodeQueryService } from '../code-intelligence/code-query-service.js';
import { GitAnalyzer } from '../code-intelligence/git-analyzer.js';
import { ValidationService } from '../validation/validation-service.js';
import { MemoryCategory } from '../core/types.js';

const execFileAsync = promisify(execFile);

export interface MCPServerDependencies {
  db: DatabaseSync;
  projectRoot: string;
  taskService?: TaskService;
  taskEngine?: ITaskEngine;
  handoffEngine?: IHandoffEngine;
  memoryEngine?: IMemoryEngine;
  contextService?: ContextService;
  graphService?: GraphService;
  codeQueryService?: CodeQueryService;
  gitAnalyzer?: GitAnalyzer;
  validationService?: ValidationService;
}

export class ProjectOSMCPServer {
  private readonly server: Server;
  private readonly db: DatabaseSync;
  private readonly projectRoot: string;
  private readonly security: MCPSecurityValidator;

  // Domain Repositories & Services
  private readonly projectRepo: ProjectRepository;
  private readonly taskRepo: TaskRepository;
  private readonly handoffRepo: HandoffRepository;
  private readonly decisionRepo: DecisionRepository;
  private readonly constraintRepo: ConstraintRepository;
  private readonly validationRepo: ValidationRepository;

  private readonly taskService: TaskService;
  private readonly handoffEngine: IHandoffEngine;
  private readonly memoryEngine: IMemoryEngine;
  private readonly contextService: ContextService;
  private readonly contextEngine: ContextEngine;
  private readonly graphService: GraphService;
  private readonly codeQueryService: CodeQueryService;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly validationService: ValidationService;

  constructor(deps: MCPServerDependencies) {
    this.db = deps.db;
    this.projectRoot = deps.projectRoot;
    this.security = new MCPSecurityValidator(this.projectRoot, this.db);

    // Initialize repositories
    this.projectRepo = new ProjectRepository(this.db);
    this.taskRepo = new TaskRepository(this.db);
    this.handoffRepo = new HandoffRepository(this.db);
    this.decisionRepo = new DecisionRepository(this.db);
    this.constraintRepo = new ConstraintRepository(this.db);
    this.validationRepo = new ValidationRepository(this.db);

    // Initialize services
    this.taskService = deps.taskService ?? new TaskService(this.db);
    this.gitAnalyzer = deps.gitAnalyzer ?? new GitAnalyzer();
    this.graphService = deps.graphService ?? new GraphService(this.db);
    this.codeQueryService = deps.codeQueryService ?? new CodeQueryService(this.db);
    this.memoryEngine = deps.memoryEngine ?? new MemoryEngine(this.db);
    this.contextService = deps.contextService ?? new ContextService(this.db, this.graphService, this.projectRoot);
    this.contextEngine = new ContextEngine(
      deps.taskEngine ?? (this.taskService as unknown as ITaskEngine),
      this.memoryEngine,
      deps.handoffEngine ?? new HandoffEngine(this.db),
      this.contextService
    );
    this.handoffEngine = deps.handoffEngine ?? new HandoffEngine(this.db);
    this.validationService = deps.validationService ?? new ValidationService(this.db, this.projectRoot);

    this.server = new Server(
      {
        name: 'ai-project-os',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerHandlers();
  }

  // ---------------------------------------------------------------------------
  // Tool Definitions
  // ---------------------------------------------------------------------------

  public getToolDefinitions(includeAliases = false): Tool[] {
    const canonicalTools: Tool[] = [
      // 1. get_project
      {
        name: 'get_project',
        description: 'Get project overview, name, root path, and metadata',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: { type: 'string', description: 'Optional project ID' },
          },
        },
      },
      // 2. get_task
      {
        name: 'get_task',
        description: 'Get task information, status, priority, and steps by taskId',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Unique task identifier' },
          },
          required: ['task_id'],
        },
      },
      // 3. get_handoff
      {
        name: 'get_handoff',
        description: 'Get latest handoff report (what has been done, what is next) for a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },
      // 4. get_context
      {
        name: 'get_context',
        description: 'Get prioritized, budgeted context pack for an agent working on a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            budget: { type: 'number', description: 'Maximum token budget (default: 8000)' },
          },
          required: ['task_id'],
        },
      },
      // 5. search_memory
      {
        name: 'search_memory',
        description: 'Search canonical project memory, architecture notes, and constitution',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or concept' },
            category: { type: 'string', description: 'Optional category (e.g. ARCHITECTURE, CONSTITUTION, CONSTRAINT)' },
          },
          required: ['query'],
        },
      },
      // 6. search_graph
      {
        name: 'search_graph',
        description: 'Search the relational code/knowledge graph by node name, path, or label',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Node label, name, or path keyword' },
          },
          required: ['query'],
        },
      },
      // 7. get_relevant_files
      {
        name: 'get_relevant_files',
        description: 'Get candidate files scored and ranked by relevance for a specific task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },
      // 8. get_decisions
      {
        name: 'get_decisions',
        description: 'Get Architecture Decision Records (ADRs) constraining the project or task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional Task ID filter' },
            project_id: { type: 'string', description: 'Optional Project ID filter' },
          },
        },
      },
      // 9. get_constraints
      {
        name: 'get_constraints',
        description: 'Get active mandatory security, architecture, or policy constraints',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional Task ID' },
            project_id: { type: 'string', description: 'Optional Project ID' },
          },
        },
      },
      // 10. find_symbol
      {
        name: 'find_symbol',
        description: 'Find symbol declaration location (file, start/end lines, signature, docstring)',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Symbol name (function, class, interface)' },
            project_id: { type: 'string', description: 'Optional Project ID' },
          },
          required: ['name'],
        },
      },
      // 11. find_references
      {
        name: 'find_references',
        description: 'Find callers, callees, and importers for a symbol or module',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: { type: 'string', description: 'Symbol name or module path' },
            project_id: { type: 'string', description: 'Optional Project ID' },
          },
          required: ['symbol'],
        },
      },
      // 12. get_git_state
      {
        name: 'get_git_state',
        description: 'Get current git repository state: branch, commit, modified/added files',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // 13. get_git_diff
      {
        name: 'get_git_diff',
        description: 'Get git diff of uncommitted working tree changes',
        inputSchema: {
          type: 'object',
          properties: {
            staged: { type: 'boolean', description: 'If true, inspect staged changes' },
          },
        },
      },
      // 14. get_validation
      {
        name: 'get_validation',
        description: 'Get latest test/validation results and quality gate blockers for a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
          },
          required: ['task_id'],
        },
      },

      // --- MUTATION TOOLS ---

      // 15. update_task
      {
        name: 'update_task',
        description: 'Update task properties such as status, title, description, priority, or assigned agent',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            status: { type: 'string', description: 'planned | in_progress | blocked | review | completed | cancelled' },
            title: { type: 'string', description: 'Updated title' },
            description: { type: 'string', description: 'Updated description' },
            priority: { type: 'string', description: 'low | normal | high | critical' },
            assigned_agent: { type: 'string', description: 'Agent identity' },
          },
          required: ['task_id'],
        },
      },
      // 16. add_task_step
      {
        name: 'add_task_step',
        description: 'Add an actionable execution step to a task plan',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            description: { type: 'string', description: 'Step description' },
            step_number: { type: 'number', description: 'Optional step sequence order number' },
          },
          required: ['task_id', 'description'],
        },
      },
      // 17. save_handoff
      {
        name: 'save_handoff',
        description: 'Save an agent handoff report before ending turn or pausing execution',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            completed_work: { type: 'string', description: 'Summary of completed work' },
            next_action: { type: 'string', description: 'Next concrete action for the next agent' },
            agent_identity: { type: 'string', description: 'Agent name/identity' },
            blockers: { type: 'string', description: 'Any blocking issues encountered' },
            current_step: { type: 'string', description: 'Current step name' },
            current_file: { type: 'string', description: 'Current file being modified' },
          },
          required: ['task_id', 'completed_work', 'next_action'],
        },
      },
      // 18. complete_step
      {
        name: 'complete_step',
        description: 'Mark a task step as completed',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            step_number: { type: 'number', description: 'Step order number (1-based)' },
            step_id: { type: 'string', description: 'Step ID' },
          },
          required: ['task_id'],
        },
      },
      // 19. record_decision
      {
        name: 'record_decision',
        description: 'Record an architectural decision (ADR) into persistent project memory',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Optional Task ID' },
            title: { type: 'string', description: 'Decision title' },
            context: { type: 'string', description: 'Context and problem statement' },
            rationale: { type: 'string', description: 'Decision rationale and trade-offs' },
            consequences: { type: 'string', description: 'Consequences and implications' },
            status: { type: 'string', description: 'proposed | accepted | rejected | deprecated | superseded' },
          },
          required: ['title', 'context', 'rationale'],
        },
      },
      // 20. record_blocker
      {
        name: 'record_blocker',
        description: 'Record a blocking issue on a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            description: { type: 'string', description: 'Blocker description' },
          },
          required: ['task_id', 'description'],
        },
      },
      // 21. request_validation
      {
        name: 'request_validation',
        description: 'Request automated validation/tests for a task to verify quality gates',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            command: { type: 'string', description: 'Test command to run (default: pnpm test)' },
          },
          required: ['task_id'],
        },
      },
    ];

    const aliasTools: Tool[] = [
      {
        name: 'ai_os_get_active_task',
        description: 'Alias for get_task. Get task information, status, priority, and steps by taskId',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Unique task identifier' },
            taskId: { type: 'string', description: 'Unique task identifier (alias)' },
          },
        },
      },
      {
        name: 'ai_os_get_task_context',
        description: 'Alias for get_context. Get prioritized, budgeted context pack for an agent working on a task',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            taskId: { type: 'string', description: 'Task ID (alias)' },
            budget: { type: 'number', description: 'Maximum token budget (default: 8000)' },
          },
        },
      },
      {
        name: 'ai_os_submit_handoff',
        description: 'Alias for save_handoff. Save an agent handoff report before ending turn or pausing execution',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            taskId: { type: 'string', description: 'Task ID (alias)' },
            completed_work: { type: 'string', description: 'Summary of completed work' },
            summary: { type: 'string', description: 'Summary of completed work (alias)' },
            next_action: { type: 'string', description: 'Next concrete action for the next agent' },
            nextSteps: { type: 'array', description: 'List of next actions (alias)' },
            agent_identity: { type: 'string', description: 'Agent name/identity' },
            blockers: { type: 'string', description: 'Any blocking issues encountered' },
            current_step: { type: 'string', description: 'Current step name' },
            current_file: { type: 'string', description: 'Current file being modified' },
          },
        },
      },
      {
        name: 'ai_os_query_graph',
        description: 'Alias for search_graph. Search the relational code/knowledge graph by node name, path, or label',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Node label, name, or path keyword' },
          },
          required: ['query'],
        },
      },
      {
        name: 'ai_os_validate_task',
        description: 'Alias for request_validation. Request automated validation/tests for a task to verify quality gates',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            taskId: { type: 'string', description: 'Task ID (alias)' },
            command: { type: 'string', description: 'Test command to run (default: pnpm test)' },
          },
        },
      },
      {
        name: 'ai_os_search_memory',
        description: 'Alias for search_memory. Search canonical project memory, architecture notes, and constitution',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term or concept' },
            category: { type: 'string', description: 'Optional category' },
          },
          required: ['query'],
        },
      },
    ];

    return includeAliases ? [...canonicalTools, ...aliasTools] : canonicalTools;
  }

  // ---------------------------------------------------------------------------
  // Request Handlers
  // ---------------------------------------------------------------------------

  private registerHandlers(): void {
    // ListTools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.getToolDefinitions(),
      };
    });

    // CallTool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const safeArgs = (args ?? {}) as Record<string, unknown>;

      try {
        const result = await this.dispatchTool(name, safeArgs);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : String(error),
            },
          ],
        };
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Tool Dispatcher
  // ---------------------------------------------------------------------------

  public async dispatchTool(name: string, rawArgs: Record<string, unknown>): Promise<unknown> {
    const aliasMap: Record<string, string> = {
      'ai_os_get_active_task': 'get_task',
      'ai_os_get_task_context': 'get_context',
      'ai_os_submit_handoff': 'save_handoff',
      'ai_os_query_graph': 'search_graph',
      'ai_os_validate_task': 'request_validation',
      'ai_os_search_memory': 'search_memory',
    };

    let targetName = aliasMap[name] || name;
    if (targetName.startsWith('ai_os_')) {
      targetName = targetName.replace('ai_os_', '');
    }

    const args: Record<string, unknown> = { ...rawArgs };
    if (args['taskId'] !== undefined && args['task_id'] === undefined) {
      args['task_id'] = args['taskId'];
    }
    if (args['projectId'] !== undefined && args['project_id'] === undefined) {
      args['project_id'] = args['projectId'];
    }
    if (args['summary'] !== undefined && args['completed_work'] === undefined) {
      args['completed_work'] = args['summary'];
    }
    if (args['completedWork'] !== undefined && args['completed_work'] === undefined) {
      args['completed_work'] = args['completedWork'];
    }
    if (args['nextAction'] !== undefined && args['next_action'] === undefined) {
      args['next_action'] = args['nextAction'];
    }
    if (args['nextSteps'] !== undefined && args['next_action'] === undefined) {
      args['next_action'] = Array.isArray(args['nextSteps'])
        ? (args['nextSteps'] as string[]).join('; ')
        : String(args['nextSteps']);
    }
    if (args['agentIdentity'] !== undefined && args['agent_identity'] === undefined) {
      args['agent_identity'] = args['agentIdentity'];
    }
    if (args['currentStep'] !== undefined && args['current_step'] === undefined) {
      args['current_step'] = args['currentStep'];
    }
    if (args['currentFile'] !== undefined && args['current_file'] === undefined) {
      args['current_file'] = args['currentFile'];
    }
    if (args['stepNumber'] !== undefined && args['step_number'] === undefined) {
      args['step_number'] = args['stepNumber'];
    }
    if (args['stepId'] !== undefined && args['step_id'] === undefined) {
      args['step_id'] = args['stepId'];
    }

    switch (targetName) {
      // 1. get_project
      case 'get_project': {
        const projectId = args['projectId'] ? String(args['projectId']) : undefined;
        if (projectId) {
          const p = this.projectRepo.findById(projectId);
          if (!p) throw new Error(`Project '${projectId}' not found`);
          return p;
        }
        const projects = this.projectRepo.list();
        if (projects.length === 0) {
          return { name: 'AI Project OS', rootPath: this.projectRoot, description: 'Active workspace' };
        }
        return projects[0];
      }

      // 2. get_task
      case 'get_task': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const task = this.taskRepo.findById(taskId);
        if (!task) throw new Error(`Task '${taskId}' not found`);
        const steps = this.taskRepo.listSteps(taskId);
        return { ...task, steps };
      }

      // 3. get_handoff
      case 'get_handoff': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const latest = this.handoffRepo.findLatestByTaskId(taskId);
        if (!latest) {
          return { message: `No handoff report recorded yet for task '${taskId}'`, taskId };
        }
        return latest;
      }

      // 4. get_context
      case 'get_context': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const budget = typeof args['budget'] === 'number' ? args['budget'] : 8000;
        const result = await this.contextEngine.getContext(taskId, budget);
        return {
          context: result.context,
          tokenEstimate: result.token_estimate,
          totalProjectTokens: result.total_project_tokens,
          selectedContextTokens: result.selected_context_tokens,
          compressionRatio: result.compression_ratio,
          loadedLevels: result.loaded_levels,
          includedEntities: result.included_entities,
          excludedEntities: result.excluded_entities,
          excludedContext: result.excluded_context,
          reasoning: result.reasoning_metadata,
        };
      }

      // 5. search_memory
      case 'search_memory': {
        const query = String(args['query']);
        const category = args['category'] ? (String(args['category']) as MemoryCategory) : undefined;
        const memories = await this.memoryEngine.searchMemory(query, category);
        return memories.map((m) => ({
          id: m.id,
          key: m.key,
          category: m.category,
          title: m.title,
          content: m.content,
        }));
      }

      // 6. search_graph
      case 'search_graph': {
        const query = String(args['query']);
        const defaultProject = this.projectRepo.list()[0]?.id ?? 'default';
        const stmt = this.db.prepare(`
          SELECT * FROM graph_nodes
          WHERE project_id = ? AND (name LIKE ? OR label LIKE ? OR path LIKE ?)
          LIMIT 50
        `);
        const rows = stmt.all(defaultProject, `%${query}%`, `%${query}%`, `%${query}%`) as Record<string, unknown>[];
        return rows.map((r) => ({
          id: String(r['id']),
          entityType: String(r['entity_type']),
          name: r['name'] ? String(r['name']) : undefined,
          label: String(r['label']),
          path: r['path'] ? String(r['path']) : undefined,
        }));
      }

      // 7. get_relevant_files
      case 'get_relevant_files': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const task = this.taskRepo.findById(taskId);
        if (!task) throw new Error(`Task '${taskId}' not found`);
        const result = await this.contextService.generateContextForTask(task);
        const fileEntities = result.included_entities.filter((e) => e.type === 'file');
        return fileEntities.map((f) => ({
          path: f.id.replace(/^file:/, ''),
          score: f.score,
          tokens: f.tokens,
        }));
      }

      // 8. get_decisions
      case 'get_decisions': {
        const taskId = args['task_id'] ? this.security.validateTaskId(String(args['task_id'])) : undefined;
        const projectId = args['project_id'] ? String(args['project_id']) : (this.projectRepo.list()[0]?.id ?? 'default');
        const decisions = this.decisionRepo.listByProject(projectId);
        if (taskId) {
          return decisions.filter((d) => d.taskId === taskId);
        }
        return decisions;
      }

      // 9. get_constraints
      case 'get_constraints': {
        const projectId = args['project_id'] ? String(args['project_id']) : (this.projectRepo.list()[0]?.id ?? 'default');
        return this.constraintRepo.listByProject(projectId);
      }

      // 10. find_symbol
      case 'find_symbol': {
        const name = String(args['name']);
        const projectId = args['project_id'] ? String(args['project_id']) : (this.projectRepo.list()[0]?.id ?? 'default');
        return this.codeQueryService.findSymbolLocation(name, projectId);
      }

      // 11. find_references
      case 'find_references': {
        const symbol = String(args['symbol']);
        const projectId = args['project_id'] ? String(args['project_id']) : (this.projectRepo.list()[0]?.id ?? 'default');
        const inspection = this.codeQueryService.inspectSymbol(symbol, projectId);
        if (inspection) {
          return {
            symbol: inspection.symbol,
            callers: inspection.callers,
            callees: inspection.callees,
            relatedTests: inspection.relatedTests,
          };
        }
        // Fallback: check module importers
        const importers = this.codeQueryService.findModuleImporters(symbol, projectId);
        return { symbol, importers };
      }

      // 12. get_git_state
      case 'get_git_state': {
        const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
        if (!isGit) {
          return { isGit: false, message: 'Not inside a git repository' };
        }
        const [branch, commit, changes] = await Promise.all([
          this.gitAnalyzer.getCurrentBranch(this.projectRoot),
          this.gitAnalyzer.getCurrentCommit(this.projectRoot),
          this.gitAnalyzer.getWorkingTreeChanges(this.projectRoot),
        ]);
        return {
          isGit: true,
          branch,
          commit,
          modified: changes.modified,
          added: changes.added,
          deleted: changes.deleted,
        };
      }

      // 13. get_git_diff
      case 'get_git_diff': {
        const isGit = await this.gitAnalyzer.isGitRepository(this.projectRoot);
        if (!isGit) {
          return { diff: '', message: 'Not inside a git repository' };
        }
        const staged = Boolean(args['staged']);
        const gitArgs = staged ? ['diff', '--cached'] : ['diff'];
        try {
          const { stdout } = await execFileAsync('git', gitArgs, { cwd: this.projectRoot });
          return { diff: stdout || '(no changes)' };
        } catch (err) {
          return { diff: '', error: String(err) };
        }
      }

      // 14. get_validation
      case 'get_validation': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const runs = this.validationRepo.listByTask(taskId);
        return {
          taskId,
          totalRuns: runs.length,
          latestRun: runs[0] ?? null,
          runs: runs.slice(0, 5),
        };
      }

      // --- MUTATION TOOLS ---

      // 15. update_task
      case 'update_task': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const updates: Record<string, unknown> = {};
        if (args['title']) updates['title'] = String(args['title']);
        if (args['description']) updates['description'] = String(args['description']);
        if (args['priority']) updates['priority'] = String(args['priority']);
        if (args['assigned_agent']) updates['assignedAgent'] = String(args['assigned_agent']);

        if (args['status']) {
          this.taskRepo.transitionStatus(taskId, args['status'] as Parameters<TaskRepository['transitionStatus']>[1]);
        }

        const task = this.taskRepo.update(taskId, updates);
        this.security.logMutation('update_task', args, task, task.projectId);
        return { success: true, task };
      }

      // 16. add_task_step
      case 'add_task_step': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const description = String(args['description']);
        const stepNumber = typeof args['step_number'] === 'number' ? args['step_number'] : undefined;
        const step = await this.taskService.addStep(taskId, description, stepNumber);
        const resultStep = {
          ...step,
          description: step.title,
        };
        this.security.logMutation('add_task_step', args, resultStep);
        return { success: true, step: resultStep };
      }

      // 17. save_handoff
      case 'save_handoff': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const task = this.taskRepo.findById(taskId);
        if (!task) throw new Error(`Task '${taskId}' not found`);

        if (args['current_file']) {
          this.security.sanitizePath(String(args['current_file']));
        }

        const report = await this.handoffEngine.recordHandoff({
          taskId,
          projectId: task.projectId,
          objective: task.description ?? task.title,
          completedWork: String(args['completed_work']),
          nextAction: String(args['next_action']),
          agentIdentity: String(args['agent_identity'] ?? 'AI-Agent'),
          blockers: args['blockers'] ? String(args['blockers']) : undefined,
          currentStep: args['current_step'] ? String(args['current_step']) : undefined,
          currentFile: args['current_file'] ? String(args['current_file']) : undefined,
        });

        this.security.logMutation('save_handoff', args, report, task.projectId);
        return { success: true, handoffId: report.id, report };
      }

      // 18. complete_step
      case 'complete_step': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const stepNumber = typeof args['step_number'] === 'number' ? args['step_number'] : undefined;
        const stepId = args['step_id'] ? String(args['step_id']) : undefined;

        const steps = this.taskRepo.listSteps(taskId);
        let targetStep = steps.find((s) => s.id === stepId || (stepNumber !== undefined && s.stepOrder === stepNumber));

        if (!targetStep && stepNumber === undefined && stepId === undefined) {
          // If neither specified, complete the first pending step
          targetStep = steps.find((s) => s.status === 'pending' || s.status === 'in_progress');
        }

        if (!targetStep) {
          throw new Error(`Step not found for task '${taskId}'`);
        }

        const updated = await this.taskService.completeStep(targetStep.id);
        const resultStep = {
          ...updated,
          description: updated.title,
        };
        this.security.logMutation('complete_step', args, resultStep);
        return { success: true, step: resultStep };
      }

      // 19. record_decision
      case 'record_decision': {
        const title = String(args['title']);
        const context = String(args['context']);
        const rationale = String(args['rationale']);
        const consequences = args['consequences'] ? String(args['consequences']) : undefined;
        const status = args['status'] ? String(args['status']) : 'accepted';
        const taskId = args['task_id'] ? this.security.validateTaskId(String(args['task_id'])) : undefined;
        const projectId = this.projectRepo.list()[0]?.id ?? 'default';

        const decision = this.decisionRepo.create({
          projectId,
          taskId,
          title,
          context,
          decisionRationale: rationale,
          consequences,
          status: status as Parameters<DecisionRepository['create']>[0]['status'],
        });

        this.security.logMutation('record_decision', args, decision, projectId);
        return { success: true, decision };
      }

      // 20. record_blocker
      case 'record_blocker': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const description = String(args['description']);
        const task = this.taskRepo.findById(taskId);
        if (!task) throw new Error(`Task '${taskId}' not found`);

        const blocker = await this.taskService.addBlocker(taskId, description);
        try {
          this.taskRepo.transitionStatus(taskId, 'blocked');
        } catch {
          // Task might already be blocked or not eligible for transition
        }

        const result = { taskId, blocker: description, blockerId: blocker.id, timestamp: Date.now() };
        this.security.logMutation('record_blocker', args, result, task.projectId);
        return { success: true, ...result };
      }

      // 21. request_validation
      case 'request_validation': {
        const taskId = this.security.validateTaskId(String(args['task_id']));
        const task = this.taskRepo.findById(taskId);
        if (!task) throw new Error(`Task '${taskId}' not found`);

        const rawCommand = args['command'] ? String(args['command']) : 'pnpm test';
        const command = this.security.validateCommand(rawCommand);
        const result = await this.validationService.runTests({
          taskId,
          projectId: task.projectId,
          command,
        });

        this.security.logMutation('request_validation', args, result, task.projectId);
        return { success: true, result };
      }

      default:
        throw new Error(`Unknown MCP tool: ${name}`);
    }
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
