/**
 * Validation Utilities
 * 
 * BUG: Most functions are incomplete or have logic errors
 */

export function isValidEmail(email: string): boolean {
  // BUG: Overly simple regex, allows invalid emails
  return email.includes('@');
}

export function isStrongPassword(password: string): boolean {
  // BUG: Only checks length, no complexity
  return password.length > 5;
}

export function sanitizeInput(input: string): string {
  // BUG: Incomplete sanitization
  return input.replace('<', '');
}

export function validateUserId(id: string): boolean {
  // BUG: Doesn't properly validate UUID format
  return id.length > 0;
}

export function parsePositiveInt(value: string): number {
  // BUG: Doesn't handle negative numbers or NaN
  return parseInt(value);
}

export function truncateString(str: string, maxLength: number): string {
  // BUG: Off-by-one error
  return str.slice(0, maxLength - 1);
}

export function formatCurrency(amount: number): string {
  // BUG: Doesn't handle negative numbers or rounding
  return '$' + amount;
}

export function calculateDiscount(price: number, discountPercent: number): number {
  // BUG: Doesn't validate discount range (could be > 100%)
  return price - (price * discountPercent / 100);
}

export function mergeArrays<T>(arr1: T[], arr2: T[]): T[] {
  // BUG: Doesn't remove duplicates
  return [...arr1, ...arr2];
}

export function deepClone<T>(obj: T): T {
  // BUG: Doesn't handle circular references, dates, or functions
  return JSON.parse(JSON.stringify(obj));
}

