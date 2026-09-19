import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../src/core/events.js';
import { TaskNotFoundError, ValidationError } from '../../src/core/errors.js';

describe('Core Module', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('EventBus', () => {
    it('should subscribe and publish events', async () => {
      let received: string | null = null;
      eventBus.subscribe<string>('test:event', (payload) => {
        received = payload;
      });

      await eventBus.publish('test:event', 'hello world');
      expect(received).toBe('hello world');
    });

    it('should allow unsubscribing', async () => {
      let count = 0;
      const unsubscribe = eventBus.subscribe('increment', () => {
        count++;
      });

      await eventBus.publish('increment', null);
      expect(count).toBe(1);

      unsubscribe();
      await eventBus.publish('increment', null);
      expect(count).toBe(1);
    });
  });

  describe('Errors', () => {
    it('should create TaskNotFoundError with correct message and code', () => {
      const err = new TaskNotFoundError('task-123');
      expect(err.message).toContain('task-123');
      expect(err.code).toBe('TASK_NOT_FOUND');
      expect(err.name).toBe('TaskNotFoundError');
    });

    it('should create ValidationError with details', () => {
      const err = new ValidationError('Invalid input', { field: 'title' });
      expect(err.message).toBe('Invalid input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.validationDetails).toEqual({ field: 'title' });
    });
  });
});
