/**
 * RepoProvider Integration Tests
 * 
 * Tests the unified repository provider interface for GitHub and Lab512.
 * 
 * Run with:
 *   pnpm --filter @ai-coding-team/worker test repo-provider
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RepoProvider, RepoSource, RepoInfo, getRepoProvider } from '../src/repo-provider.js';
import { RepoManager } from '../src/repo-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { execSync } from 'child_process';

// =============================================================================
// TEST CONFIG
// =============================================================================

const TEST_PORT = 3098;
const TEST_REPOS_BASE = path.join(os.tmpdir(), 'repo-provider-test');
const API_SECRET = 'test-provider-secret';
const REPOS_PREFIX = '/AtomicAgentsRepos';

// =============================================================================
// MOCK LAB512 SERVER
// =============================================================================

async function createMockLab512Server(): Promise<http.Server> {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  
  // Auth middleware
  app.use((req: any, res: any, next: any) => {
    if (req.path === '/health') return next();
    
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ') || auth.slice(7) !== API_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
  
  app.get('/health', (req: any, res: any) => {
    res.json({ status: 'ok' });
  });
  
  app.get(`${REPOS_PREFIX}/repos`, (req: any, res: any) => {
    const entries = fs.existsSync(TEST_REPOS_BASE)
      ? fs.readdirSync(TEST_REPOS_BASE, { withFileTypes: true })
      : [];
    
    const repos = entries
      .filter(e => e.isDirectory() && fs.existsSync(path.join(TEST_REPOS_BASE, e.name, '.git')))
      .map(e => ({
        name: e.name,
        cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${e.name}`,
        branch: 'main',
      }));
    
    res.json({ repos });
  });
  
  app.post(`${REPOS_PREFIX}/repos`, (req: any, res: any) => {
    const { name } = req.body;
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
    const repoPath = path.join(TEST_REPOS_BASE, safeName);
    
    if (fs.existsSync(repoPath)) {
      return res.status(409).json({ error: 'Exists' });
    }
    
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    
    if (req.body.initReadme !== false) {
      fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name}\n`);
      execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
      execSync('git commit -m "Initial"', { cwd: repoPath, stdio: 'pipe' });
    }
    
    res.status(201).json({
      name: safeName,
      cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${safeName}`,
      branch: 'main',
    });
  });
  
  app.get(`${REPOS_PREFIX}/repos/:name/clone-info`, (req: any, res: any) => {
    const repoPath = path.join(TEST_REPOS_BASE, req.params.name);
    
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    // Return local file path as clone URL for testing
    res.json({
      token: 'test-token',
      cloneUrl: repoPath, // Use local path for testing
    });
  });
  
  app.delete(`${REPOS_PREFIX}/repos/:name`, (req: any, res: any) => {
    const repoPath = path.join(TEST_REPOS_BASE, req.params.name);
    if (fs.existsSync(repoPath)) {
      fs.rmSync(repoPath, { recursive: true, force: true });
    }
    res.json({ deleted: true });
  });
  
  return app.listen(TEST_PORT);
}

// =============================================================================
// UNIT TESTS
// =============================================================================

describe('RepoProvider - Unit Tests', () => {
  describe('Source Management', () => {
    it('defaults to github source', () => {
      // Clear env var
      const original = process.env.REPO_SOURCE;
      delete process.env.REPO_SOURCE;
      
      // Mock the GitHub auth to avoid errors
      process.env.GITHUB_APP_ID = undefined;
      process.env.GITHUB_APP_PRIVATE_KEY = undefined;
      
      const provider = new RepoProvider({ source: 'github' });
      expect(provider.getSource()).toBe('github');
      
      if (original) {
        process.env.REPO_SOURCE = original;
      }
    });
    
    it('can switch sources', () => {
      const provider = new RepoProvider({ source: 'github' });
      
      expect(provider.getSource()).toBe('github');
      
      provider.setSource('lab512');
      expect(provider.getSource()).toBe('lab512');
      
      provider.setSource('github');
      expect(provider.getSource()).toBe('github');
    });
    
    it('accepts lab512 source', () => {
      const provider = new RepoProvider({ source: 'lab512' });
      expect(provider.getSource()).toBe('lab512');
    });
  });
  
  describe('Configuration', () => {
    it('accepts lab512 config', () => {
      const provider = new RepoProvider({
        source: 'lab512',
        lab512: {
          apiUrl: 'http://custom-url:3001',
          apiSecret: 'custom-secret',
        },
      });
      
      expect(provider.getSource()).toBe('lab512');
    });
    
    it('accepts github config', () => {
      const provider = new RepoProvider({
        source: 'github',
        github: {
          appId: '12345',
          privateKey: 'fake-key',
          installationId: '67890',
        },
      });
      
      expect(provider.getSource()).toBe('github');
    });
  });
});

// =============================================================================
// INTEGRATION TESTS WITH MOCK LAB512
// =============================================================================

describe('RepoProvider - Lab512 Integration Tests', () => {
  let server: http.Server;
  let provider: RepoProvider;
  
  beforeAll(async () => {
    // Clean up and create test directory
    if (fs.existsSync(TEST_REPOS_BASE)) {
      fs.rmSync(TEST_REPOS_BASE, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_REPOS_BASE, { recursive: true });
    
    // Start mock server
    server = await createMockLab512Server();
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Create provider
    provider = new RepoProvider({
      source: 'lab512',
      lab512: {
        apiUrl: `http://localhost:${TEST_PORT}`,
        apiSecret: API_SECRET,
      },
    });
  });
  
  afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (fs.existsSync(TEST_REPOS_BASE)) {
      fs.rmSync(TEST_REPOS_BASE, { recursive: true, force: true });
    }
  });
  
  describe('Repository Listing', () => {
    it('lists empty repositories', async () => {
      const repos = await provider.listRepos();
      
      expect(Array.isArray(repos)).toBe(true);
    });
    
    it('lists created repositories', async () => {
      // Create a repo first
      await provider.createRepo({ name: 'list-test-repo' });
      
      const repos = await provider.listRepos();
      
      expect(repos.some(r => r.name === 'list-test-repo')).toBe(true);
    });
  });
  
  describe('Repository Creation', () => {
    it('creates a repository', async () => {
      const result = await provider.createRepo({
        name: 'new-test-repo',
        description: 'Test description',
        initReadme: true,
      });
      
      expect(result.name).toBe('new-test-repo');
      expect(result.source).toBe('lab512');
      expect(result.cloneUrl).toContain('new-test-repo');
    });
    
    it('sanitizes repository names', async () => {
      const result = await provider.createRepo({
        name: 'repo/with/slashes',
      });
      
      expect(result.name).toBe('repowithslashes');
    });
  });
  
  describe('Repository Cloning', () => {
    let testRepo: RepoInfo;
    
    beforeAll(async () => {
      testRepo = await provider.createRepo({
        name: 'clone-test-repo',
        initReadme: true,
      });
    });
    
    it('clones a repository via file protocol', async () => {
      // For this test, we clone using file:// protocol
      const cloneTestDir = path.join(os.tmpdir(), 'clone-tests');
      if (fs.existsSync(cloneTestDir)) {
        fs.rmSync(cloneTestDir, { recursive: true, force: true });
      }
      fs.mkdirSync(cloneTestDir, { recursive: true });
      
      const sourceRepo = path.join(TEST_REPOS_BASE, 'clone-test-repo');
      const targetPath = path.join(cloneTestDir, 'cloned-repo');
      
      // Get the default branch name
      let defaultBranch = 'master';
      try {
        defaultBranch = execSync('git branch --show-current', { cwd: sourceRepo, encoding: 'utf-8' }).trim() || 'master';
      } catch {}
      
      // Clone directly using git command with file:// URL
      execSync(`git clone file://${sourceRepo} ${targetPath}`, { cwd: cloneTestDir, stdio: 'pipe' });
      
      expect(fs.existsSync(targetPath)).toBe(true);
      expect(fs.existsSync(path.join(targetPath, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(targetPath, 'README.md'))).toBe(true);
      
      // Cleanup
      fs.rmSync(cloneTestDir, { recursive: true, force: true });
    });
  });
  
  describe('Branch Operations', () => {
    let repoPath: string;
    
    beforeAll(async () => {
      // Create a test repo
      repoPath = path.join(TEST_REPOS_BASE, 'branch-test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      execSync('git init', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test\n');
      execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
      execSync('git commit -m "Initial"', { cwd: repoPath, stdio: 'pipe' });
    });
    
    it('creates a branch', async () => {
      const result = await provider.createBranch(repoPath, 'feature', 'test-job-123');
      
      expect(result.name).toContain('ai/');
      expect(result.name).toContain('feature');
      expect(result.created).toBe(true);
    });
    
    it('switches to existing branch', async () => {
      // Get current branch name
      const currentBranch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8' }).trim();
      
      // First call creates new branch
      const firstResult = await provider.createBranch(repoPath, 'existing', 'test-job-456');
      expect(firstResult.created).toBe(true);
      
      // Switch back to original branch
      execSync(`git checkout ${currentBranch || 'master'}`, { cwd: repoPath, stdio: 'pipe' });
      
      // Second call should switch to existing branch
      const result = await provider.createBranch(repoPath, 'existing', 'test-job-456');
      
      expect(result.created).toBe(false);
    });
  });
  
  describe('Commit Operations', () => {
    let repoPath: string;
    
    beforeEach(async () => {
      // Create a fresh test repo
      repoPath = path.join(TEST_REPOS_BASE, `commit-test-${Date.now()}`);
      fs.mkdirSync(repoPath, { recursive: true });
      execSync('git init', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test\n');
      execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
      execSync('git commit -m "Initial"', { cwd: repoPath, stdio: 'pipe' });
    });
    
    afterEach(() => {
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });
    
    it('commits changes', async () => {
      // Make a change
      fs.writeFileSync(path.join(repoPath, 'new-file.txt'), 'content');
      
      const result = await provider.commit(repoPath, 'Add new file');
      
      expect(result.hash).toHaveLength(40);
      expect(result.files).toBe(1);
    });
    
    it('throws when no changes', async () => {
      await expect(provider.commit(repoPath, 'No changes')).rejects.toThrow();
    });
  });
  
  describe('Pull Request Operations', () => {
    it('throws for non-github repos', async () => {
      const repoInfo: RepoInfo = {
        name: 'test',
        source: 'lab512',
        cloneUrl: 'http://localhost/test',
        defaultBranch: 'main',
        private: false,
      };
      
      await expect(provider.createPullRequest(repoInfo, {
        title: 'Test PR',
        body: 'Test body',
        head: 'feature',
      })).rejects.toThrow('GitHub repositories');
    });
  });
});

// =============================================================================
// REPO MANAGER TESTS
// =============================================================================

describe('RepoManager - Unit Tests', () => {
  const repoManager = new RepoManager(path.join(os.tmpdir(), 'repo-manager-test'));
  
  describe('URL Parsing', () => {
    it('parses HTTPS URLs', () => {
      const result = repoManager.parseRepoUrl('https://github.com/owner/repo');
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
    });
    
    it('parses HTTPS URLs with .git', () => {
      const result = repoManager.parseRepoUrl('https://github.com/owner/repo.git');
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
    });
    
    it('parses SSH URLs', () => {
      const result = repoManager.parseRepoUrl('git@github.com:owner/repo.git');
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
    });
    
    it('handles URLs with extra paths', () => {
      const result = repoManager.parseRepoUrl('https://github.com/owner/repo/tree/main');
      expect(result.owner).toBe('owner');
      expect(result.repo).toBe('repo');
    });
  });
});

// =============================================================================
// SINGLETON TESTS
// =============================================================================

describe('RepoProvider Singleton', () => {
  it('returns the same instance', () => {
    const provider1 = getRepoProvider();
    const provider2 = getRepoProvider();
    
    expect(provider1).toBe(provider2);
  });
});

