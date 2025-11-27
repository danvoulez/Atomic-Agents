/**
 * RepoProvider - Unified interface for GitHub and Lab512 repositories
 * 
 * Provides a consistent API for creating, cloning, and managing repositories
 * regardless of whether they're hosted on GitHub or locally on Lab512.
 */

import { RepoManager, CloneResult, BranchResult, PushResult, PRResult } from './repo-manager.js';
import { GitHubAppAuth } from './github-auth.js';
import * as https from 'https';
import * as http from 'http';

// =============================================================================
// TYPES
// =============================================================================

export type RepoSource = 'github' | 'lab512';

export interface RepoProviderConfig {
  source: RepoSource;
  
  // GitHub config
  github?: {
    appId?: string;
    privateKey?: string;
    installationId?: string;
  };
  
  // Lab512 config
  lab512?: {
    apiUrl?: string;
    apiSecret?: string;
  };
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  private?: boolean;
  initReadme?: boolean;
}

export interface RepoInfo {
  name: string;
  source: RepoSource;
  cloneUrl: string;
  htmlUrl?: string;
  description?: string;
  defaultBranch: string;
  private: boolean;
}

export interface RepoCredentials {
  username: string;
  password: string;
  cloneUrl: string;
}

// =============================================================================
// LAB512 CLIENT
// =============================================================================

class Lab512Client {
  private apiUrl: string;
  private apiSecret: string;
  private reposPrefix: string;
  private githubAuth?: GitHubAppAuth;
  private useGitHubAuth: boolean;
  
  constructor(apiUrl?: string, apiSecret?: string, useGitHubAuth = true) {
    this.apiUrl = apiUrl || process.env.LAB512_API_URL || 'http://localhost:3001';
    this.apiSecret = apiSecret || process.env.LAB512_API_SECRET || '';
    this.reposPrefix = '/AtomicAgentsRepos'; // Must match server REPOS_PREFIX
    this.useGitHubAuth = useGitHubAuth;
    
    // Try to use GitHub App for authentication (unified auth)
    if (useGitHubAuth && process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
      try {
        this.githubAuth = GitHubAppAuth.fromEnv();
      } catch {
        // Fall back to legacy auth
        this.githubAuth = undefined;
      }
    }
  }
  
  private async getAuthToken(): Promise<string> {
    // Prefer GitHub App JWT for unified authentication
    if (this.githubAuth) {
      return this.githubAuth.getJWT();
    }
    // Fall back to legacy secret
    return this.apiSecret;
  }
  
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(this.reposPrefix + path, this.apiUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const token = await this.getAuthToken();
    
    return new Promise((resolve, reject) => {
      const req = client.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Lab512 API error: ${res.statusCode} - ${data}`));
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
  
  async listRepos(): Promise<RepoInfo[]> {
    const result = await this.request<{ repos: any[] }>('GET', '/repos');
    return result.repos.map(r => ({
      name: r.name,
      source: 'lab512' as RepoSource,
      cloneUrl: r.cloneUrl,
      htmlUrl: r.cloneUrl,
      description: '',
      defaultBranch: r.branch || 'main',
      private: false,
    }));
  }
  
  async createRepo(options: CreateRepoOptions): Promise<RepoInfo> {
    const result = await this.request<any>('POST', '/repos', options);
    return {
      name: result.name,
      source: 'lab512',
      cloneUrl: result.cloneUrl,
      htmlUrl: result.cloneUrl,
      description: options.description || '',
      defaultBranch: result.branch || 'main',
      private: false,
    };
  }
  
  async getCloneCredentials(repoName: string): Promise<RepoCredentials> {
    const result = await this.request<any>('GET', `/repos/${repoName}/clone-info`);
    return {
      username: 'x-access-token',
      password: result.token,
      cloneUrl: `https://x-access-token:${result.token}@lab512.logline.world${this.reposPrefix}/git/${repoName}`,
    };
  }
  
  async deleteRepo(name: string): Promise<void> {
    await this.request('DELETE', `/repos/${name}`);
  }
}

// =============================================================================
// GITHUB CLIENT (wrapper around existing GitHubAppAuth)
// =============================================================================

class GitHubClient {
  private auth: GitHubAppAuth;
  
  constructor(config?: RepoProviderConfig['github']) {
    if (config?.appId && config?.privateKey) {
      this.auth = new GitHubAppAuth({
        appId: config.appId,
        privateKey: config.privateKey,
        installationId: config.installationId,
      });
    } else {
      this.auth = GitHubAppAuth.fromEnv();
    }
  }
  
  async listRepos(): Promise<RepoInfo[]> {
    const token = await this.auth.getInstallationToken();
    
    // Get repos the app has access to
    const response = await this.githubRequest<{ repositories: any[] }>(
      'GET',
      '/installation/repositories',
      token.token
    );
    
    return response.repositories.map(r => ({
      name: r.name,
      source: 'github' as RepoSource,
      cloneUrl: r.clone_url,
      htmlUrl: r.html_url,
      description: r.description || '',
      defaultBranch: r.default_branch || 'main',
      private: r.private,
    }));
  }
  
