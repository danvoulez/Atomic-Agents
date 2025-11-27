/**
 * Lab512 Server Integration Tests
 * 
 * Tests the Lab512 local git server API.
 * 
 * Run with:
 *   pnpm --filter @ai-coding-team/lab512-server test
 * 
 * For live testing (with server running):
 *   LAB512_LIVE_TEST=true pnpm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// =============================================================================
// CONFIG
// =============================================================================

const API_SECRET = 'test-secret-12345';
const TEST_PORT = 3099;
const TEST_REPOS_BASE = path.join(os.tmpdir(), 'lab512-test-repos');
const BASE_URL = `http://localhost:${TEST_PORT}`;
const REPOS_PREFIX = '/AtomicAgentsRepos';

// =============================================================================
// TEST HELPERS
// =============================================================================

async function request<T = any>(
  method: string,
  path: string,
  body?: object,
  auth = true
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth ? { 'Authorization': `Bearer ${API_SECRET}` } : {}),
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed: T;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data as unknown as T;
        }
        resolve({ status: res.statusCode || 0, data: parsed });
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

function setupTestRepo(name: string): string {
  const repoPath = path.join(TEST_REPOS_BASE, name);
  fs.mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });
  return repoPath;
}

function cleanupTestRepos(): void {
  if (fs.existsSync(TEST_REPOS_BASE)) {
    fs.rmSync(TEST_REPOS_BASE, { recursive: true, force: true });
  }
}

// =============================================================================
// UNIT TESTS (no server needed)
// =============================================================================

describe('Lab512 Server - Unit Tests', () => {
  describe('Repo Path Sanitization', () => {
    it('sanitizes repo names correctly', () => {
      // This is the sanitization logic from the server
      const sanitize = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, '');
      
      expect(sanitize('my-repo')).toBe('my-repo');
      expect(sanitize('my_repo')).toBe('my_repo');
      expect(sanitize('repo123')).toBe('repo123');
      expect(sanitize('repo/with/slashes')).toBe('repowithslashes');
      expect(sanitize('../../../etc/passwd')).toBe('etcpasswd');
      expect(sanitize('repo with spaces')).toBe('repowithspaces');
      expect(sanitize('repo.with.dots')).toBe('repowithdots');
    });
  });
  
  describe('Token Generation', () => {
    it('generates consistent tokens for same input', async () => {
      const crypto = await import('crypto');
      const secret = 'test-secret';
      const repoName = 'test-repo';
      const hour = Math.floor(Date.now() / 3600000);
      
      const token1 = crypto.createHmac('sha256', secret)
        .update(`${repoName}:${hour}`)
        .digest('hex')
        .slice(0, 32);
      
      const token2 = crypto.createHmac('sha256', secret)
        .update(`${repoName}:${hour}`)
        .digest('hex')
        .slice(0, 32);
      
      expect(token1).toBe(token2);
      expect(token1).toHaveLength(32);
    });
    
    it('generates different tokens for different repos', async () => {
      const crypto = await import('crypto');
      const secret = 'test-secret';
      const hour = Math.floor(Date.now() / 3600000);
      
      const token1 = crypto.createHmac('sha256', secret)
        .update(`repo1:${hour}`)
        .digest('hex')
        .slice(0, 32);
      
      const token2 = crypto.createHmac('sha256', secret)
        .update(`repo2:${hour}`)
        .digest('hex')
        .slice(0, 32);
      
      expect(token1).not.toBe(token2);
    });
  });
});

// =============================================================================
// INTEGRATION TESTS (require server or mock)
// =============================================================================

// Check if we should run live tests
const isLiveTest = process.env.LAB512_LIVE_TEST === 'true';
const liveUrl = process.env.LAB512_API_URL || 'http://localhost:3001';
const liveSecret = process.env.LAB512_API_SECRET;

describe.skipIf(!isLiveTest)('Lab512 Server - Live Integration Tests', () => {
  // Override request for live testing
  const liveRequest = async <T = any>(
    method: string,
    path: string,
    body?: object
  ): Promise<{ status: number; data: T }> => {
    return new Promise((resolve, reject) => {
      const url = new URL(path, liveUrl);
      
      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 80,
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${liveSecret}`,
        },
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let parsed: T;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data as unknown as T;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      });
      
      req.on('error', reject);
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  };
  
  describe('Health Check', () => {
    it('returns server status', async () => {
      const { status, data } = await liveRequest('GET', '/health');
      
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
      expect(data.server).toBe('lab512');
      expect(data.timestamp).toBeDefined();
    });
  });
  
  describe('Repository CRUD', () => {
    const testRepoName = `test-repo-${Date.now()}`;
    
    it('lists repositories', async () => {
      const { status, data } = await liveRequest('GET', `${REPOS_PREFIX}/repos`);
      
      expect(status).toBe(200);
      expect(Array.isArray(data.repos)).toBe(true);
      expect(typeof data.count).toBe('number');
    });
    
    it('creates a repository', async () => {
      const { status, data } = await liveRequest('POST', `${REPOS_PREFIX}/repos`, {
        name: testRepoName,
        description: 'Test repository',
        initReadme: true,
      });
      
      expect(status).toBe(201);
      expect(data.name).toBe(testRepoName);
      expect(data.created).toBe(true);
      expect(data.cloneUrl).toContain(testRepoName);
    });
    
    it('gets repository info', async () => {
      const { status, data } = await liveRequest('GET', `${REPOS_PREFIX}/repos/${testRepoName}`);
      
      expect(status).toBe(200);
      expect(data.name).toBe(testRepoName);
      expect(data.branch).toBeDefined();
      expect(data.lastCommit).toBeDefined();
    });
    
    it('gets clone info with token', async () => {
      const { status, data } = await liveRequest('GET', `${REPOS_PREFIX}/repos/${testRepoName}/clone-info`);
      
      expect(status).toBe(200);
      expect(data.token).toBeDefined();
      expect(data.token).toHaveLength(32);
      expect(data.cloneUrl).toContain(testRepoName);
      expect(data.instructions).toBeDefined();
    });
    
    it('prevents duplicate repository creation', async () => {
      const { status } = await liveRequest('POST', `${REPOS_PREFIX}/repos`, {
        name: testRepoName,
      });
      
      expect(status).toBe(409);
    });
    
    it('deletes the repository', async () => {
      const { status, data } = await liveRequest('DELETE', `${REPOS_PREFIX}/repos/${testRepoName}`);
      
      expect(status).toBe(200);
      expect(data.deleted).toBe(true);
    });
    
    it('returns 404 for deleted repository', async () => {
      const { status } = await liveRequest('GET', `${REPOS_PREFIX}/repos/${testRepoName}`);
      expect(status).toBe(404);
    });
  });
  
  describe('Authentication', () => {
    it('rejects requests without auth header', async () => {
      const { status } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
        const url = new URL(`${REPOS_PREFIX}/repos`, liveUrl);
        
        const req = http.request({
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'GET',
          // No auth header
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode || 0, data }));
        });
        
        req.on('error', reject);
        req.end();
      });
      
      expect(status).toBe(401);
    });
    
    it('rejects requests with invalid token', async () => {
      const { status } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
        const url = new URL(`${REPOS_PREFIX}/repos`, liveUrl);
        
        const req = http.request({
          hostname: url.hostname,
          port: url.port || 80,
          path: url.pathname,
          method: 'GET',
          headers: {
            'Authorization': 'Bearer invalid-token',
          },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode || 0, data }));
        });
        
        req.on('error', reject);
        req.end();
      });
      
      expect(status).toBe(403);
    });
  });
});

// =============================================================================
// MOCK SERVER TESTS
// =============================================================================

describe('Lab512 Server - Mock Tests', () => {
  let server: http.Server;
  let app: any;
  
  beforeAll(async () => {
    // Clean and setup test repos directory
    cleanupTestRepos();
    fs.mkdirSync(TEST_REPOS_BASE, { recursive: true });
    
    // Set environment variables for the test server
    process.env.LAB512_PORT = String(TEST_PORT);
    process.env.LAB512_REPOS_PATH = TEST_REPOS_BASE;
    process.env.LAB512_API_SECRET = API_SECRET;
    process.env.LAB512_PROJECT_BASE = TEST_REPOS_BASE;
    
    // Create a simple mock server that mimics the Lab512 API
    const express = (await import('express')).default;
    app = express();
    app.use(express.json());
    
    // Auth middleware
    app.use((req: any, res: any, next: any) => {
      if (req.path === '/health') return next();
      
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing auth' });
      }
      if (auth.slice(7) !== API_SECRET) {
        return res.status(403).json({ error: 'Invalid token' });
      }
      next();
    });
    
    // Health
    app.get('/health', (req: any, res: any) => {
      res.json({ status: 'ok', server: 'lab512-mock' });
    });
    
    // List repos
    app.get(`${REPOS_PREFIX}/repos`, (req: any, res: any) => {
      const entries = fs.existsSync(TEST_REPOS_BASE) 
        ? fs.readdirSync(TEST_REPOS_BASE, { withFileTypes: true })
        : [];
      
      const repos = entries
        .filter(e => e.isDirectory() && fs.existsSync(path.join(TEST_REPOS_BASE, e.name, '.git')))
        .map(e => ({
          name: e.name,
          cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${e.name}`,
        }));
      
      res.json({ repos, count: repos.length });
    });
    
    // Create repo
    app.post(`${REPOS_PREFIX}/repos`, (req: any, res: any) => {
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: 'Name required' });
      
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
      const repoPath = path.join(TEST_REPOS_BASE, safeName);
      
      if (fs.existsSync(repoPath)) {
        return res.status(409).json({ error: 'Already exists' });
      }
      
      fs.mkdirSync(repoPath, { recursive: true });
      execSync('git init', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
      
      if (req.body.initReadme !== false) {
        fs.writeFileSync(path.join(repoPath, 'README.md'), `# ${name}\n`);
        execSync('git add .', { cwd: repoPath, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: repoPath, stdio: 'pipe' });
      }
      
      res.status(201).json({
        name: safeName,
        created: true,
        cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${safeName}`,
      });
    });
    
    // Get repo
    app.get(`${REPOS_PREFIX}/repos/:name`, (req: any, res: any) => {
      const repoPath = path.join(TEST_REPOS_BASE, req.params.name);
      
      if (!fs.existsSync(repoPath)) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      let branch = 'main';
      try {
        branch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8' }).trim() || 'main';
      } catch {}
      
      res.json({
        name: req.params.name,
        branch,
        cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${req.params.name}`,
      });
    });
    
    // Clone info
    app.get(`${REPOS_PREFIX}/repos/:name/clone-info`, (req: any, res: any) => {
      const repoPath = path.join(TEST_REPOS_BASE, req.params.name);
      
      if (!fs.existsSync(repoPath)) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      const crypto = require('crypto');
      const token = crypto.createHmac('sha256', API_SECRET)
        .update(`${req.params.name}:${Math.floor(Date.now() / 3600000)}`)
        .digest('hex')
        .slice(0, 32);
      
      res.json({
        name: req.params.name,
        token,
        cloneUrl: `http://localhost:${TEST_PORT}${REPOS_PREFIX}/git/${req.params.name}`,
      });
    });
    
    // Delete repo
    app.delete(`${REPOS_PREFIX}/repos/:name`, (req: any, res: any) => {
      const repoPath = path.join(TEST_REPOS_BASE, req.params.name);
      
      if (!fs.existsSync(repoPath)) {
        return res.status(404).json({ error: 'Not found' });
      }
      
      fs.rmSync(repoPath, { recursive: true, force: true });
      res.json({ deleted: true, name: req.params.name });
    });
    
    // Start server
    server = app.listen(TEST_PORT);
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    cleanupTestRepos();
  });
  
  describe('Health Check', () => {
    it('returns ok status', async () => {
      const { status, data } = await request('GET', '/health', undefined, false);
      
      expect(status).toBe(200);
      expect(data.status).toBe('ok');
    });
  });
  
  describe('Authentication', () => {
    it('allows requests with valid token', async () => {
      const { status } = await request('GET', `${REPOS_PREFIX}/repos`);
      expect(status).toBe(200);
    });
    
    it('rejects requests without token', async () => {
      const { status } = await request('GET', `${REPOS_PREFIX}/repos`, undefined, false);
      expect(status).toBe(401);
    });
    
    it('rejects requests with invalid token', async () => {
      const { status } = await new Promise<{ status: number; data: any }>((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: TEST_PORT,
          path: `${REPOS_PREFIX}/repos`,
          method: 'GET',
          headers: { 'Authorization': 'Bearer wrong-token' },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode || 0, data }));
        });
        req.on('error', reject);
        req.end();
      });
      
      expect(status).toBe(403);
    });
  });
  
  describe('Repository Operations', () => {
    const testRepoName = 'mock-test-repo';
    
    afterEach(async () => {
      // Clean up test repo if it exists
      const repoPath = path.join(TEST_REPOS_BASE, testRepoName);
      if (fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });
    
    it('lists empty repositories', async () => {
      const { status, data } = await request('GET', `${REPOS_PREFIX}/repos`);
      
      expect(status).toBe(200);
      expect(data.repos).toBeDefined();
      expect(Array.isArray(data.repos)).toBe(true);
    });
    
    it('creates a repository', async () => {
      const { status, data } = await request('POST', `${REPOS_PREFIX}/repos`, {
        name: testRepoName,
        initReadme: true,
      });
      
      expect(status).toBe(201);
      expect(data.name).toBe(testRepoName);
      expect(data.created).toBe(true);
      
      // Verify it was actually created
      const repoPath = path.join(TEST_REPOS_BASE, testRepoName);
      expect(fs.existsSync(repoPath)).toBe(true);
      expect(fs.existsSync(path.join(repoPath, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(repoPath, 'README.md'))).toBe(true);
    });
    
    it('prevents duplicate creation', async () => {
      // Create first
      await request('POST', `${REPOS_PREFIX}/repos`, { name: testRepoName });
      
      // Try to create again
      const { status } = await request('POST', `${REPOS_PREFIX}/repos`, { name: testRepoName });
      
      expect(status).toBe(409);
    });
    
    it('gets repository info', async () => {
      // Create first
      await request('POST', `${REPOS_PREFIX}/repos`, { name: testRepoName });
      
      const { status, data } = await request('GET', `${REPOS_PREFIX}/repos/${testRepoName}`);
      
      expect(status).toBe(200);
      expect(data.name).toBe(testRepoName);
      expect(data.branch).toBeDefined();
    });
    
    it('returns 404 for non-existent repo', async () => {
      const { status } = await request('GET', `${REPOS_PREFIX}/repos/non-existent-repo`);
      expect(status).toBe(404);
    });
    
    it('gets clone info with token', async () => {
      // Create first
      await request('POST', `${REPOS_PREFIX}/repos`, { name: testRepoName });
      
      const { status, data } = await request('GET', `${REPOS_PREFIX}/repos/${testRepoName}/clone-info`);
      
      expect(status).toBe(200);
      expect(data.token).toBeDefined();
      expect(data.token).toHaveLength(32);
      expect(data.cloneUrl).toContain(testRepoName);
    });
    
    it('deletes a repository', async () => {
      // Create first
      await request('POST', `${REPOS_PREFIX}/repos`, { name: testRepoName });
      
      const { status, data } = await request('DELETE', `${REPOS_PREFIX}/repos/${testRepoName}`);
      
      expect(status).toBe(200);
      expect(data.deleted).toBe(true);
      
      // Verify it was deleted
      const repoPath = path.join(TEST_REPOS_BASE, testRepoName);
      expect(fs.existsSync(repoPath)).toBe(false);
    });
    
    it('sanitizes repository names', async () => {
      const { status, data } = await request('POST', `${REPOS_PREFIX}/repos`, {
        name: 'test/with/slashes',
      });
      
      expect(status).toBe(201);
      expect(data.name).toBe('testwithslashes');
    });
    
    it('lists created repositories', async () => {
      // Create repos
      await request('POST', `${REPOS_PREFIX}/repos`, { name: 'repo1' });
      await request('POST', `${REPOS_PREFIX}/repos`, { name: 'repo2' });
      
      const { status, data } = await request('GET', `${REPOS_PREFIX}/repos`);
      
      expect(status).toBe(200);
      expect(data.repos.length).toBeGreaterThanOrEqual(2);
      expect(data.repos.some((r: any) => r.name === 'repo1')).toBe(true);
      expect(data.repos.some((r: any) => r.name === 'repo2')).toBe(true);
      
      // Cleanup
      await request('DELETE', `${REPOS_PREFIX}/repos/repo1`);
      await request('DELETE', `${REPOS_PREFIX}/repos/repo2`);
    });
  });
  
  describe('Validation', () => {
    it('requires name for repository creation', async () => {
      const { status } = await request('POST', `${REPOS_PREFIX}/repos`, {});
      expect(status).toBe(400);
    });
  });
});

