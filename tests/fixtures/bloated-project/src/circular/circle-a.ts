import { getCircleB } from './circle-b.js';

export function getCircleA(): string {
  return `A -> ${getCircleB()}`;
}
