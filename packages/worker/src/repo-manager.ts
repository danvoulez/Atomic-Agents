/**
 * Repository Manager
 * 
 * Handles cloning, branching, and pushing to Git repositories.
 * Supports GitHub App authentication for secure access.
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getGitCredentials, GitHubAppAuth } from './github-auth.js';

// =============================================================================
// TYPES
// =============================================================================

export interface RepoConfig {
  /** Repository URL (https://github.com/owner/repo) */
  url: string;
  /** Branch to clone from (default: main) */
  branch?: string;
  /** GitHub App auth (if not using env vars) */
  githubApp?: {
    appId: string;
    privateKey: string;
    installationId?: string;
  };
}

export interface CloneResult {
  path: string;
  branch: string;
  commit: string;
  remote: string;
}

export interface BranchResult {
  name: string;
  basedOn: string;
  created: boolean;
}

export interface PushResult {
  pushed: boolean;
  remote: string;
  branch: string;
  commits: number;
}

export interface PRResult {
  number: number;
  url: string;
  state: string;
}

// =============================================================================
// REPO MANAGER
// =============================================================================

export class RepoManager {
  private tmpBase: string;
  private cleanupPaths: Set<string> = new Set();
  
  constructor(tmpBase?: string) {
    this.tmpBase = tmpBase || process.env.REPOS_TMP_PATH || '/tmp/repos';
    
    // Ensure tmp directory exists
    if (!fs.existsSync(this.tmpBase)) {
      fs.mkdirSync(this.tmpBase, { recursive: true });
    }
  }
  
