import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
import { seedDevProject } from '../../src/database/seed.js';
import {
  ProjectRepository,
  TaskRepository,
  HandoffRepository,
  DecisionRepository,
  ConstraintRepository,
  MemoryRepository,
  GraphRepository,
  EventRepository,
  ValidationRepository,
  AgentSessionRepository,
} from '../../src/database/repositories/index.js';

describe('Dev Project Seeder', () => {
  let client: SQLiteDatabaseClient;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
  });

  afterEach(() => {
    client.close();
  });

  it('should seed complete dev project graph without errors', () => {
    const seedResult = seedDevProject(client.db);

    expect(seedResult.projectId).toBeDefined();
    expect(seedResult.taskId).toBeDefined();
    expect(seedResult.handoffId).toBeDefined();
    expect(seedResult.decisionId).toBeDefined();
    expect(seedResult.constraintId).toBeDefined();

    // Verify entities are populated in database
    const projectRepo = new ProjectRepository(client.db);
    const taskRepo = new TaskRepository(client.db);
    const handoffRepo = new HandoffRepository(client.db);
    const decisionRepo = new DecisionRepository(client.db);
    const constraintRepo = new ConstraintRepository(client.db);
    const memoryRepo = new MemoryRepository(client.db);
    const graphRepo = new GraphRepository(client.db);
    const eventRepo = new EventRepository(client.db);
    const valRepo = new ValidationRepository(client.db);
    const sessionRepo = new AgentSessionRepository(client.db);

    expect(projectRepo.findById(seedResult.projectId)).not.toBeNull();

    const task = taskRepo.findById(seedResult.taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe('in_progress');

    const steps = taskRepo.listSteps(seedResult.taskId);
    expect(steps).toHaveLength(3);

    const handoff = handoffRepo.findById(seedResult.handoffId);
    expect(handoff).not.toBeNull();
    expect(handoff?.modifiedFiles.length).toBeGreaterThan(0);
    expect(handoff?.agentIdentity).toBe('Antigravity-LeadArchitect');

    expect(decisionRepo.findById(seedResult.decisionId)).not.toBeNull();
    expect(constraintRepo.findById(seedResult.constraintId)).not.toBeNull();
    expect(memoryRepo.listDocuments(seedResult.projectId)).toHaveLength(1);
    expect(graphRepo.listFiles(seedResult.projectId)).toHaveLength(1);
    expect(eventRepo.listByProject(seedResult.projectId)).toHaveLength(1);
    expect(valRepo.listByTask(seedResult.taskId)).toHaveLength(1);
    expect(sessionRepo.findActiveByProject(seedResult.projectId)).toHaveLength(1);
  });
});