  async createRepo(options: CreateRepoOptions): Promise<RepoInfo> {
    const token = await this.auth.getInstallationToken();
    
    // Create repo under the authenticated user/org
    const result = await this.githubRequest<any>(
      'POST',
      '/user/repos',
      token.token,
      {
        name: options.name,
        description: options.description,
        private: options.private ?? false,
        auto_init: options.initReadme !== false,
      }
    );
    
    return {
      name: result.name,
      source: 'github',
      cloneUrl: result.clone_url,
      htmlUrl: result.html_url,
      description: result.description || '',
      defaultBranch: result.default_branch || 'main',
      private: result.private,
    };
  }
  
  async getCloneCredentials(owner: string, repo: string): Promise<RepoCredentials> {
    const creds = await this.auth.getGitCredentials(owner, repo);
    return {
      username: creds.username,
      password: creds.password,
      cloneUrl: creds.gitUrl(`https://github.com/${owner}/${repo}`),
    };
  }
  
  private async githubRequest<T>(
    method: string,
    path: string,
    token: string,
    body?: unknown
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.github.com',
        port: 443,
        path,
        method,
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Atomic-Agents/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
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
}

// =============================================================================
// UNIFIED REPO PROVIDER
// =============================================================================

export class RepoProvider {
  private source: RepoSource;
  private githubClient?: GitHubClient;
  private lab512Client?: Lab512Client;
  private repoManager: RepoManager;
  
  constructor(config?: RepoProviderConfig) {
    this.source = config?.source || (process.env.REPO_SOURCE as RepoSource) || 'github';
    this.repoManager = new RepoManager();
    
    if (this.source === 'github' || !config?.source) {
      try {
        this.githubClient = new GitHubClient(config?.github);
      } catch {
        console.warn('GitHub client not configured');
      }
    }
    
    if (this.source === 'lab512' || !config?.source) {
      this.lab512Client = new Lab512Client(config?.lab512?.apiUrl, config?.lab512?.apiSecret);
    }
  }
  
  /**
   * Get the current source
   */
  getSource(): RepoSource {
    return this.source;
  }
  
  /**
   * Switch to a different source
   */
  setSource(source: RepoSource): void {
    this.source = source;
  }
  
  /**
   * List repositories from the current source
   */
  async listRepos(): Promise<RepoInfo[]> {
    if (this.source === 'lab512' && this.lab512Client) {
      return this.lab512Client.listRepos();
    }
    
    if (this.githubClient) {
      return this.githubClient.listRepos();
    }
    
    throw new Error(`No client configured for source: ${this.source}`);
  }
  
  /**
   * Create a new repository
   */
  async createRepo(options: CreateRepoOptions): Promise<RepoInfo> {
    if (this.source === 'lab512' && this.lab512Client) {
      return this.lab512Client.createRepo(options);
    }
    
    if (this.githubClient) {
      return this.githubClient.createRepo(options);
    }
    
    throw new Error(`No client configured for source: ${this.source}`);
  }
  
  /**
   * Clone a repository
   */
  async clone(jobId: string, repoInfo: RepoInfo): Promise<CloneResult> {
    let cloneUrl = repoInfo.cloneUrl;
    
    // Get authenticated URL if needed
    if (this.source === 'github' && this.githubClient) {
      const [, owner, repo] = new URL(repoInfo.cloneUrl).pathname.split('/');
      const creds = await this.githubClient.getCloneCredentials(owner, repo.replace('.git', ''));
      cloneUrl = creds.cloneUrl;
    } else if (this.source === 'lab512' && this.lab512Client) {
      const creds = await this.lab512Client.getCloneCredentials(repoInfo.name);
      cloneUrl = creds.cloneUrl;
    }
    
    return this.repoManager.clone(jobId, {
      url: cloneUrl,
      branch: repoInfo.defaultBranch,
    });
  }
  
  /**
   * Create a branch
   */
  async createBranch(repoPath: string, branchName: string, jobId: string): Promise<BranchResult> {
    return this.repoManager.createBranch(repoPath, branchName, jobId);
  }
  
  /**
   * Commit changes
   */
  async commit(repoPath: string, message: string): Promise<{ hash: string; files: number }> {
    return this.repoManager.commit(repoPath, message);
  }
  
  /**
   * Push changes
   */
  async push(repoPath: string, repoInfo: RepoInfo): Promise<PushResult> {
    return this.repoManager.push(repoPath, repoInfo.cloneUrl);
  }
  
  /**
   * Create a pull request (GitHub only)
   */
  async createPullRequest(
    repoInfo: RepoInfo,
    options: { title: string; body: string; head: string; base?: string }
  ): Promise<PRResult> {
    if (repoInfo.source !== 'github') {
      throw new Error('Pull requests are only supported for GitHub repositories');
    }
    
    return this.repoManager.createPullRequest(repoInfo.cloneUrl, options);
  }
  
  /**
   * Cleanup a cloned repository
   */
  async cleanup(repoPath: string): Promise<void> {
    return this.repoManager.cleanup(repoPath);
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let defaultProvider: RepoProvider | null = null;

export function getRepoProvider(): RepoProvider {
  if (!defaultProvider) {
    defaultProvider = new RepoProvider();
  }
  return defaultProvider;
}

// =============================================================================
// EXPORTS
// =============================================================================

export default RepoProvider;

