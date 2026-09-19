/**
 * Interface representing a calculator device.
 */
export interface Calculator {
  compute(a: number, b: number): number;
}

/**
 * Adds two numbers together.
 * @param a First number
 * @param b Second number
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Multiplies two numbers.
 * @param a First number
 * @param b Second number
 */
export function multiply(a: number, b: number): number {
  return a * b;
}
