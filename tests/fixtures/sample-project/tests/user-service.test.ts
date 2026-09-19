import { describe, it, expect } from 'vitest';
import { UserService } from '../src/services/user-service.js';

describe('UserService', () => {
  it('calculates user score using math utility', () => {
    const service = new UserService();
    const score = service.calculateUserScore(10, 20);
    expect(score).toBe(30);
  });

  it('fetches user info', () => {
    const service = new UserService();
    const user = service.getUser('u123');
    expect(user.id).toBe('u123');
  });
});
