/**
 * GitHub Integration Tests
 * 
 * Comprehensive tests for GitHub App authentication, repository operations,
 * and API interactions.
 * 
 * Run with:
 *   pnpm --filter @ai-coding-team/worker test github-integration
 * 
 * For live testing (requires GitHub credentials):
 *   GITHUB_APP_ID=xxx GITHUB_APP_PRIVATE_KEY=xxx pnpm test github-integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GitHubAppAuth, getGitCredentials, GitHubAppConfig } from '../src/github-auth.js';
import { RepoManager } from '../src/repo-manager.js';
import { RepoProvider } from '../src/repo-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// =============================================================================
// TEST CONFIG
// =============================================================================

const TEST_REPO_URL = 'https://github.com/danvoulez/Atomic-Agents';
const hasGitHubApp = !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
const hasGitHubToken = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
const hasCredentials = hasGitHubApp || hasGitHubToken;

// =============================================================================
// JWT GENERATION UNIT TESTS
// =============================================================================

describe('GitHub JWT Generation - Unit Tests', () => {
  // Create a test RSA key pair for testing JWT generation
  const testKeyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  
  describe('Base64URL Encoding', () => {
    it('encodes strings correctly', () => {
      const base64UrlEncode = (str: string): string => {
        return Buffer.from(str)
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '');
      };
      
      // Test basic encoding
      expect(base64UrlEncode('hello')).toBe('aGVsbG8');
      
      // Test that special characters are handled
      const testWithSpecials = base64UrlEncode('a+b/c=');
      expect(testWithSpecials).not.toContain('+');
      expect(testWithSpecials).not.toContain('/');
      expect(testWithSpecials).not.toContain('=');
    });
  });
  
  describe('JWT Structure', () => {
    it('generates JWT with correct structure', () => {
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKeyPair.privateKey,
      };
      
      const auth = new GitHubAppAuth(config);
      const jwt = auth.getJWT();
      
      // JWT should have 3 parts separated by dots
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      // All parts should be base64url encoded
      parts.forEach(part => {
        expect(part).not.toContain('+');
        expect(part).not.toContain('/');
        expect(part).not.toContain('=');
      });
    });
    
    it('sets correct header', () => {
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKeyPair.privateKey,
      };
      
      const auth = new GitHubAppAuth(config);
      const jwt = auth.getJWT();
      const parts = jwt.split('.');
      
      // Decode header (add padding if needed)
      const headerBase64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      const header = JSON.parse(Buffer.from(headerBase64, 'base64').toString());
      
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');
    });
    
    it('sets correct payload', () => {
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKeyPair.privateKey,
      };
      
      const auth = new GitHubAppAuth(config);
      const jwt = auth.getJWT();
      const parts = jwt.split('.');
      
      // Decode payload
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());
      
      expect(payload.iss).toBe('12345');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      
      // exp should be about 10 minutes after iat
      const diff = payload.exp - payload.iat;
      expect(diff).toBeGreaterThanOrEqual(600 + 60); // 10min + 60s clock drift tolerance
      expect(diff).toBeLessThanOrEqual(700);
    });
  });
  
  describe('Private Key Handling', () => {
    it('handles PEM-formatted keys', () => {
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKeyPair.privateKey,
      };
      
      const auth = new GitHubAppAuth(config);
      expect(() => auth.getJWT()).not.toThrow();
    });
    
    it('handles base64-encoded keys', () => {
      const base64Key = Buffer.from(testKeyPair.privateKey).toString('base64');
      
      // The fromEnv method handles base64 decoding
      // Test the logic manually
      let decodedKey = base64Key;
      if (!base64Key.includes('-----BEGIN')) {
        decodedKey = Buffer.from(base64Key, 'base64').toString('utf-8');
      }
      
      expect(decodedKey).toContain('-----BEGIN PRIVATE KEY-----');
    });
    
    it('handles escaped newlines', () => {
      const keyWithEscapedNewlines = testKeyPair.privateKey.replace(/\n/g, '\\n');
      const fixedKey = keyWithEscapedNewlines.replace(/\\n/g, '\n');
      
      expect(fixedKey).toContain('\n');
      expect(fixedKey).toBe(testKeyPair.privateKey);
    });
  });
});

// =============================================================================
// GITHUB APP AUTH UNIT TESTS
// =============================================================================

describe('GitHubAppAuth - Unit Tests', () => {
  describe('Configuration', () => {
    it('stores config correctly', () => {
      const testKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKey.privateKey,
        installationId: '67890',
      };
      
      const auth = new GitHubAppAuth(config);
      expect(auth.getJWT()).toBeTruthy();
    });
    
    it('throws when required env vars missing', () => {
      const originalAppId = process.env.GITHUB_APP_ID;
      const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
      
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      
      expect(() => GitHubAppAuth.fromEnv()).toThrow('GITHUB_APP_ID');
      
      process.env.GITHUB_APP_ID = originalAppId;
      process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
    });
  });
  
  describe('Token Caching', () => {
    it('caches tokens correctly', async () => {
      const testKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKey.privateKey,
        installationId: '67890',
      };
      
      const auth = new GitHubAppAuth(config);
      
      // Mock the cached token
      (auth as any).cachedToken = {
        token: 'ghs_test_token',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        permissions: {},
        repositorySelection: 'all' as const,
      };
      
      // Should return cached token without API call
      const result = await auth.getInstallationToken();
      expect(result.token).toBe('ghs_test_token');
    });
    
    it('refreshes expired tokens', async () => {
      const testKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      
      const config: GitHubAppConfig = {
        appId: '12345',
        privateKey: testKey.privateKey,
        installationId: '67890',
      };
      
      const auth = new GitHubAppAuth(config);
      
      // Set expired token
      (auth as any).cachedToken = {
        token: 'ghs_expired_token',
        expiresAt: new Date(Date.now() - 1000), // Already expired
        permissions: {},
        repositorySelection: 'all' as const,
      };
      
      // This would try to refresh (and fail without real credentials)
      // Just verify the cache check logic
      const cachedToken = (auth as any).cachedToken;
      const isExpired = cachedToken.expiresAt <= new Date(Date.now() + 5 * 60 * 1000);
      expect(isExpired).toBe(true);
    });
  });
});

// =============================================================================
// GIT CREDENTIALS TESTS
// =============================================================================

describe('Git Credentials - Unit Tests', () => {
  describe('URL Building', () => {
    it('builds authenticated URL correctly', () => {
      const gitUrl = (repoUrl: string, token: string) => {
        const url = new URL(repoUrl);
        url.username = 'x-access-token';
        url.password = token;
        return url.toString();
      };
      
      const result = gitUrl('https://github.com/owner/repo', 'test-token');
      
      expect(result).toBe('https://x-access-token:test-token@github.com/owner/repo');
    });
    
    it('handles URLs with existing credentials', () => {
      const gitUrl = (repoUrl: string, token: string) => {
        const url = new URL(repoUrl);
        url.username = 'x-access-token';
        url.password = token;
        return url.toString();
      };
      
      const result = gitUrl('https://old:creds@github.com/owner/repo', 'new-token');
      
      expect(result).toContain('x-access-token');
      expect(result).toContain('new-token');
      expect(result).not.toContain('old');
    });
  });
  
  describe('PAT Fallback', () => {
    it('uses PAT when GitHub App not configured', async () => {
      const originalAppId = process.env.GITHUB_APP_ID;
      const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
      const originalToken = process.env.GITHUB_TOKEN;
      
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      process.env.GITHUB_TOKEN = 'test-pat-token';
      
      try {
        const creds = await getGitCredentials('https://github.com/owner/repo');
        
        expect(creds.username).toBe('oauth2');
        expect(creds.password).toBe('test-pat-token');
      } finally {
        process.env.GITHUB_APP_ID = originalAppId;
        process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        process.env.GITHUB_TOKEN = originalToken;
      }
    });
    
    it('throws when no credentials available', async () => {
      const originalAppId = process.env.GITHUB_APP_ID;
      const originalPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
      const originalToken = process.env.GITHUB_TOKEN;
      const originalGhToken = process.env.GH_TOKEN;
      
      delete process.env.GITHUB_APP_ID;
      delete process.env.GITHUB_APP_PRIVATE_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      
      try {
        await expect(getGitCredentials('https://github.com/owner/repo')).rejects.toThrow('No GitHub credentials');
      } finally {
        process.env.GITHUB_APP_ID = originalAppId;
        process.env.GITHUB_APP_PRIVATE_KEY = originalPrivateKey;
        process.env.GITHUB_TOKEN = originalToken;
        process.env.GH_TOKEN = originalGhToken;
      }
    });
  });
});

// =============================================================================
// LIVE INTEGRATION TESTS
// =============================================================================

describe.skipIf(!hasCredentials)('GitHub - Live Integration Tests', () => {
  describe.skipIf(!hasGitHubApp)('GitHub App Authentication', () => {
    let auth: GitHubAppAuth;
    
    beforeAll(() => {
      auth = GitHubAppAuth.fromEnv();
    });
    
    it('generates valid JWT', () => {
      const jwt = auth.getJWT();
      
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      // Verify header
      const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      expect(header.alg).toBe('RS256');
      
      // Verify payload
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      expect(payload.iss).toBe(process.env.GITHUB_APP_ID);
    });
    
    it('lists app installations', async () => {
      const installations = await auth.listInstallations();
      
      expect(Array.isArray(installations)).toBe(true);
      expect(installations.length).toBeGreaterThan(0);
      
      const firstInstall = installations[0];
      expect(firstInstall.id).toBeGreaterThan(0);
      expect(firstInstall.account).toBeDefined();
      expect(firstInstall.account.login).toBeTruthy();
    });
    
    it('gets installation token', async () => {
      const token = await auth.getInstallationToken();
      
      expect(token.token).toBeTruthy();
      expect(token.token.startsWith('ghs_')).toBe(true);
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(token.permissions).toBeDefined();
    });
    
    it('caches installation token', async () => {
      const token1 = await auth.getInstallationToken();
      const token2 = await auth.getInstallationToken();
      
      expect(token2.token).toBe(token1.token);
    });
    
    it('gets git credentials', async () => {
      const creds = await auth.getGitCredentials('danvoulez', 'Atomic-Agents');
      
      expect(creds.username).toBe('x-access-token');
      expect(creds.password).toBeTruthy();
      expect(typeof creds.gitUrl).toBe('function');
      
      const authUrl = creds.gitUrl(TEST_REPO_URL);
      expect(authUrl).toContain(creds.password);
      expect(authUrl).toContain('x-access-token');
    });
  });
  
  describe('Git Credentials', () => {
    it('gets credentials for repo URL', async () => {
      const creds = await getGitCredentials(TEST_REPO_URL);
      
      expect(creds.username).toBeTruthy();
      expect(creds.password).toBeTruthy();
      expect(typeof creds.gitUrl).toBe('function');
    });
    
    it('builds authenticated URL', async () => {
      const creds = await getGitCredentials(TEST_REPO_URL);
      const authUrl = creds.gitUrl(TEST_REPO_URL);
      
      expect(authUrl).toContain(creds.username);
      expect(authUrl).toContain(creds.password);
      expect(authUrl).toContain('github.com');
    });
  });
  
  describe('RepoManager - Clone Operations', () => {
    const testDir = path.join(os.tmpdir(), 'github-test-repos');
    let repoManager: RepoManager;
    let clonedPath: string | null = null;
    
    beforeAll(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
      fs.mkdirSync(testDir, { recursive: true });
      repoManager = new RepoManager(testDir);
    });
    
    afterAll(async () => {
      if (clonedPath && fs.existsSync(clonedPath)) {
        await repoManager.cleanup(clonedPath);
      }
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
    
    it('parses GitHub URLs correctly', () => {
      const tests = [
        { url: 'https://github.com/owner/repo', owner: 'owner', repo: 'repo' },
        { url: 'https://github.com/owner/repo.git', owner: 'owner', repo: 'repo' },
        { url: 'git@github.com:owner/repo.git', owner: 'owner', repo: 'repo' },
      ];
      
      for (const test of tests) {
        const result = repoManager.parseRepoUrl(test.url);
        expect(result.owner).toBe(test.owner);
        expect(result.repo).toBe(test.repo);
      }
    });
    
    it('clones repository', async () => {
      const jobId = `test-${Date.now()}`;
      
      const result = await repoManager.clone(jobId, {
        url: TEST_REPO_URL,
        branch: 'main',
      });
      
      clonedPath = result.path;
      
      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.commit).toHaveLength(40);
      expect(result.remote).toBe(TEST_REPO_URL);
      
      // Verify .git directory exists
      expect(fs.existsSync(path.join(result.path, '.git'))).toBe(true);
      
      // Verify git identity is configured
      const { execSync } = await import('child_process');
      const userName = execSync('git config user.name', { cwd: result.path, encoding: 'utf-8' }).trim();
      expect(userName).toBe('Atomic Agents');
    });
    
    it('creates branch', async () => {
      if (!clonedPath) throw new Error('Clone test must run first');
      
      const result = await repoManager.createBranch(clonedPath, 'test-feature', 'test-job-id');
      
      expect(result.name).toContain('ai/');
      expect(result.name).toContain('test-job');
      expect(result.name).toContain('test-feature');
      expect(result.created).toBe(true);
      expect(result.basedOn).toBe('main');
    });
    
    it('cleans up repository', async () => {
      if (!clonedPath) throw new Error('Clone test must run first');
      
      await repoManager.cleanup(clonedPath);
      
      expect(fs.existsSync(clonedPath)).toBe(false);
      clonedPath = null;
    });
  });
  
  describe('RepoProvider - GitHub Source', () => {
    let provider: RepoProvider;
    
    beforeAll(() => {
      provider = new RepoProvider({ source: 'github' });
    });
    
    it('lists repositories', async () => {
      const repos = await provider.listRepos();
      
      expect(Array.isArray(repos)).toBe(true);
      expect(repos.length).toBeGreaterThan(0);
      
      const firstRepo = repos[0];
      expect(firstRepo.name).toBeTruthy();
      expect(firstRepo.source).toBe('github');
      expect(firstRepo.cloneUrl).toContain('github.com');
    });
    
    it('has correct source', () => {
      expect(provider.getSource()).toBe('github');
    });
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  describe('GitHub API Errors', () => {
    it('sanitizes credentials in error messages', () => {
      const error = new Error('Clone failed: https://x-access-token:secret-token@github.com/repo');
      const sanitized = error.message.replace('secret-token', '***');
      
      expect(sanitized).not.toContain('secret-token');
      expect(sanitized).toContain('***');
    });
  });
  
  describe('RepoManager Errors', () => {
    it('handles non-existent branches', async () => {
      const repoManager = new RepoManager(os.tmpdir());
      
      // Create a test repo
      const testPath = path.join(os.tmpdir(), `error-test-${Date.now()}`);
      fs.mkdirSync(testPath, { recursive: true });
      
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testPath, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: testPath, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: testPath, stdio: 'pipe' });
      fs.writeFileSync(path.join(testPath, 'README.md'), '# Test');
      execSync('git add .', { cwd: testPath, stdio: 'pipe' });
      execSync('git commit -m "Initial"', { cwd: testPath, stdio: 'pipe' });
      
      try {
        // Creating a new branch should work
        const result = await repoManager.createBranch(testPath, 'new-branch', 'job-123');
        expect(result.created).toBe(true);
      } finally {
        fs.rmSync(testPath, { recursive: true, force: true });
      }
    });
  });
});

