/**
 * JWT Authentication
 */
import jwt from 'jsonwebtoken';

// BUG: Secret hardcoded, weak secret
const JWT_SECRET = 'secret123';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export function generateToken(payload: TokenPayload): string {
  // BUG: No expiration set
  return jwt.sign(payload, JWT_SECRET);
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    // BUG: No algorithm specification (allows "none" attack)
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function extractToken(authHeader: string): string | null {
  // BUG: No validation of Bearer format
  return authHeader.split(' ')[1];
}

