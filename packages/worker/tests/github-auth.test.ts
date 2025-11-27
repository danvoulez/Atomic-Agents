/**
 * GitHub Authentication Tests
 * 
 * Run with: pnpm --filter @ai-coding-team/worker test:github
 * 
 * Requires environment variables:
 * - GITHUB_APP_ID
 * - GITHUB_APP_PRIVATE_KEY
 * - GITHUB_APP_INSTALLATION_ID (optional, will be auto-detected)
 * 
 * Or for PAT fallback:
 * - GITHUB_TOKEN
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { GitHubAppAuth, getGitCredentials } from '../src/github-auth.js';
import { RepoManager } from '../src/repo-manager.js';
import * as fs from 'fs';
import * as path from 'path';

// Skip if no credentials
const hasGitHubApp = process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY;
const hasGitHubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const hasCredentials = hasGitHubApp || hasGitHubToken;

describe.skipIf(!hasCredentials)('GitHub Authentication', () => {
  const testRepoUrl = 'https://github.com/danvoulez/Atomic-Agents';
  
  describe('GitHub App Auth', () => {
    it.skipIf(!hasGitHubApp)('generates valid JWT', () => {
      const app = GitHubAppAuth.fromEnv();
      const jwt = app.getJWT();
      
      // JWT should have 3 parts
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
      
      // Decode header
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');
      
      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      expect(payload.iss).toBe(process.env.GITHUB_APP_ID);
      expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    });
    
    it.skipIf(!hasGitHubApp)('lists installations', async () => {
      const app = GitHubAppAuth.fromEnv();
      const installations = await app.listInstallations();
      
      expect(Array.isArray(installations)).toBe(true);
      expect(installations.length).toBeGreaterThan(0);
      
      const firstInstall = installations[0];
      expect(firstInstall.id).toBeGreaterThan(0);
      expect(firstInstall.account.login).toBeTruthy();
    });
    
    it.skipIf(!hasGitHubApp)('gets installation token', async () => {
      const app = GitHubAppAuth.fromEnv();
      const token = await app.getInstallationToken();
      
      expect(token.token).toBeTruthy();
      expect(token.token.startsWith('ghs_')).toBe(true);
      expect(token.expiresAt).toBeInstanceOf(Date);
      expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
    
    it.skipIf(!hasGitHubApp)('caches installation token', async () => {
      const app = GitHubAppAuth.fromEnv();
      
      const token1 = await app.getInstallationToken();
      const token2 = await app.getInstallationToken();
      
      // Should be the same token (cached)
      expect(token2.token).toBe(token1.token);
    });
  });
  
  describe('Git Credentials', () => {
    it('gets credentials for repo', async () => {
      const creds = await getGitCredentials(testRepoUrl);
      
      expect(creds.username).toBeTruthy();
      expect(creds.password).toBeTruthy();
      expect(typeof creds.gitUrl).toBe('function');
      
      // gitUrl should return authenticated URL
      const authUrl = creds.gitUrl(testRepoUrl);
      expect(authUrl).toContain(creds.password);
    });
  });
  
  describe('RepoManager', () => {
    let repoManager: RepoManager;
    let clonedPath: string | null = null;
    
    beforeAll(() => {
      repoManager = new RepoManager('/tmp/test-repos');
    });
    
    it('parses repo URL correctly', () => {
      const result1 = repoManager.parseRepoUrl('https://github.com/danvoulez/Atomic-Agents');
      expect(result1.owner).toBe('danvoulez');
      expect(result1.repo).toBe('Atomic-Agents');
      
      const result2 = repoManager.parseRepoUrl('https://github.com/danvoulez/Atomic-Agents.git');
      expect(result2.owner).toBe('danvoulez');
      expect(result2.repo).toBe('Atomic-Agents');
      
      const result3 = repoManager.parseRepoUrl('git@github.com:danvoulez/Atomic-Agents.git');
      expect(result3.owner).toBe('danvoulez');
      expect(result3.repo).toBe('Atomic-Agents');
    });
    
    it('clones repository', async () => {
      const jobId = `test-${Date.now()}`;
      
      const result = await repoManager.clone(jobId, {
        url: testRepoUrl,
        branch: 'main',
      });
      
      clonedPath = result.path;
      
      expect(fs.existsSync(result.path)).toBe(true);
      expect(result.branch).toBe('main');
      expect(result.commit).toHaveLength(40); // SHA
      expect(result.remote).toBe(testRepoUrl);
      
      // Check .git exists
      expect(fs.existsSync(path.join(result.path, '.git'))).toBe(true);
    });
    
    it('creates branch', async () => {
      if (!clonedPath) {
        throw new Error('Clone test must run first');
      }
      
      const result = await repoManager.createBranch(
        clonedPath,
        'test-branch',
        'test-job-id'
      );
      
      expect(result.name).toContain('ai/test-job');
      expect(result.name).toContain('test-branch');
      expect(result.created).toBe(true);
      expect(result.basedOn).toBe('main');
    });
    
    it('cleans up repository', async () => {
      if (!clonedPath) {
        throw new Error('Clone test must run first');
      }
      
      await repoManager.cleanup(clonedPath);
      
      expect(fs.existsSync(clonedPath)).toBe(false);
      clonedPath = null;
    });
  });
});

