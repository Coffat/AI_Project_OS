import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ITaskEngine } from '../tasks/task-engine.js';
import { IHandoffEngine } from '../handoff/handoff-engine.js';
import { IMemoryEngine } from '../memory/memory-engine.js';

export interface MCPServerDependencies {
  taskEngine: ITaskEngine;
  handoffEngine: IHandoffEngine;
  memoryEngine: IMemoryEngine;
}

export class ProjectOSMCPServer {
  private server: Server;

  constructor(private readonly deps: MCPServerDependencies) {
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

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'ai_os_get_task',
            description: 'Get task information by taskId',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
              },
              required: ['taskId'],
            },
          },
          {
            name: 'ai_os_submit_handoff',
            description: 'Submit an agent handoff report before ending turn or conversation',
            inputSchema: {
              type: 'object',
              properties: {
                taskId: { type: 'string' },
                fromAgent: { type: 'string' },
                statusSummary: { type: 'string' },
                blockers: { type: 'string' },
                nextSteps: { type: 'string' },
              },
              required: ['taskId', 'fromAgent', 'statusSummary', 'nextSteps'],
            },
          },
          {
            name: 'ai_os_search_knowledge',
            description: 'Search canonical project memory and architectural decisions',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'ai_os_get_task') {
        const taskId = String(args?.['taskId']);
        const task = await this.deps.taskEngine.getTask(taskId);
        return {
          content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
        };
      }

      if (name === 'ai_os_submit_handoff') {
        const report = await this.deps.handoffEngine.recordHandoff({
          taskId: String(args?.['taskId']),
          fromAgent: String(args?.['fromAgent']),
          statusSummary: String(args?.['statusSummary']),
          blockers: args?.['blockers'] ? String(args?.['blockers']) : undefined,
          nextSteps: String(args?.['nextSteps']),
        });
        return {
          content: [
            {
              type: 'text',
              text: `Handoff recorded successfully with ID: ${report.id}`,
            },
          ],
        };
      }

      if (name === 'ai_os_search_knowledge') {
        const query = String(args?.['query']);
        const results = await this.deps.memoryEngine.searchMemory(query);
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