  /**
   * Parse owner and repo from a GitHub URL
   */
  parseRepoUrl(url: string): { owner: string; repo: string } {
    // Handle various formats:
    // https://github.com/owner/repo
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    
    let cleanUrl = url;
    
    if (url.startsWith('git@')) {
      // SSH format
      cleanUrl = url.replace('git@github.com:', 'https://github.com/');
    }
    
    const parsed = new URL(cleanUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    
    return {
      owner: parts[0],
      repo: parts[1]?.replace(/\.git$/, ''),
    };
  }
  
  /**
   * Clone a repository
   */
  async clone(jobId: string, config: RepoConfig): Promise<CloneResult> {
    const repoPath = path.join(this.tmpBase, jobId);
    const { owner, repo } = this.parseRepoUrl(config.url);
    const branch = config.branch || 'main';
    
    // Get credentials
    const creds = await getGitCredentials(config.url);
    const authUrl = creds.gitUrl(config.url);
    
    // Clone with depth=1 for speed
    console.log(`[RepoManager] Cloning ${owner}/${repo} to ${repoPath}`);
    
    try {
      // Use spawn to avoid credential leaking in error messages
      await this.runGit(['clone', '--depth=1', '-b', branch, authUrl, repoPath], {
        cwd: this.tmpBase,
        timeout: 120_000, // 2 min timeout
      });
    } catch (error: any) {
      // Sanitize error message
      const sanitized = error.message?.replace(creds.password, '***');
      throw new Error(`Failed to clone repository: ${sanitized}`);
    }
    
    // Configure git identity
    this.runGitSync(['config', 'user.name', 'Atomic Agents'], { cwd: repoPath });
    this.runGitSync(['config', 'user.email', 'ai@atomic-agents.dev'], { cwd: repoPath });
    
    // Store the original remote URL (without credentials)
    this.runGitSync(['remote', 'set-url', 'origin', config.url], { cwd: repoPath });
    
    // Get current commit
    const commit = this.runGitSync(['rev-parse', 'HEAD'], { cwd: repoPath }).trim();
    
    // Track for cleanup
    this.cleanupPaths.add(repoPath);
    
    return {
      path: repoPath,
      branch,
      commit,
      remote: config.url,
    };
  }
  
  /**
   * Create a new branch
   */
  async createBranch(
    repoPath: string,
    branchName: string,
    jobId: string
  ): Promise<BranchResult> {
    const fullBranchName = `ai/${jobId.slice(0, 8)}/${branchName}`;
    
    // Check if branch exists
    try {
      this.runGitSync(['rev-parse', '--verify', fullBranchName], { cwd: repoPath });
      // Branch exists, checkout
      this.runGitSync(['checkout', fullBranchName], { cwd: repoPath });
      return {
        name: fullBranchName,
        basedOn: this.getCurrentBranch(repoPath),
        created: false,
      };
    } catch {
      // Branch doesn't exist, create it
    }
    
    const baseBranch = this.getCurrentBranch(repoPath);
    this.runGitSync(['checkout', '-b', fullBranchName], { cwd: repoPath });
    
    return {
      name: fullBranchName,
      basedOn: baseBranch,
      created: true,
    };
  }
  
  /**
   * Stage all changes and commit
   */
  async commit(repoPath: string, message: string): Promise<{ hash: string; files: number }> {
    // Stage all changes
    this.runGitSync(['add', '-A'], { cwd: repoPath });
    
    // Check if there are changes
    const status = this.runGitSync(['status', '--porcelain'], { cwd: repoPath });
    if (!status.trim()) {
      throw new Error('No changes to commit');
    }
    
    const filesCount = status.split('\n').filter(Boolean).length;
    
    // Commit
    this.runGitSync(['commit', '-m', message], { cwd: repoPath });
    
    // Get commit hash
    const hash = this.runGitSync(['rev-parse', 'HEAD'], { cwd: repoPath }).trim();
    
    return { hash, files: filesCount };
  }
  
  /**
   * Push changes to remote
   */
  async push(repoPath: string, repoUrl: string): Promise<PushResult> {
    const branch = this.getCurrentBranch(repoPath);
    
    // Get credentials
    const creds = await getGitCredentials(repoUrl);
    const authUrl = creds.gitUrl(repoUrl);
    
    // Count commits ahead of origin
    let commitsAhead = 0;
    try {
      const log = this.runGitSync(['log', `origin/${branch}..HEAD`, '--oneline'], { cwd: repoPath });
      commitsAhead = log.split('\n').filter(Boolean).length;
    } catch {
      // No upstream, count all commits
      const log = this.runGitSync(['log', '--oneline'], { cwd: repoPath });
      commitsAhead = log.split('\n').filter(Boolean).length;
    }
    
    // Push using authenticated URL
    try {
      await this.runGit(['push', '-u', authUrl, 'HEAD'], {
        cwd: repoPath,
        timeout: 60_000,
      });
    } catch (error: any) {
      const sanitized = error.message?.replace(creds.password, '***');
      throw new Error(`Failed to push: ${sanitized}`);
    }
    
    // Restore original remote URL
    this.runGitSync(['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath });
    
    return {
      pushed: true,
      remote: repoUrl,
      branch,
      commits: commitsAhead,
    };
  }
  
  /**
   * Create a pull request
   */
  async createPullRequest(
    repoUrl: string,
    options: {
      title: string;
      body: string;
      head: string;
      base?: string;
    }
  ): Promise<PRResult> {
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    
    // Need GitHub App for API access
    if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY) {
      throw new Error('GitHub App credentials required to create pull requests');
    }
    
    const app = GitHubAppAuth.fromEnv();
    
    const result = await app.createPullRequest(owner, repo, {
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base || 'main',
    });
    
    return {
      number: result.number,
      url: result.html_url,
      state: result.state,
    };
  }
  
  /**
   * Cleanup a repository
   */
  async cleanup(repoPath: string): Promise<void> {
    if (fs.existsSync(repoPath)) {
      await fs.promises.rm(repoPath, { recursive: true, force: true });
      this.cleanupPaths.delete(repoPath);
    }
  }
  
  /**
   * Cleanup all tracked repositories
   */
  async cleanupAll(): Promise<void> {
    for (const repoPath of this.cleanupPaths) {
      await this.cleanup(repoPath);
    }
  }
  
  /**
   * Get current branch name
   */
  private getCurrentBranch(repoPath: string): string {
    return this.runGitSync(['branch', '--show-current'], { cwd: repoPath }).trim();
  }
  
  /**
   * Run git command synchronously
   */
  private runGitSync(args: string[], options: { cwd: string }): string {
    return execSync(`git ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      cwd: options.cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  
  /**
   * Run git command asynchronously (for long operations)
   */
  private runGit(
    args: string[],
    options: { cwd: string; timeout?: number }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('git', args, {
        cwd: options.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: options.timeout,
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `git exited with code ${code}`));
        }
      });
      
      proc.on('error', reject);
    });
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let defaultManager: RepoManager | null = null;

export function getRepoManager(): RepoManager {
  if (!defaultManager) {
    defaultManager = new RepoManager();
  }
  return defaultManager;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default RepoManager;

