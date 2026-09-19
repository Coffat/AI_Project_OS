import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient } from '../../src/database/client.js';
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
import { ValidationError } from '../../src/core/errors.js';

describe('Repository Layer Comprehensive Tests', () => {
  let client: SQLiteDatabaseClient;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let handoffRepo: HandoffRepository;
  let decisionRepo: DecisionRepository;
  let constraintRepo: ConstraintRepository;
  let memoryRepo: MemoryRepository;
  let graphRepo: GraphRepository;
  let eventRepo: EventRepository;
  let validationRepo: ValidationRepository;
  let sessionRepo: AgentSessionRepository;

  beforeEach(() => {
    client = new SQLiteDatabaseClient(':memory:');
    projectRepo = new ProjectRepository(client.db);
    taskRepo = new TaskRepository(client.db);
    handoffRepo = new HandoffRepository(client.db);
    decisionRepo = new DecisionRepository(client.db);
    constraintRepo = new ConstraintRepository(client.db);
    memoryRepo = new MemoryRepository(client.db);
    graphRepo = new GraphRepository(client.db);
    eventRepo = new EventRepository(client.db);
    validationRepo = new ValidationRepository(client.db);
    sessionRepo = new AgentSessionRepository(client.db);
  });

  afterEach(() => {
    client.close();
  });

  it('ProjectRepository should support CRUD operations', () => {
    const created = projectRepo.create({
      name: 'AI Project OS',
      rootPath: '/projects/ai-project-os',
      description: 'Local-first OS',
    });

    expect(created.id).toBeDefined();
    expect(created.name).toBe('AI Project OS');

    const byId = projectRepo.findById(created.id);
    expect(byId).toEqual(created);

    const byPath = projectRepo.findByRootPath('/projects/ai-project-os');
    expect(byPath).toEqual(created);

    const all = projectRepo.list();
    expect(all).toHaveLength(1);

    expect(projectRepo.delete(created.id)).toBe(true);
    expect(projectRepo.findById(created.id)).toBeNull();
  });

  it('TaskRepository should enforce state transitions and optimistic concurrency', () => {
    const proj = projectRepo.create({ name: 'P1', rootPath: '/p1' });
    const task = taskRepo.create({
      projectId: proj.id,
      title: 'Setup Database',
    });

    expect(task.status).toBe('planned');
    expect(task.version).toBe(1);

    // planned -> in_progress (Valid)
    const inProgress = taskRepo.transitionStatus(task.id, 'in_progress', { expectedVersion: 1 });
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.version).toBe(2);

    // in_progress -> planned (Invalid transition)
    expect(() => {
      taskRepo.transitionStatus(task.id, 'planned');
    }).toThrow(ValidationError);

    // Version mismatch error
    expect(() => {
      taskRepo.transitionStatus(task.id, 'blocked', { expectedVersion: 1 });
    }).toThrow(/version mismatch/);

    // in_progress -> blocked -> resumed -> testing -> done
    const blocked = taskRepo.transitionStatus(task.id, 'blocked');
    expect(blocked.status).toBe('blocked');

    const resumed = taskRepo.transitionStatus(task.id, 'resumed');
    expect(resumed.status).toBe('resumed');

    const testing = taskRepo.transitionStatus(task.id, 'testing');
    expect(testing.status).toBe('testing');

    const done = taskRepo.transitionStatus(task.id, 'done');
    expect(done.status).toBe('done');
  });

  it('TaskRepository should manage task steps', () => {
    const proj = projectRepo.create({ name: 'P2', rootPath: '/p2' });
    const task = taskRepo.create({ projectId: proj.id, title: 'Task with Steps' });

    const step1 = taskRepo.addStep(task.id, 'Write types', 1);
    const step2 = taskRepo.addStep(task.id, 'Implement repo', 2);

    expect(step1.stepOrder).toBe(1);
    expect(step2.stepOrder).toBe(2);

    taskRepo.updateStepStatus(step1.id, 'completed', 'Types written');
    const steps = taskRepo.listSteps(task.id);

    expect(steps).toHaveLength(2);
    expect(steps[0]?.status).toBe('completed');
    expect(steps[0]?.resultSummary).toBe('Types written');
    expect(steps[1]?.status).toBe('pending');
  });

  it('HandoffRepository should persist and deserialize all 14 handoff fields', () => {
    const proj = projectRepo.create({ name: 'P3', rootPath: '/p3' });
    const task = taskRepo.create({ projectId: proj.id, title: 'Handoff Test' });

    const handoff = handoffRepo.create({
      taskId: task.id,
      projectId: proj.id,
      objective: 'Verify repository layer',
      completedWork: 'Built all 10 repositories and verified types',
      currentStep: 'Testing',
      currentFile: 'tests/unit/repositories.test.ts',
      modifiedFiles: ['src/core/types.ts', 'src/database/repositories/task.repository.ts'],
      decisions: ['Use strict state machine'],
      blockers: 'None',
      errors: undefined,
      tests: ['tests/unit/repositories.test.ts'],
      nextAction: 'Run seed script',
      gitState: { branch: 'main', commitHash: 'abc', isDirty: false },
      agentIdentity: 'Antigravity',
    });

    expect(handoff.id).toBeDefined();

    const retrieved = handoffRepo.findLatestByTaskId(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.objective).toBe('Verify repository layer');
    expect(retrieved?.completedWork).toBe('Built all 10 repositories and verified types');
    expect(retrieved?.modifiedFiles).toEqual(['src/core/types.ts', 'src/database/repositories/task.repository.ts']);
    expect(retrieved?.gitState).toEqual({ branch: 'main', commitHash: 'abc', isDirty: false });
    expect(retrieved?.agentIdentity).toBe('Antigravity');
  });

  it('DecisionRepository and ConstraintRepository should record architectural guidelines', () => {
    const proj = projectRepo.create({ name: 'P4', rootPath: '/p4' });

    const dec = decisionRepo.create({
      projectId: proj.id,
      title: 'SQLite Local First',
      context: 'Local-first requirement',
      decisionRationale: 'Fast embedded performance',
      status: 'accepted',
    });

    expect(dec.status).toBe('accepted');
    const decs = decisionRepo.listByProject(proj.id, 'accepted');
    expect(decs).toHaveLength(1);

    const con = constraintRepo.create({
      projectId: proj.id,
      category: 'architecture',
      title: 'Hexagonal Boundaries',
      ruleContent: 'Core cannot depend on UI',
      enforcementLevel: 'mandatory',
    });

    expect(con.enforcementLevel).toBe('mandatory');
    const cons = constraintRepo.listByProject(proj.id, 'architecture');
    expect(cons).toHaveLength(1);
  });

  it('MemoryRepository should manage documents, chunks, and FTS5 search', () => {
    const proj = projectRepo.create({ name: 'P5', rootPath: '/p5' });

    const doc = memoryRepo.upsertDocument({
      projectId: proj.id,
      docType: 'canonical',
      path: '.ai/canonical/PROJECT.md',
      title: 'Project Doc',
      contentHash: 'hash123',
      rawContent: 'AI PROJECT OS is a local-first memory operating system.',
    });

    expect(doc.version).toBe(1);

    memoryRepo.saveChunks(doc.id, [
      {
        chunkIndex: 0,
        content: 'AI PROJECT OS is a local-first memory operating system.',
        tokenCount: 10,
      },
      {
        chunkIndex: 1,
        content: 'It utilizes SQLite for relational and FTS5 search indexing.',
        tokenCount: 11,
      },
    ]);

    const chunks = memoryRepo.listChunksByDocument(doc.id);
    expect(chunks).toHaveLength(2);

    const searchResults = memoryRepo.searchChunksFTS('SQLite');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0]?.chunk.content).toContain('SQLite');
    expect(searchResults[0]?.documentPath).toBe('.ai/canonical/PROJECT.md');
  });

  it('GraphRepository should manage files, symbols, nodes, edges and query neighbors', () => {
    const proj = projectRepo.create({ name: 'P6', rootPath: '/p6' });

    const file = graphRepo.upsertFile({
      projectId: proj.id,
      path: 'src/index.ts',
      language: 'typescript',
      sizeBytes: 1024,
      lastModifiedAt: Date.now(),
      contentHash: 'hash_index',
    });

    graphRepo.addSymbols([
      {
        fileId: file.id,
        projectId: proj.id,
        name: 'bootstrapApp',
        kind: 'function',
        lineStart: 1,
        lineEnd: 10,
        signature: 'function bootstrapApp(): void',
      },
    ]);

    const symbols = graphRepo.searchSymbolsFTS('bootstrapApp');
    expect(symbols).toHaveLength(1);
    expect(symbols[0]?.name).toBe('bootstrapApp');

    // Graph Nodes & Edges
    const nodeA = graphRepo.addNode({
      projectId: proj.id,
      entityType: 'file',
      entityId: file.id,
      label: 'src/index.ts',
    });

    const nodeB = graphRepo.addNode({
      projectId: proj.id,
      entityType: 'module',
      entityId: 'core',
      label: 'Core Module',
    });

    graphRepo.addEdge({
      projectId: proj.id,
      sourceNodeId: nodeA.id,
      targetNodeId: nodeB.id,
      relationType: 'imports',
    });

    const outNeighbors = graphRepo.getNeighbors(nodeA.id, 'OUT');
    expect(outNeighbors).toHaveLength(1);
    expect(outNeighbors[0]?.node.id).toBe(nodeB.id);
    expect(outNeighbors[0]?.edge.relationType).toBe('imports');

    const inNeighbors = graphRepo.getNeighbors(nodeB.id, 'IN');
    expect(inNeighbors).toHaveLength(1);
    expect(inNeighbors[0]?.node.id).toBe(nodeA.id);
  });

  it('EventRepository, ValidationRepository, and AgentSessionRepository should record events, validations, and sessions', () => {
    const proj = projectRepo.create({ name: 'P7', rootPath: '/p7' });

    const task = taskRepo.create({ projectId: proj.id, title: 'First Task' });

    // Event audit
    const event = eventRepo.recordEvent({
      projectId: proj.id,
      eventType: 'task.created',
      aggregateType: 'task',
      aggregateId: task.id,
      payload: { title: 'First Task' },
      agentIdentity: 'Agent1',
    });

    expect(event.eventType).toBe('task.created');
    const projectEvents = eventRepo.listByProject(proj.id);
    expect(projectEvents).toHaveLength(1);

    // Validation Run
    const valRun = validationRepo.recordValidationRun({
      projectId: proj.id,
      taskId: task.id,
      validatorType: 'schema',
      status: 'passed',
      results: { valid: true },
      runBy: 'TestSuite',
    });
    expect(valRun.status).toBe('passed');
    expect(validationRepo.listByTask(task.id)).toHaveLength(1);

    // Agent Session
    const session = sessionRepo.createSession({
      projectId: proj.id,
      agentIdentity: 'Claude-3.7',
      agentType: 'ClaudeCode',
    });
    expect(session.status).toBe('active');

    const closed = sessionRepo.closeSession(session.id);
    expect(closed.status).toBe('closed');
    expect(closed.endedAt).toBeDefined();
  });
});
