/**
 * Multiply two numbers
 * @param x First number
 * @param y Second number
 * @returns Product of x and y
 */
export function multiply(x: number, y: number): number {
  return x * y;
}

/**
 * Divide two numbers
 * @param x Numerator
 * @param y Denominator
 * @returns Quotient of x and y
 */
export function divide(x: number, y: number): number {
  if (y === 0) {
    throw new Error("Cannot divide by zero");
  }
  return x / y;
}

/**
 * Calculate the sum of an array
 * @param numbers Array of numbers
 * @returns Sum of all numbers
 */
export function sum(numbers: number[]): number {
  return numbers.reduce((acc, n) => acc + n, 0);
}

/**
 * Calculate the average of an array
 * @param numbers Array of numbers
 * @returns Average of all numbers
 */
export function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }
  return sum(numbers) / numbers.length;
}

