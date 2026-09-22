import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Readable, Writable } from 'node:stream';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import {
  ProjectRepository,
  TaskRepository,
} from '../../src/database/repositories/index.js';
import { ControlCenterService } from '../../src/ui/control-center-service.js';
import { ApiServer } from '../../src/ui/api-server.js';
import { ProviderAccountManager } from '../../src/providers/provider-account-manager.js';

class MockRequest extends Readable {
  method: string;
  url: string;
  headers: Record<string, string>;

  constructor(method: string, url: string, body?: unknown) {
    super();
    this.method = method;
    this.url = url;
    this.headers = { host: 'localhost' };
    if (body !== undefined) {
      const payload = typeof body === 'string' ? body : JSON.stringify(body);
      this.push(payload);
    }
    this.push(null);
  }

  override _read() {}
}

class MockResponse extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  body = '';

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>) {
    this.statusCode = statusCode;
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        this.headers[k.toLowerCase()] = v;
      }
    }
    return this;
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.body += String(chunk);
    callback();
  }

  json<T = unknown>(): T {
    return JSON.parse(this.body) as T;
  }
}

describe('Phase 15: ApiServer (HTTP REST Bridge)', () => {
  let tempDir: string;
  let client: SQLiteDatabaseClient;
  let service: ControlCenterService;
  let server: ApiServer;
  let taskId: string;

  beforeEach(async () => {
    tempDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cofaios-api-server-test-')));
    client = new SQLiteDatabaseClient({ databasePath: ':memory:' });

    const projectRepo = new ProjectRepository(client.db);
    const taskRepo = new TaskRepository(client.db);

    const project = projectRepo.create({
      name: 'API Server Test Project',
      rootPath: tempDir,
    });

    const task = taskRepo.create({
      projectId: project.id,
      title: 'API Endpoint Validation Task',
      goal: 'Validate HTTP endpoints for desktop control center',
    });
    taskId = task.id;

    const mockIdeDir = path.join(tempDir, 'mock-ides');
    fs.mkdirSync(mockIdeDir, { recursive: true });
    const providerAccountManager = new ProviderAccountManager({
      baseDir: tempDir,
      ideDataPathResolver: (provider) => path.join(mockIdeDir, provider),
    });

    service = new ControlCenterService({
      db: client.db,
      projectRoot: tempDir,
      projectId: project.id,
      providerAccountManager,
    });

    server = new ApiServer(service, { port: 4173 });
  });

  afterEach(() => {
    client.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function dispatch(method: string, url: string, body?: unknown): Promise<MockResponse> {
    const req = new MockRequest(method, url, body) as unknown as http.IncomingMessage;
    const res = new MockResponse() as unknown as http.ServerResponse;
    await server.handleRequest(req, res);
    return res as unknown as MockResponse;
  }

  it('responds to /api/health with 200 OK', async () => {
    const res = await dispatch('GET', '/api/health');
    expect(res.statusCode).toBe(200);
    const data = res.json<{ status: string; timestamp: number }>();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeGreaterThan(0);
  });

  it('serves /api/header and /api/dashboard', async () => {
    const headerRes = await dispatch('GET', '/api/header');
    expect(headerRes.statusCode).toBe(200);
    const header = headerRes.json<{ project: { name: string } }>();
    expect(header.project.name).toBe('API Server Test Project');

    const dashRes = await dispatch('GET', `/api/dashboard?taskId=${taskId}`);
    expect(dashRes.statusCode).toBe(200);
    const dash = dashRes.json<{ header: unknown; taskPanel: { task: { id: string } } }>();
    expect(dash.taskPanel.task.id).toBe(taskId);
  });

  it('serves panels endpoints: /api/task, /api/context, /api/memory, /api/graph, /api/validation, /api/agent', async () => {
    const endpoints = [
      `/api/task?taskId=${taskId}`,
      `/api/context?taskId=${taskId}`,
      '/api/memory',
      '/api/graph',
      `/api/handoff?taskId=${taskId}`,
      `/api/validation?taskId=${taskId}`,
      '/api/agent',
    ];

    for (const ep of endpoints) {
      const res = await dispatch('GET', ep);
      expect(res.statusCode).toBe(200);
      expect(res.body.length).toBeGreaterThan(0);
    }
  });

  it('executes progress mutation via POST /api/actions/progress', async () => {
    const res = await dispatch('POST', '/api/actions/progress', {
      taskId,
      addStep: { title: 'New step from HTTP client' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json<{ success: boolean; result: { task: { id: string } } }>();
    expect(data.success).toBe(true);
    expect(data.result.task.id).toBe(taskId);
  });

  it('handles /api/providers/accounts GET, POST, and DELETE endpoints', async () => {
    // 1. GET accounts
    const getRes = await dispatch('GET', '/api/providers/accounts');
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json<{ accounts: unknown[]; providers: unknown[] }>();
    expect(Array.isArray(getBody.accounts)).toBe(true);
    expect(Array.isArray(getBody.providers)).toBe(true);

    // 2. POST add manual
    const addRes = await dispatch('POST', '/api/providers/accounts/add', {
      provider: 'antigravity',
      name: 'Antigravity Pro Work',
      accountLabel: 'pro-tier',
    });
    expect(addRes.statusCode).toBe(200);
    const added = addRes.json<{ success: boolean; account: { id: string; provider: string } }>();
    expect(added.success).toBe(true);
    expect(added.account.provider).toBe('antigravity');

    // 3. POST switch
    const switchRes = await dispatch('POST', '/api/providers/accounts/switch', {
      accountId: added.account.id,
      forceClose: true,
    });
    expect(switchRes.statusCode).toBe(200);

    // 4. DELETE account
    const delRes = await dispatch('DELETE', `/api/providers/accounts?id=${added.account.id}`);
    expect(delRes.statusCode).toBe(200);
    const delData = delRes.json<{ success: boolean }>();
    expect(delData.success).toBe(true);
  });

  it('handles /api/projects GET, /api/projects/create, and /api/projects/switch POST endpoints', async () => {
    // 1. GET /api/projects
    const getRes = await dispatch('GET', '/api/projects');
    expect(getRes.statusCode).toBe(200);
    const initialProjects = getRes.json<{ projects: Array<{ id: string; name: string; isActive: boolean }>; activeProjectId: string }>();
    expect(initialProjects.projects.length).toBeGreaterThan(0);
    expect(initialProjects.activeProjectId).toBeDefined();

    // 2. POST /api/projects/create
    const subDir = path.join(tempDir, 'new-api-sub-workspace');
    fs.mkdirSync(subDir, { recursive: true });

    const createRes = await dispatch('POST', '/api/projects/create', {
      name: 'New API Workspace',
      rootPath: subDir,
      description: 'API created project',
    });
    expect(createRes.statusCode).toBe(200);
    const createdData = createRes.json<{ success: boolean; project: { id: string; name: string } }>();
    expect(createdData.success).toBe(true);
    expect(createdData.project.name).toBe('New API Workspace');

    // 3. POST /api/projects/switch back to original project
    const originalProjectId = initialProjects.projects[0]!.id;
    const switchRes = await dispatch('POST', '/api/projects/switch', {
      projectId: originalProjectId,
    });
    expect(switchRes.statusCode).toBe(200);
    const switchData = switchRes.json<{ success: boolean; project: { id: string } }>();
    expect(switchData.success).toBe(true);
    expect(switchData.project.id).toBe(originalProjectId);

    // 4. GET /api/dashboard with projectId
    const dashWithProj = await dispatch('GET', `/api/dashboard?projectId=${createdData.project.id}`);
    expect(dashWithProj.statusCode).toBe(200);
    const dashData = dashWithProj.json<{ header: { project: { id: string; name: string } } }>();
    expect(dashData.header.project.id).toBe(createdData.project.id);
    expect(dashData.header.project.name).toBe('New API Workspace');
  });

  it('handles 404 for unknown endpoints and OPTIONS for CORS', async () => {
    const corsRes = await dispatch('OPTIONS', '/api/health');
    expect(corsRes.statusCode).toBe(204);

    const notFoundRes = await dispatch('GET', '/api/unknown-route');
    expect(notFoundRes.statusCode).toBe(404);
  });
});

