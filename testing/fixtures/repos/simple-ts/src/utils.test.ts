import { multiply, divide, sum, average } from './utils';

describe('multiply', () => {
  it('should multiply two positive numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  it('should multiply with zero', () => {
    expect(multiply(5, 0)).toBe(0);
  });

  it('should multiply negative numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(-2, -3)).toBe(6);
  });
});

describe('divide', () => {
  it('should divide two numbers', () => {
    expect(divide(6, 2)).toBe(3);
  });

  it('should throw on divide by zero', () => {
    expect(() => divide(5, 0)).toThrow('Cannot divide by zero');
  });
});

describe('sum', () => {
  it('should sum an array of numbers', () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
  });

  it('should return 0 for empty array', () => {
    expect(sum([])).toBe(0);
  });
});

describe('average', () => {
  it('should calculate average', () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
  });

  it('should return 0 for empty array', () => {
    expect(average([])).toBe(0);
  });
});

