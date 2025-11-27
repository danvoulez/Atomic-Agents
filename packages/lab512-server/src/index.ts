/**
 * Lab512 Local Git Server
 * 
 * Exposes local git repositories via HTTP API.
 * Designed to be accessed via Cloudflare Tunnel at lab512.logline.world
 * 
 * Usage:
 *   pnpm dev          - Start in development mode
 *   pnpm tunnel       - Start Cloudflare tunnel (requires setup)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import { createGitHubAuthMiddleware } from './github-jwt-auth.js';

// =============================================================================
// CONFIG
// =============================================================================

const PORT = process.env.LAB512_PORT || 3001;
const PROJECT_BASE = process.env.LAB512_PROJECT_BASE || '/Users/voulezvous/lab512-logline-world';
const REPOS_BASE = process.env.LAB512_REPOS_PATH || path.join(PROJECT_BASE, 'AtomicAgentsRepos');
const API_SECRET = process.env.LAB512_API_SECRET || 'dev-secret-change-in-prod';
const PROJECT_PREFIX = process.env.LAB512_PROJECT_PREFIX || '';
const REPOS_PREFIX = '/AtomicAgentsRepos';
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://lab512.logline.world',
  'https://atomic-agents.vercel.app',
];

// GitHub App ID for JWT authentication (from environment)
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;

// =============================================================================
// TYPES
// =============================================================================

interface RepoInfo {
  name: string;
  path: string;
  branch: string;
  lastCommit: string;
  lastCommitDate: string;
  size: string;
  cloneUrl: string;
}

interface CreateRepoOptions {
  name: string;
  description?: string;
  private?: boolean;
  initReadme?: boolean;
}

// =============================================================================
// APP SETUP
// =============================================================================

const app: express.Application = express();

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json());

// Auth middleware - now supports GitHub App JWT, Installation Tokens, and legacy Bearer
const requireAuth = createGitHubAuthMiddleware({
  // Allow the GitHub App configured in .env
  allowedAppIds: GITHUB_APP_ID ? [GITHUB_APP_ID] : undefined,
  
  // Also allow legacy Bearer token for backwards compatibility
  legacySecret: API_SECRET,
  
  // Skip auth for health check
  skipPaths: ['/health'],
});

// =============================================================================
// HELPERS
// =============================================================================

function ensureReposDir() {
  if (!fs.existsSync(REPOS_BASE)) {
    fs.mkdirSync(REPOS_BASE, { recursive: true });
  }
}

function getRepoPath(name: string): string {
  // Sanitize name
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(REPOS_BASE, safeName);
}

function isGitRepo(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git'));
}

function getGitInfo(repoPath: string): Partial<RepoInfo> {
  try {
    const branch = execSync('git branch --show-current', { cwd: repoPath, encoding: 'utf-8' }).trim() || 'main';
    const lastCommit = execSync('git rev-parse --short HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const lastCommitDate = execSync('git log -1 --format=%ci', { cwd: repoPath, encoding: 'utf-8' }).trim();
    
    // Get size
    const sizeBytes = execSync('du -sk . | cut -f1', { cwd: repoPath, encoding: 'utf-8' }).trim();
    const sizeMB = (parseInt(sizeBytes) / 1024).toFixed(2);
    
    return { branch, lastCommit, lastCommitDate, size: `${sizeMB} MB` };
  } catch {
    return { branch: 'main', lastCommit: 'N/A', lastCommitDate: 'N/A', size: 'N/A' };
  }
}

// =============================================================================
// ROUTES
// =============================================================================

// Health check (sem prefixo para facilitar)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'lab512',
    hostname: os.hostname(),
    projectBase: PROJECT_BASE,
    reposPath: REPOS_BASE,
    projectPrefix: PROJECT_PREFIX,
    timestamp: new Date().toISOString(),
  });
});

// Router para o projeto AtomicAgentsRepos
const atomicAgentsRouter = express.Router();

// List repositories
atomicAgentsRouter.get('/repos', requireAuth, (req, res) => {
  try {
    ensureReposDir();
    
    const entries = fs.readdirSync(REPOS_BASE, { withFileTypes: true });
    const repos: RepoInfo[] = [];
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const repoPath = path.join(REPOS_BASE, entry.name);
      if (!isGitRepo(repoPath)) continue;
      
      const gitInfo = getGitInfo(repoPath);
      
      repos.push({
        name: entry.name,
        path: repoPath,
        branch: gitInfo.branch || 'main',
        lastCommit: gitInfo.lastCommit || 'N/A',
        lastCommitDate: gitInfo.lastCommitDate || 'N/A',
        size: gitInfo.size || 'N/A',
        cloneUrl: `https://lab512.logline.world${REPOS_PREFIX}/git/${entry.name}`,
      });
    }
    
    res.json({ repos, count: repos.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single repository
atomicAgentsRouter.get('/repos/:name', requireAuth, (req, res) => {
  try {
    const repoPath = getRepoPath(req.params.name);
    
    if (!fs.existsSync(repoPath) || !isGitRepo(repoPath)) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    const gitInfo = getGitInfo(repoPath);
    
    res.json({
      name: req.params.name,
      path: repoPath,
      ...gitInfo,
      cloneUrl: `https://lab512.logline.world${REPOS_PREFIX}/git/${req.params.name}`,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create repository
atomicAgentsRouter.post('/repos', requireAuth, (req, res) => {
  try {
    const options: CreateRepoOptions = req.body;
    
    if (!options.name) {
      return res.status(400).json({ error: 'Repository name is required' });
    }
    
    const repoPath = getRepoPath(options.name);
    
    if (fs.existsSync(repoPath)) {
      return res.status(409).json({ error: 'Repository already exists' });
    }
    
    // Create directory and init git
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath });
    execSync('git config user.name "Lab512"', { cwd: repoPath });
    execSync('git config user.email "lab512@logline.world"', { cwd: repoPath });
    
    // Create initial README if requested
    if (options.initReadme !== false) {
      const readme = `# ${options.name}\n\n${options.description || 'Created via Lab512'}\n`;
      fs.writeFileSync(path.join(repoPath, 'README.md'), readme);
      execSync('git add README.md', { cwd: repoPath });
      execSync('git commit -m "Initial commit"', { cwd: repoPath });
    }
    
    const gitInfo = getGitInfo(repoPath);
    
    res.status(201).json({
      name: options.name,
      path: repoPath,
      ...gitInfo,
      cloneUrl: `https://lab512.logline.world${PROJECT_PREFIX}/AtomicAgentsRepos/git/${options.name}`,
      created: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete repository
atomicAgentsRouter.delete('/repos/:name', requireAuth, (req, res) => {
  try {
    const repoPath = getRepoPath(req.params.name);
    
    if (!fs.existsSync(repoPath)) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    // Safety check - only delete if it's inside REPOS_BASE
    if (!repoPath.startsWith(REPOS_BASE)) {
      return res.status(403).json({ error: 'Cannot delete repositories outside base path' });
    }
    
    fs.rmSync(repoPath, { recursive: true, force: true });
    
    res.json({ deleted: true, name: req.params.name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Clone URL info (for git operations)
atomicAgentsRouter.get('/repos/:name/clone-info', requireAuth, (req, res) => {
  try {
    const repoPath = getRepoPath(req.params.name);
    
    if (!fs.existsSync(repoPath) || !isGitRepo(repoPath)) {
      return res.status(404).json({ error: 'Repository not found' });
    }
    
    // Generate temporary access token (valid for 1 hour)
    const token = crypto.createHmac('sha256', API_SECRET)
      .update(`${req.params.name}:${Math.floor(Date.now() / 3600000)}`)
      .digest('hex')
      .slice(0, 32);
    
    res.json({
      name: req.params.name,
      cloneUrl: `https://lab512.logline.world${REPOS_PREFIX}/git/${req.params.name}`,
      httpUrl: `https://lab512.logline.world${REPOS_PREFIX}/git/${req.params.name}`,
      token,
      expiresIn: '1 hour',
      instructions: {
        clone: `git clone https://x-access-token:${token}@lab512.logline.world${REPOS_PREFIX}/git/${req.params.name}`,
        setRemote: `git remote set-url origin https://x-access-token:${token}@lab512.logline.world${REPOS_PREFIX}/git/${req.params.name}`,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Git HTTP backend (smart HTTP protocol)
// This allows git clone/push via HTTP
atomicAgentsRouter.all('/git/:name/*', (req, res) => {
  const repoName = req.params.name;
  const repoPath = getRepoPath(repoName);
  
  // Check auth for push operations
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Lab512 Git"');
      return res.status(401).send('Authentication required');
    }
    
    // Decode Basic auth
    const [, credentials] = authHeader.split(' ');
    const decoded = Buffer.from(credentials, 'base64').toString();
    const [username, token] = decoded.split(':');
    
    // Verify token (either API secret or temporary token)
    if (token !== API_SECRET) {
      const expectedToken = crypto.createHmac('sha256', API_SECRET)
        .update(`${repoName}:${Math.floor(Date.now() / 3600000)}`)
        .digest('hex')
        .slice(0, 32);
      
      if (token !== expectedToken) {
        return res.status(403).send('Invalid credentials');
      }
    }
  }
  
  if (!fs.existsSync(repoPath) || !isGitRepo(repoPath)) {
    return res.status(404).send('Repository not found');
  }
  
  // Get the git path after /git/:name/
  const gitPath = (req.params as any)['0'] || '';
  
  // Handle git info/refs (for clone/fetch)
  if (gitPath === 'info/refs') {
    const service = req.query.service as string;
    
    if (service === 'git-upload-pack' || service === 'git-receive-pack') {
      res.setHeader('Content-Type', `application/x-${service}-advertisement`);
      res.setHeader('Cache-Control', 'no-cache');
      
      const proc = spawn(service.replace('git-', 'git ').split(' ')[0], 
        [service.replace('git-', ''), '--stateless-rpc', '--advertise-refs', repoPath]);
      
      // Write packet line for service announcement
      const serviceLine = `# service=${service}\n`;
      const pktLine = (serviceLine.length + 4).toString(16).padStart(4, '0') + serviceLine;
      res.write(pktLine);
      res.write('0000');
      
      proc.stdout.pipe(res);
      proc.stderr.on('data', (data) => console.error(`git stderr: ${data}`));
      
      return;
    }
  }
  
  // Handle git-upload-pack (clone/fetch)
  if (gitPath === 'git-upload-pack') {
    res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    
    const proc = spawn('git', ['upload-pack', '--stateless-rpc', repoPath]);
    req.pipe(proc.stdin);
    proc.stdout.pipe(res);
    proc.stderr.on('data', (data) => console.error(`git stderr: ${data}`));
    
    return;
  }
  
  // Handle git-receive-pack (push)
  if (gitPath === 'git-receive-pack') {
    res.setHeader('Content-Type', 'application/x-git-receive-pack-result');
    res.setHeader('Cache-Control', 'no-cache');
    
    const proc = spawn('git', ['receive-pack', '--stateless-rpc', repoPath]);
    req.pipe(proc.stdin);
    proc.stdout.pipe(res);
    proc.stderr.on('data', (data) => console.error(`git stderr: ${data}`));
    
    return;
  }
  
  res.status(404).send('Not found');
});

// Mount router at /AtomicAgentsRepos
app.use(REPOS_PREFIX, atomicAgentsRouter);

// =============================================================================
// START SERVER
// =============================================================================

app.listen(PORT, () => {
  ensureReposDir();
  console.log(`
🖥️  Lab512 Local Git Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📁 Repositories: ${REPOS_BASE}
🌐 Local URL:    http://localhost:${PORT}
🔗 Public URL:   https://lab512.logline.world (via Cloudflare Tunnel)

API Endpoints:
  GET  /health                              - Health check
  GET  ${REPOS_PREFIX}/repos                - List repositories
  POST ${REPOS_PREFIX}/repos                - Create repository
  GET  ${REPOS_PREFIX}/repos/:name          - Get repository info
  DEL  ${REPOS_PREFIX}/repos/:name          - Delete repository
  GET  ${REPOS_PREFIX}/repos/:name/clone-info - Get clone credentials

Git HTTP:
  ${REPOS_PREFIX}/git/:name/*               - Git HTTP smart protocol

🔐 Authentication (unified with GitHub):
  • GitHub App JWT (Bearer <jwt>)           - Preferred
  • GitHub Installation Token (ghs_xxx)     - For git operations
  • Legacy Bearer Token                     - Backwards compatible
${GITHUB_APP_ID ? `  ✓ GitHub App ID: ${GITHUB_APP_ID} configured` : '  ⚠ No GITHUB_APP_ID - using legacy auth only'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
});

export default app;

