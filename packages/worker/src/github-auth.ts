/**
 * GitHub App Authentication
 * 
 * Handles authentication with GitHub using a GitHub App.
 * Generates short-lived installation access tokens for git operations.
 */

import * as crypto from 'crypto';
import * as https from 'https';

// =============================================================================
// TYPES
// =============================================================================

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId?: string; // If known, otherwise we'll look it up
}

export interface InstallationToken {
  token: string;
  expiresAt: Date;
  permissions: Record<string, string>;
  repositorySelection: 'all' | 'selected';
}

export interface GitCredentials {
  username: string;
  password: string; // This is the token
  gitUrl: (repoUrl: string) => string;
}

// =============================================================================
// JWT GENERATION
// =============================================================================

/**
 * Generate a JWT for GitHub App authentication.
 * JWTs are used to get installation access tokens.
 * Valid for 10 minutes max.
 */
function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  
  const payload = {
    iat: now - 60, // Issued 60 seconds ago (clock drift tolerance)
    exp: now + 600, // Expires in 10 minutes
    iss: appId,
  };
  
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  
  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, 'base64');
  const encodedSignature = base64UrlFromBase64(signature);
  
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlFromBase64(base64: string): string {
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// =============================================================================
// GITHUB API CLIENT
// =============================================================================

async function githubRequest<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Atomic-Agents/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      } as Record<string, string>,
    };
    
    if (body) {
      options.headers['Content-Type'] = 'application/json';
    }
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            resolve(data as unknown as T);
          }
        } else {
          reject(new Error(`GitHub API error: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

// =============================================================================
// GITHUB APP CLIENT
// =============================================================================

export class GitHubAppAuth {
  private appId: string;
  private privateKey: string;
  private cachedToken: InstallationToken | null = null;
  private installationId?: string;
  
  constructor(config: GitHubAppConfig) {
    this.appId = config.appId;
    this.privateKey = config.privateKey;
    this.installationId = config.installationId;
  }
  
  /**
   * Create from environment variables
   */
  static fromEnv(): GitHubAppAuth {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
    
    if (!appId) {
      throw new Error('GITHUB_APP_ID environment variable is required');
    }
    
    if (!privateKey) {
      throw new Error('GITHUB_APP_PRIVATE_KEY environment variable is required');
    }
    
    // Private key might be base64 encoded (for easier env var storage)
    let decodedKey = privateKey;
    if (!privateKey.includes('-----BEGIN')) {
      decodedKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    }
    
    // Also handle escaped newlines
    decodedKey = decodedKey.replace(/\\n/g, '\n');
    
    return new GitHubAppAuth({
      appId,
      privateKey: decodedKey,
      installationId,
    });
  }
  
  /**
   * Get JWT for API calls (short-lived, 10 min)
   */
  getJWT(): string {
    return generateJWT(this.appId, this.privateKey);
  }
  
  /**
   * List all installations of this app
   */
  async listInstallations(): Promise<Array<{
    id: number;
    account: { login: string; type: string };
    repository_selection: 'all' | 'selected';
  }>> {
    const jwt = this.getJWT();
    return githubRequest('GET', '/app/installations', jwt);
  }
  
  /**
   * Get installation ID for a specific owner/repo
   */
  async getInstallationId(owner: string, repo?: string): Promise<number> {
    const jwt = this.getJWT();
    
    // Try to get installation for the repo
    if (repo) {
      try {
        const result = await githubRequest<{ id: number }>(
          'GET',
          `/repos/${owner}/${repo}/installation`,
          jwt
        );
        return result.id;
      } catch {
        // Fall through to owner lookup
      }
    }
    
    // Get installation for the owner (user or org)
    const result = await githubRequest<{ id: number }>(
      'GET',
      `/users/${owner}/installation`,
      jwt
    );
    return result.id;
  }
  
  /**
   * Get an installation access token
   * This is what you use for git operations
   */
  async getInstallationToken(installationId?: number): Promise<InstallationToken> {
    // Check cache
    if (this.cachedToken && this.cachedToken.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return this.cachedToken;
    }
    
    const id = installationId || this.installationId;
    if (!id) {
      throw new Error('Installation ID is required. Set GITHUB_APP_INSTALLATION_ID or pass installationId');
    }
    
    const jwt = this.getJWT();
    
    const result = await githubRequest<{
      token: string;
      expires_at: string;
      permissions: Record<string, string>;
      repository_selection: 'all' | 'selected';
    }>('POST', `/app/installations/${id}/access_tokens`, jwt);
    
    this.cachedToken = {
      token: result.token,
      expiresAt: new Date(result.expires_at),
      permissions: result.permissions,
      repositorySelection: result.repository_selection,
    };
    
    return this.cachedToken;
  }
  
  /**
   * Get credentials for git operations
   */
  async getGitCredentials(owner?: string, repo?: string): Promise<GitCredentials> {
    let installationId: number | undefined;
    
    // Get installation ID if not set
    if (!this.installationId && owner) {
      installationId = await this.getInstallationId(owner, repo);
    }
    
    const tokenData = await this.getInstallationToken(installationId);
    
    return {
      username: 'x-access-token',
      password: tokenData.token,
      gitUrl: (repoUrl: string) => {
        const url = new URL(repoUrl);
        url.username = 'x-access-token';
        url.password = tokenData.token;
        return url.toString();
      },
    };
  }
  
  /**
   * Create a pull request
   */
  async createPullRequest(
    owner: string,
    repo: string,
    options: {
      title: string;
      body: string;
      head: string; // branch with changes
      base: string; // target branch (e.g., 'main')
    }
  ): Promise<{
    number: number;
    html_url: string;
    state: string;
  }> {
    const tokenData = await this.getInstallationToken();
    
    return githubRequest(
      'POST',
      `/repos/${owner}/${repo}/pulls`,
      tokenData.token,
      options
    );
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Get git credentials for a repository URL
 * Handles both GitHub App and PAT fallback
 */
export async function getGitCredentials(repoUrl: string): Promise<GitCredentials> {
  const url = new URL(repoUrl);
  const [, owner, repo] = url.pathname.split('/');
  
  // Try GitHub App first
  if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
    const app = GitHubAppAuth.fromEnv();
    return app.getGitCredentials(owner, repo?.replace(/\.git$/, ''));
  }
  
  // Fallback to PAT
  const pat = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (pat) {
    return {
      username: 'oauth2',
      password: pat,
      gitUrl: (repoUrl: string) => {
        const url = new URL(repoUrl);
        url.username = 'oauth2';
        url.password = pat;
        return url.toString();
      },
    };
  }
  
  throw new Error(
    'No GitHub credentials found. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, or GITHUB_TOKEN'
  );
}

// =============================================================================
// EXPORTS
// =============================================================================

export default GitHubAppAuth;

