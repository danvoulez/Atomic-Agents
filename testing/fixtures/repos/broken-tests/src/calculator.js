// Calculator with bugs for testing
function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  // BUG: Should be a - b
  return a + b;
}

function multiply(a, b) {
  return a * b;
}

function divide(a, b) {
  // BUG: No division by zero check
  return a / b;
}

module.exports = { add, subtract, multiply, divide };

