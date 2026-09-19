import { describe, it, expect } from 'vitest';
import { TaskStateMachine } from '../../src/tasks/task-state-machine.js';
import { ValidationError } from '../../src/core/errors.js';
import { TaskStatus } from '../../src/core/types.js';

describe('TaskStateMachine', () => {
  describe('Valid Transitions', () => {
    const validPairs: Array<[TaskStatus, TaskStatus]> = [
      ['planned', 'in_progress'],
      ['planned', 'blocked'],
      ['in_progress', 'blocked'],
      ['in_progress', 'handoff'],
      ['in_progress', 'testing'],
      ['in_progress', 'done'],
      ['blocked', 'resumed'],
      ['blocked', 'in_progress'],
      ['blocked', 'handoff'],
      ['handoff', 'resumed'],
      ['handoff', 'in_progress'],
      ['handoff', 'blocked'],
      ['resumed', 'in_progress'],
      ['resumed', 'testing'],
      ['resumed', 'blocked'],
      ['testing', 'done'],
      ['testing', 'in_progress'],
      ['testing', 'blocked'],
      ['done', 'in_progress'], // Reopen
    ];

    it.each(validPairs)('should allow transition from %s to %s', (from, to) => {
      expect(TaskStateMachine.canTransition(from, to)).toBe(true);
      expect(() => TaskStateMachine.assertTransition(from, to, 'test-task')).not.toThrow();
    });
  });

  describe('Invalid Transitions', () => {
    const invalidPairs: Array<[TaskStatus, TaskStatus]> = [
      ['planned', 'done'],
      ['planned', 'testing'],
      ['planned', 'resumed'],
      ['planned', 'handoff'],
      ['blocked', 'done'],
      ['blocked', 'testing'],
      ['handoff', 'done'],
      ['handoff', 'testing'],
      ['done', 'blocked'],
      ['done', 'testing'],
      ['done', 'handoff'],
      ['done', 'resumed'],
    ];

    it.each(invalidPairs)('should reject invalid transition from %s to %s', (from, to) => {
      expect(TaskStateMachine.canTransition(from, to)).toBe(false);
      expect(() => TaskStateMachine.assertTransition(from, to, 'test-task')).toThrow(ValidationError);
    });
  });

  it('should list allowed transitions for a given status', () => {
    const plannedAllowed = TaskStateMachine.getAllowedTransitions('planned');
    expect(plannedAllowed).toEqual(['in_progress', 'blocked']);

    const inProgressAllowed = TaskStateMachine.getAllowedTransitions('in_progress');
    expect(inProgressAllowed).toContain('blocked');
    expect(inProgressAllowed).toContain('handoff');
    expect(inProgressAllowed).toContain('testing');
    expect(inProgressAllowed).toContain('done');
  });
});
