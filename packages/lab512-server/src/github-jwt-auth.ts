/**
 * GitHub JWT Authentication for Lab512
 * 
 * Allows Lab512 to accept GitHub App JWTs as authentication,
 * unifying the authentication mechanism across GitHub and Lab512.
 * 
 * This means:
 * - Single set of credentials (GitHub App)
 * - Same token works for both GitHub API and Lab512 API
 * - Cleaner architecture with one auth mechanism
 */

import * as crypto from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface JWTPayload {
  iss: string;  // GitHub App ID
  iat: number;  // Issued at
  exp: number;  // Expiration
}

export interface AuthResult {
  valid: boolean;
  appId?: string;
  error?: string;
}

// =============================================================================
// JWT VERIFICATION
// =============================================================================

/**
 * Verify a GitHub App JWT
 * 
 * In a production setup, you would verify the signature against
 * GitHub's public keys. For Lab512 (local development), we can:
 * 1. Trust JWTs from known App IDs
 * 2. Verify the signature if we have the public key
 * 3. Just validate the structure and expiration
 */
export function verifyGitHubJWT(
  jwt: string, 
  options: {
    allowedAppIds?: string[];
    publicKey?: string;
  } = {}
): AuthResult {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT structure' };
    }

    // Decode header
    const headerJson = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const header = JSON.parse(headerJson);
    
    if (header.alg !== 'RS256') {
      return { valid: false, error: 'Unsupported algorithm' };
    }

    // Decode payload
    const payloadJson = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    const payload: JWTPayload = JSON.parse(payloadJson);

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      return { valid: false, error: 'Token expired' };
    }

    // Check if issued in the future (with some tolerance)
    if (payload.iat > now + 60) {
      return { valid: false, error: 'Token issued in the future' };
    }

    // Check allowed App IDs
    if (options.allowedAppIds && options.allowedAppIds.length > 0) {
      if (!options.allowedAppIds.includes(payload.iss)) {
        return { valid: false, error: 'App ID not allowed' };
      }
    }

    // If public key provided, verify signature
    if (options.publicKey) {
      const signatureInput = `${parts[0]}.${parts[1]}`;
      const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(signatureInput);
      
      if (!verify.verify(options.publicKey, signature)) {
        return { valid: false, error: 'Invalid signature' };
      }
    }

    return { valid: true, appId: payload.iss };
  } catch (error: any) {
    return { valid: false, error: `JWT parsing error: ${error.message}` };
  }
}

/**
 * Verify a GitHub Installation Token (ghs_xxx)
 * 
 * These tokens are short-lived (1 hour) and are used for git operations.
 * To verify them, we would need to call GitHub's API.
 * For Lab512, we can trust them if they have the right format.
 */
export function verifyInstallationToken(token: string): AuthResult {
  // Installation tokens start with ghs_
  if (!token.startsWith('ghs_')) {
    return { valid: false, error: 'Invalid installation token format' };
  }
  
  // Token should be at least 40 chars
  if (token.length < 40) {
    return { valid: false, error: 'Token too short' };
  }
  
  return { valid: true };
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

export interface AuthMiddlewareOptions {
  // GitHub App IDs allowed to authenticate
  allowedAppIds?: string[];
  
  // Also allow the legacy Bearer token (for backwards compatibility)
  legacySecret?: string;
  
  // Skip auth for certain paths
  skipPaths?: string[];
}

/**
 * Create Express middleware for GitHub JWT authentication
 */
export function createGitHubAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  return (req: any, res: any, next: any) => {
    // Skip certain paths
    if (options.skipPaths?.some(p => req.path.startsWith(p))) {
      return next();
    }
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ 
        error: 'Missing authorization header',
        hint: 'Use "Bearer <github-jwt>" or "Bearer <installation-token>"'
      });
    }
    
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid authorization format' });
    }
    
    const token = authHeader.slice(7);
    
    // Check for legacy Bearer token (backwards compatibility)
    if (options.legacySecret && token === options.legacySecret) {
      req.auth = { type: 'legacy', valid: true };
      return next();
    }
    
    // Check for GitHub Installation Token (ghs_xxx)
    if (token.startsWith('ghs_')) {
      const result = verifyInstallationToken(token);
      if (result.valid) {
        req.auth = { type: 'installation', valid: true, token };
        return next();
      }
      return res.status(403).json({ error: result.error });
    }
    
    // Check for GitHub App JWT
    if (token.includes('.')) {
      const result = verifyGitHubJWT(token, { allowedAppIds: options.allowedAppIds });
      if (result.valid) {
        req.auth = { type: 'jwt', valid: true, appId: result.appId };
        return next();
      }
      return res.status(403).json({ error: result.error });
    }
    
    return res.status(403).json({ error: 'Unrecognized token format' });
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  verifyGitHubJWT,
  verifyInstallationToken,
  createGitHubAuthMiddleware,
};

