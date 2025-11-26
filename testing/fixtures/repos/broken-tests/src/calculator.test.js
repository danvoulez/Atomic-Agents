const { add, subtract, multiply, divide } = require('./calculator');

describe('Calculator', () => {
  test('add returns sum', () => {
    expect(add(2, 3)).toBe(5);
  });

  // This test will FAIL because subtract is buggy
  test('subtract returns difference', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  test('multiply returns product', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  // This test will FAIL because no division by zero check
  test('divide handles division by zero', () => {
    expect(() => divide(5, 0)).toThrow();
  });
});

