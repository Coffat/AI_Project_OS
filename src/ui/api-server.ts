import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ControlCenterService } from './control-center-service.js';
import {
  ResumeTaskInput,
  SaveHandoffInput,
  ValidateTaskInput,
  RecordProgressInput,
} from './types.js';

export interface ApiServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
}

export class ApiServer {
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly host: string;
  private readonly staticDir?: string;
  private readonly service: ControlCenterService;

  constructor(service: ControlCenterService, options?: ApiServerOptions) {
    this.service = service;
    this.port = options?.port ?? 4173;
    this.host = options?.host ?? '127.0.0.1';
    const defaultStatic = path.join(process.cwd(), 'ui', 'dist');
    this.staticDir = options?.staticDir ?? (fs.existsSync(defaultStatic) ? defaultStatic : undefined);
  }

  public async start(): Promise<{ port: number; url: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (error) {
          this.sendJson(res, 500, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      this.server.on('error', reject);

      this.server.listen(this.port, this.host, () => {
        const address = this.server?.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        resolve({
          port: actualPort,
          url: `http://${this.host}:${actualPort}`,
        });
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrl = req.url ?? '/';
    let decodedUrl = rawUrl;
    try {
      decodedUrl = decodeURIComponent(rawUrl);
    } catch {
      this.sendJson(res, 400, { error: 'Bad Request: Malformed URI' });
      return;
    }

    if (
      decodedUrl.includes('..') ||
      decodedUrl.includes('\0') ||
      rawUrl.toLowerCase().includes('%2e%2e')
    ) {
      this.sendJson(res, 403, { error: 'Forbidden: Path traversal detected' });
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.searchParams;

    // --- API Endpoints ---
    if (pathname.startsWith('/api/')) {
      if (req.method === 'GET') {
        switch (pathname) {
          case '/api/health': {
            this.sendJson(res, 200, { status: 'ok', timestamp: Date.now() });
            return;
          }
          case '/api/dashboard': {
            const taskId = query.get('taskId') ?? undefined;
            const projectId = query.get('projectId') ?? undefined;
            const state = await this.service.getFullDashboardState(taskId, projectId);
            this.sendJson(res, 200, state);
            return;
          }
          case '/api/projects': {
            const projects = this.service.listProjects();
            const activeProjectId = this.service.getActiveProjectId();
            this.sendJson(res, 200, { projects, activeProjectId });
            return;
          }
          case '/api/header': {
            const projectId = query.get('projectId') ?? undefined;
            const header = await this.service.getHeaderState(projectId);
            this.sendJson(res, 200, header);
            return;
          }
          case '/api/task': {
            const taskId = query.get('taskId') ?? undefined;
            const projectId = query.get('projectId') ?? undefined;
            const taskPanel = await this.service.getTaskPanelState(taskId, projectId);
            this.sendJson(res, 200, taskPanel);
            return;
          }
          case '/api/context': {
            const taskId = query.get('taskId') ?? undefined;
            const projectId = query.get('projectId') ?? undefined;
            const budgetParam = query.get('budget');
            const budget = budgetParam ? parseInt(budgetParam, 10) : 8000;
            const contextPanel = await this.service.getContextPanelState(taskId, budget, projectId);
            this.sendJson(res, 200, contextPanel);
            return;
          }
          case '/api/memory': {
            const projectId = query.get('projectId') ?? undefined;
            const memoryPanel = await this.service.getMemoryPanelState(projectId);
            this.sendJson(res, 200, memoryPanel);
            return;
          }
          case '/api/graph': {
            const projectId = query.get('projectId') ?? undefined;
            const graphPanel = await this.service.getGraphPanelState(projectId);
            this.sendJson(res, 200, graphPanel);
            return;
          }
          case '/api/handoff': {
            const taskId = query.get('taskId') ?? undefined;
            const projectId = query.get('projectId') ?? undefined;
            const handoffPanel = await this.service.getHandoffPanelState(taskId, projectId);
            this.sendJson(res, 200, handoffPanel);
            return;
          }
          case '/api/validation': {
            const taskId = query.get('taskId') ?? undefined;
            const projectId = query.get('projectId') ?? undefined;
            const valPanel = await this.service.getValidationPanelState(taskId, projectId);
            this.sendJson(res, 200, valPanel);
            return;
          }
          case '/api/agent': {
            const projectId = query.get('projectId') ?? undefined;
            const agentPanel = await this.service.getAgentPanelState(projectId);
            this.sendJson(res, 200, agentPanel);
            return;
          }
          case '/api/providers/accounts': {
            const state = this.service.getProviderCockpitState();
            this.sendJson(res, 200, state);
            return;
          }
          case '/api/providers/oauth/status': {
            const state = query.get('state') ?? '';
            const session = this.service.getOAuthSession(state);
            this.sendJson(res, 200, { session: session ?? null });
            return;
          }
          case '/oauth-callback':
          case '/api/providers/oauth/callback': {
            const state = query.get('state') ?? '';
            const code = query.get('code') ?? undefined;
            try {
              const acc = await this.service.completeOAuthCallback(state, code);
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html>
<html>
<head><title>OAuth Authentication Successful</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="background:#1e293b;padding:2.5rem;border-radius:1rem;border:1px solid #334155;text-align:center;max-width:440px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
    <div style="font-size:3.5rem;margin-bottom:1rem;">✅</div>
    <h2 style="margin:0 0 0.5rem 0;color:#38bdf8;font-size:1.5rem;">Đăng Nhập Thành Công!</h2>
    <p style="color:#94a3b8;font-size:0.95rem;line-height:1.5;">Tài khoản <strong>${acc.name}</strong> (${acc.provider.toUpperCase()}) đã được liên kết với AI Project OS an toàn.</p>
    <p style="color:#64748b;font-size:0.85rem;margin-top:0.5rem;">Tab này sẽ tự động đóng sau giây lát...</p>
    <button onclick="window.close()" style="margin-top:1.5rem;background:#4f46e5;color:white;border:none;padding:0.7rem 1.5rem;border-radius:0.5rem;cursor:pointer;font-weight:bold;font-size:0.9rem;">Đóng Tab Này</button>
  </div>
  <script>setTimeout(() => { try { window.close(); } catch(e){} }, 2000);</script>
</body>
</html>`);
            } catch (err) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`<!DOCTYPE html>
<html>
<head><title>Authentication Failed</title></head>
<body style="font-family:system-ui;background:#0f172a;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="background:#1e293b;padding:2rem;border-radius:1rem;border:1px solid #e11d48;text-align:center;max-width:400px;">
    <div style="font-size:3rem;margin-bottom:1rem;">❌</div>
    <h2 style="margin:0 0 0.5rem 0;color:#fb7185;">Đăng Nhập Thất Bại</h2>
    <p style="color:#94a3b8;font-size:0.9rem;">${err instanceof Error ? err.message : String(err)}</p>
  </div>
</body>
</html>`);
            }
            return;
          }
        }
      } else if (req.method === 'POST') {
        const body = await this.parseJsonBody(req);
        switch (pathname) {
          case '/api/projects/switch': {
            const { projectId } = body as { projectId: string };
            if (!projectId) {
              this.sendJson(res, 400, { error: 'Missing projectId' });
              return;
            }
            try {
              const project = this.service.setActiveProject(projectId);
              this.sendJson(res, 200, { success: true, project });
            } catch (err) {
              this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
            }
            return;
          }
          case '/api/projects/add':
          case '/api/projects/create': {
            const { name, rootPath, description } = body as { name?: string; rootPath: string; description?: string };
            if (!rootPath) {
              this.sendJson(res, 400, { error: 'Missing rootPath' });
              return;
            }
            try {
              const project = this.service.createOrAddProject({ name, rootPath, description });
              this.sendJson(res, 200, { success: true, project });
            } catch (err) {
              this.sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
            }
            return;
          }
          case '/api/actions/resume': {
            const result = await this.service.resumeTask(body as unknown as ResumeTaskInput);
            this.sendJson(res, 200, { success: true, result });
            return;
          }
          case '/api/actions/handoff': {
            const result = await this.service.saveHandoff(body as unknown as SaveHandoffInput);
            this.sendJson(res, 200, { success: true, result });
            return;
          }
          case '/api/actions/validate': {
            const result = await this.service.runValidation(body as unknown as ValidateTaskInput);
            this.sendJson(res, 200, { success: true, result });
            return;
          }
          case '/api/actions/progress': {
            const result = await this.service.recordProgress(body as unknown as RecordProgressInput);
            this.sendJson(res, 200, { success: true, result });
            return;
          }
          case '/api/providers/oauth/start': {
            const session = this.service.startOAuthLogin(body as any);
            this.sendJson(res, 200, { success: true, session });
            return;
          }
          case '/api/providers/oauth/complete': {
            const { state, code, email } = body as { state: string; code?: string; email?: string };
            const acc = await this.service.completeOAuthCallback(state, code, email);
            this.sendJson(res, 200, { success: true, account: acc });
            return;
          }
          case '/api/providers/accounts/capture': {
            const acc = this.service.captureProviderAccount(body as any);
            this.sendJson(res, 200, { success: true, account: acc });
            return;
          }
          case '/api/providers/accounts/add': {
            const acc = this.service.addProviderAccountManual(body as any);
            this.sendJson(res, 200, { success: true, account: acc });
            return;
          }
          case '/api/providers/accounts/switch': {
            const { accountId, forceClose } = body as { accountId: string; forceClose?: boolean };
            const result = this.service.switchProviderAccount(accountId, forceClose);
            this.sendJson(res, 200, result);
            return;
          }
          case '/api/providers/accounts/quota': {
            const { accountId } = body as { accountId: string };
            try {
              const quota = this.service.refreshProviderQuota(accountId);
              this.sendJson(res, 200, { success: true, quota });
            } catch (err) {
              this.sendJson(res, 429, { error: err instanceof Error ? err.message : String(err) });
            }
            return;
          }
          case '/api/providers/accounts/delete': {
            const { accountId } = body as { accountId: string };
            const deleted = this.service.deleteProviderAccount(accountId);
            this.sendJson(res, 200, { success: deleted });
            return;
          }
          case '/api/providers/instances/launch': {
            const { provider } = body as { provider: any };
            const result = this.service.launchProviderInstance(provider);
            this.sendJson(res, 200, result);
            return;
          }
        }
      } else if (req.method === 'DELETE') {
        if (pathname === '/api/providers/accounts') {
          const accountId = query.get('id');
          if (!accountId) {
            this.sendJson(res, 400, { error: 'Missing id query parameter' });
            return;
          }
          const deleted = this.service.deleteProviderAccount(accountId);
          this.sendJson(res, 200, { success: deleted });
          return;
        }
      }

      this.sendJson(res, 404, { error: `Not found: ${pathname}` });
      return;
    }

    // --- Static File Serving (SPA Fallback) ---
    if (this.staticDir && fs.existsSync(this.staticDir)) {
      const rootResolved = path.resolve(this.staticDir);
      let filePath = path.resolve(this.staticDir, '.' + pathname);

      // Path traversal security check: ensure requested file stays within staticDir
      const isInside =
        filePath === rootResolved ||
        filePath.startsWith(rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep);

      if (!isInside) {
        this.sendJson(res, 403, { error: 'Forbidden: Path traversal detected' });
        return;
      }

      if (pathname === '/' || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(this.staticDir, 'index.html');
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml',
          '.ico': 'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
        };

        const contentType = mimeTypes[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // Default HTML if no static files
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head><title>AI Project OS Control Center</title></head>
<body style="font-family:system-ui;padding:2rem;background:#0f172a;color:#f8fafc;">
  <h1>AI Project OS Desktop Control Center</h1>
  <p>API Server is running. Frontend static assets can be built via <code>pnpm build:ui</code>.</p>
  <ul>
    <li><a href="/api/health" style="color:#38bdf8;">/api/health</a></li>
    <li><a href="/api/dashboard" style="color:#38bdf8;">/api/dashboard</a></li>
  </ul>
</body>
</html>`);
      return;
    }

    this.sendJson(res, 404, { error: 'Not found' });
  }

  private sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const json = JSON.stringify(data);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
    });
  }
}
