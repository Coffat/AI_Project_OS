import { describe, it, expect } from 'vitest';
import { add, multiply } from '../src/math.js';

describe('Math Utilities', () => {
  it('correctly calculates add', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('correctly calculates multiply', () => {
    expect(multiply(4, 5)).toBe(20);
  });
});
