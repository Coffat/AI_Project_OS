import { getCircleA } from './circle-a.js';

export function getCircleB(): string {
  return `B -> ${getCircleA()}`;
}
