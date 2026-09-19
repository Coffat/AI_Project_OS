import type { DatabaseSync } from 'node:sqlite';
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
} from './repositories/index.js';

export interface SeedResult {
  projectId: string;
  taskId: string;
  handoffId: string;
  decisionId: string;
  constraintId: string;
}

export function seedDevProject(db: DatabaseSync): SeedResult {
  const projectRepo = new ProjectRepository(db);
  const taskRepo = new TaskRepository(db);
  const handoffRepo = new HandoffRepository(db);
  const decisionRepo = new DecisionRepository(db);
  const constraintRepo = new ConstraintRepository(db);
  const memoryRepo = new MemoryRepository(db);
  const graphRepo = new GraphRepository(db);
  const eventRepo = new EventRepository(db);
  const validationRepo = new ValidationRepository(db);
  const sessionRepo = new AgentSessionRepository(db);

  // 1. Seed Project
  const project = projectRepo.create({
    name: 'AI Project OS Dev Environment',
    rootPath: '/Users/vuthang/Documents/CofAIOS',
    description: 'Local development and integration sandbox for AI Project OS',
  });

  // 2. Seed Tasks & Steps
  const task1 = taskRepo.create({
    projectId: project.id,
    title: 'Phase 1: Database & State Core Implementation',
    description: 'Implement SQLite persistent state layer with 17 entities and repository pattern',
    priority: 'high',
    assignedAgent: 'Antigravity',
  });

  taskRepo.addStep(task1.id, 'Design DDL schema for 17 entities', 1);
  taskRepo.addStep(task1.id, 'Build migration engine and run 001_initial_schema', 2);
  taskRepo.addStep(task1.id, 'Implement repository layer and unit tests', 3);

  // Transition task to in_progress
  taskRepo.transitionStatus(task1.id, 'in_progress');

  // 3. Seed Handoff
  const handoff = handoffRepo.create({
    taskId: task1.id,
    projectId: project.id,
    objective: 'Complete database migration and repository layer',
    completedWork: 'Created all 17 tables, migration engine, and full repository layer with transaction support',
    currentStep: 'Step 3: Verification and unit testing',
    currentFile: 'src/database/seed.ts',
    modifiedFiles: [
      'src/core/types.ts',
      'src/database/migrations/001_initial_schema.sql',
      'src/database/migration/migrator.ts',
      'src/database/repositories/task.repository.ts',
      'src/database/repositories/handoff.repository.ts',
    ],
    decisions: ['Use native node:sqlite DatabaseSync', 'Enforce strict task lifecycle state machine'],
    blockers: undefined,
    errors: undefined,
    tests: ['tests/unit/migration.test.ts', 'tests/unit/repositories.test.ts'],
    nextAction: 'Run full verification suite and verify transaction rollback behaviors',
    gitState: {
      branch: 'main',
      commitHash: 'e470152',
      isDirty: true,
      untrackedFilesCount: 0,
    },
    agentIdentity: 'Antigravity-LeadArchitect',
  });

  // 4. Seed Decisions
  const decision = decisionRepo.create({
    projectId: project.id,
    taskId: task1.id,
    title: 'Use native node:sqlite over better-sqlite3',
    context: 'Node v26 has breaking V8 C++ API changes causing native compilation issues with better-sqlite3',
    decisionRationale: 'Native node:sqlite DatabaseSync is zero-dependency, ultra-fast, and natively supports FTS5 and WAL mode',
    consequences: 'Eliminated native build step and gyp compilation errors completely',
    status: 'accepted',
    sourceFile: '.ai/canonical/DECISIONS/0001-init-architecture.md',
  });

  // 5. Seed Constraints
  const constraint = constraintRepo.create({
    projectId: project.id,
    category: 'policy',
    title: 'Zero Rate-limit Bypass Policy',
    ruleContent: 'Never implement mechanisms to circumvent or bypass AI provider quotas or rate limits',
    enforcementLevel: 'mandatory',
    sourceFile: '.ai/canonical/CONSTRAINTS.md',
  });

  // 6. Seed Memory Documents & Chunks
  const doc = memoryRepo.upsertDocument({
    projectId: project.id,
    docType: 'canonical',
    path: '.ai/canonical/CONSTITUTION.md',
    title: 'Constitution',
    contentHash: 'hash_constitution_v1',
    rawContent: '# AI PROJECT OS Constitution\n\nTask Outlives Conversation.\nDual Knowledge Layer.',
  });

  memoryRepo.saveChunks(doc.id, [
    {
      chunkIndex: 0,
      content: 'Task Outlives Conversation: Tasks must be preserved independently of conversation lifecycle.',
      tokenCount: 16,
    },
    {
      chunkIndex: 1,
      content: 'Dual Knowledge Layer: Markdown is human truth, SQLite is machine state.',
      tokenCount: 14,
    },
  ]);

  // 7. Seed Files & Symbols
  const file = graphRepo.upsertFile({
    projectId: project.id,
    path: 'src/database/client.ts',
    language: 'typescript',
    sizeBytes: 2048,
    lastModifiedAt: Date.now(),
    contentHash: 'hash_db_client',
  });

  graphRepo.addSymbols([
    {
      fileId: file.id,
      projectId: project.id,
      name: 'SQLiteDatabaseClient',
      kind: 'class',
      lineStart: 18,
      lineEnd: 70,
      signature: 'class SQLiteDatabaseClient implements IDatabaseClient',
      docstring: 'SQLite database client wrapper providing transaction and migration capabilities',
    },
  ]);

  // 8. Seed Graph Nodes & Edge
  const nodeFile = graphRepo.addNode({
    projectId: project.id,
    entityType: 'file',
    entityId: file.id,
    label: 'src/database/client.ts',
  });

  const nodeTask = graphRepo.addNode({
    projectId: project.id,
    entityType: 'task',
    entityId: task1.id,
    label: 'Task: Database State Core',
  });

  graphRepo.addEdge({
    projectId: project.id,
    sourceNodeId: nodeTask.id,
    targetNodeId: nodeFile.id,
    relationType: 'affects',
    weight: 1.0,
  });

  // 9. Seed Audit Event
  eventRepo.recordEvent({
    projectId: project.id,
    eventType: 'task.status_changed',
    aggregateType: 'task',
    aggregateId: task1.id,
    payload: { from: 'planned', to: 'in_progress' },
    agentIdentity: 'Antigravity-LeadArchitect',
  });

  // 10. Seed Validation Run
  validationRepo.recordValidationRun({
    projectId: project.id,
    taskId: task1.id,
    validatorType: 'schema',
    status: 'passed',
    results: { tablesChecked: 17, foreignKeysValid: true },
    runBy: 'SystemValidator',
  });

  // 11. Seed Agent Session
  sessionRepo.createSession({
    projectId: project.id,
    agentIdentity: 'Antigravity-LeadArchitect',
    agentType: 'Antigravity',
  });

  return {
    projectId: project.id,
    taskId: task1.id,
    handoffId: handoff.id,
    decisionId: decision.id,
    constraintId: constraint.id,
  };
}
