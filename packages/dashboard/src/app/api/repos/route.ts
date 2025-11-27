/**
 * Repos API Route
 * 
 * Provides unified access to GitHub and Lab512 repositories.
 */

import { NextRequest, NextResponse } from 'next/server';

const GITHUB_API = 'https://api.github.com';
const LAB512_API = process.env.LAB512_API_URL || 'http://localhost:3001';
const LAB512_SECRET = process.env.LAB512_API_SECRET || '';

// GitHub App credentials
const GITHUB_APP_ID = process.env.GITHUB_APP_ID;
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
const GITHUB_INSTALLATION_ID = process.env.GITHUB_APP_INSTALLATION_ID;

interface RepoInfo {
  name: string;
  source: 'github' | 'lab512';
  cloneUrl: string;
  htmlUrl?: string;
  description?: string;
  defaultBranch: string;
  private: boolean;
}

// =============================================================================
// GITHUB HELPERS
// =============================================================================

async function getGitHubToken(): Promise<string> {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_INSTALLATION_ID) {
    throw new Error('GitHub App not configured');
  }
  
  // Generate JWT
  const crypto = await import('crypto');
  const now = Math.floor(Date.now() / 1000);
  
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: GITHUB_APP_ID,
  })).toString('base64url');
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(GITHUB_APP_PRIVATE_KEY, 'base64url');
  
  const jwt = `${header}.${payload}.${signature}`;
  
  // Exchange JWT for installation token
  const response = await fetch(
    `${GITHUB_API}/app/installations/${GITHUB_INSTALLATION_ID}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${jwt}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  
  if (!response.ok) {
    throw new Error(`GitHub auth failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data.token;
}

async function listGitHubRepos(): Promise<RepoInfo[]> {
  const token = await getGitHubToken();
  
  const response = await fetch(`${GITHUB_API}/installation/repositories`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  return data.repositories.map((r: any) => ({
    name: r.name,
    source: 'github',
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    description: r.description || '',
    defaultBranch: r.default_branch || 'main',
    private: r.private,
  }));
}

async function createGitHubRepo(name: string, description?: string): Promise<RepoInfo> {
  const token = await getGitHubToken();
  
  const response = await fetch(`${GITHUB_API}/user/repos`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      description,
      private: false,
      auto_init: true,
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }
  
  const r = await response.json();
  
  return {
    name: r.name,
    source: 'github',
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
    description: r.description || '',
    defaultBranch: r.default_branch || 'main',
    private: r.private,
  };
}

// =============================================================================
// LAB512 HELPERS
// =============================================================================

async function listLab512Repos(): Promise<RepoInfo[]> {
  const response = await fetch(`${LAB512_API}/repos`, {
    headers: {
      'Authorization': `Bearer ${LAB512_SECRET}`,
    },
  });
  
  if (!response.ok) {
    throw new Error(`Lab512 API error: ${response.status}`);
  }
  
  const data = await response.json();
  
  return data.repos.map((r: any) => ({
    name: r.name,
    source: 'lab512',
    cloneUrl: r.cloneUrl,
    htmlUrl: r.cloneUrl,
    description: '',
    defaultBranch: r.branch || 'main',
    private: false,
  }));
}

async function createLab512Repo(name: string, description?: string): Promise<RepoInfo> {
  const response = await fetch(`${LAB512_API}/repos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LAB512_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Lab512 API error: ${response.status} - ${error}`);
  }
  
  const r = await response.json();
  
  return {
    name: r.name,
    source: 'lab512',
    cloneUrl: r.cloneUrl,
    htmlUrl: r.cloneUrl,
    description: description || '',
    defaultBranch: r.branch || 'main',
    private: false,
  };
}

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') || 'github';
  
  try {
    let repos: RepoInfo[];
    
    if (source === 'lab512') {
      repos = await listLab512Repos();
    } else {
      repos = await listGitHubRepos();
    }
    
    return NextResponse.json({ repos, source });
  } catch (error: any) {
    console.error('Error listing repos:', error);
    return NextResponse.json(
      { error: error.message, repos: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, name, description } = body;
    
    if (!name) {
      return NextResponse.json(
        { error: 'Repository name is required' },
        { status: 400 }
      );
    }
    
    let repo: RepoInfo;
    
    if (source === 'lab512') {
      repo = await createLab512Repo(name, description);
    } else {
      repo = await createGitHubRepo(name, description);
    }
    
    return NextResponse.json(repo, { status: 201 });
  } catch (error: any) {
    console.error('Error creating repo:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

