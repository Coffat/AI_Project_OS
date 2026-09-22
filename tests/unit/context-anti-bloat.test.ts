import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ContextService } from '../../src/context/context-service.js';
import { GraphService } from '../../src/graph/graph-service.js';
import { ProjectRepository } from '../../src/database/repositories/project.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import type { Task } from '../../src/core/types.js';

describe('Phase 16: Context Engine Pre-Implementation Knowledge & Anti-Bloat', () => {
  const fixtureRoot = path.resolve(process.cwd(), 'tests/fixtures/bloated-project');
  let client: SQLiteDatabaseClient;
  let db: DatabaseSync;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let contextService: ContextService;
  let sampleTask: Task;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    db = client.db;

    projectRepo = new ProjectRepository(db);
    const project = projectRepo.create({
      name: 'bloated-project',
      rootPath: fixtureRoot,
    });

    taskRepo = new TaskRepository(db);
    sampleTask = taskRepo.create({
      projectId: project.id,
      title: 'Enhance User Profile Service',
      description: 'Implement user profile update and validation',
      priority: 'high',
    });

    const graphService = new GraphService(db);
    contextService = new ContextService(db, graphService, fixtureRoot);
  });

  afterEach(() => {
    client.close();
  });

  it('supplies existing abstractions, services, utilities, and dependencies in ContextPack', async () => {
    const result = await contextService.getContext(sampleTask.id, 8000);

    expect(result.pack).toBeDefined();
    const pack = result.pack!;

    // 1. Existing Abstractions
    expect(pack.existing_abstractions).toBeDefined();
    expect(pack.existing_abstractions!.length).toBeGreaterThan(0);
    expect(pack.existing_abstractions!.some((a) => a.name === 'User')).toBe(true);

    // 2. Existing Services
    expect(pack.existing_services).toBeDefined();
    expect(pack.existing_services!.length).toBeGreaterThan(0);
    expect(pack.existing_services!.some((s) => s.name === 'UserService')).toBe(true);

    // 3. Existing Dependencies
    expect(pack.existing_dependencies).toBeDefined();
    expect(pack.existing_dependencies!.length).toBeGreaterThan(0);
    expect(pack.existing_dependencies!.some((d) => d.name === 'lodash')).toBe(true);
  });

  it('renders Constitution and Anti-Bloat guidance prominently in context markdown', async () => {
    const result = await contextService.getContext(sampleTask.id, 8000);

    expect(result.context).toContain('Architecture Guard & Anti-Bloat Guidance');
    expect(result.context).toContain('### CONSTITUTION RULES:');
    expect(result.context).toContain('Reuse before create');
    expect(result.context).toContain('Modify before duplicate');
    expect(result.context).toContain('Minimal change');
    expect(result.context).toContain('No unnecessary dependencies');
    expect(result.context).toContain('Preserve existing architecture');
    expect(result.context).toContain('Keep modules cohesive');

    // Also renders the discovered lists
    expect(result.context).toContain('### Existing Services:');
    expect(result.context).toContain('UserService');
    expect(result.context).toContain('### Existing Installed Dependencies:');
    expect(result.context).toContain('lodash');
  });
});
