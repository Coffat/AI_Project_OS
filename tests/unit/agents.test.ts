import { describe, it, expect } from 'vitest';
import { ClaudeAdapter, AntigravityAdapter } from '../../src/agents/adapter.js';
import { ContextPack } from '../../src/core/types.js';

describe('Agent Adapters', () => {
  const sampleContext: ContextPack = {
    taskId: 't-100',
    taskTitle: 'Refactor SQLite Client',
    constitutionRules: ['Local-First', 'Deterministic First'],
    architectureRules: ['Hexagonal Architecture', 'Ports and Adapters'],
    relevantDecisions: [],
    relevantSymbols: [],
    recentHandoff: {
      id: 'h-1',
      taskId: 't-100',
      projectId: 'p-1',
      objective: 'Refactor SQLite client with native bindings',
      completedWork: 'Scaffolded ports',
      modifiedFiles: [],
      decisions: [],
      tests: [],
      nextAction: 'Implement SQLite adapter',
      gitState: {},
      agentIdentity: 'Antigravity',
      createdAt: Date.now(),
    },
    tokenBudget: 4000,
    estimatedTokens: 250,
  };

  it('ClaudeAdapter should format context into system and user prompts', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.agentName).toBe('ClaudeCode');

    const envelope = adapter.formatContextEnvelope(sampleContext);
    expect(envelope.systemPrompt).toContain('=== CONSTITUTION & IMMUTABLE RULES ===');
    expect(envelope.systemPrompt).toContain('Local-First');
    expect(envelope.userPrompt).toContain('Active Task: [t-100] Refactor SQLite Client');
    expect(envelope.userPrompt).toContain('=== PREVIOUS AGENT HANDOFF ===');
    expect(envelope.userPrompt).toContain('From: Antigravity');
    expect(envelope.userPrompt).toContain('Next Action: Implement SQLite adapter');
  });

  it('AntigravityAdapter should format context without mutating business logic', () => {
    const adapter = new AntigravityAdapter();
    expect(adapter.agentName).toBe('Antigravity');

    const envelope = adapter.formatContextEnvelope(sampleContext);
    expect(envelope.userPrompt).toContain('Refactor SQLite Client');
  });
});
