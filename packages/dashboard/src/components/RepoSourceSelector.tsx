'use client';

import { useState, useEffect } from 'react';

type RepoSource = 'github' | 'lab512';

interface RepoInfo {
  name: string;
  source: RepoSource;
  cloneUrl: string;
  htmlUrl?: string;
  description?: string;
  defaultBranch: string;
  private: boolean;
}

interface RepoSourceSelectorProps {
  onSourceChange?: (source: RepoSource) => void;
  onRepoSelect?: (repo: RepoInfo) => void;
  selectedRepo?: RepoInfo | null;
}

export default function RepoSourceSelector({
  onSourceChange,
  onRepoSelect,
  selectedRepo,
}: RepoSourceSelectorProps) {
  const [source, setSource] = useState<RepoSource>('github');
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Fetch repos when source changes
  useEffect(() => {
    fetchRepos();
  }, [source]);
  
  const fetchRepos = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/repos?source=${source}`);
      if (!response.ok) throw new Error('Failed to fetch repositories');
      
      const data = await response.json();
      setRepos(data.repos);
    } catch (err: any) {
      setError(err.message);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  };
  
  const handleSourceChange = (newSource: RepoSource) => {
    setSource(newSource);
    onSourceChange?.(newSource);
  };
  
  const handleRepoSelect = (repo: RepoInfo) => {
    onRepoSelect?.(repo);
  };
  
  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    
    setCreating(true);
    setError(null);
    
    try {
      const response = await fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          name: newRepoName,
          description: `Created via Atomic Agents`,
        }),
      });
      
      if (!response.ok) throw new Error('Failed to create repository');
      
      const newRepo = await response.json();
      setRepos([newRepo, ...repos]);
      setNewRepoName('');
      setShowCreateForm(false);
      onRepoSelect?.(newRepo);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };
  
  return (
    <div className="repo-source-selector">
      {/* Source Toggle */}
      <div className="source-toggle">
        <button
          className={`source-btn ${source === 'github' ? 'active' : ''}`}
          onClick={() => handleSourceChange('github')}
        >
          <GithubIcon />
          <span>GitHub</span>
        </button>
        <button
          className={`source-btn ${source === 'lab512' ? 'active' : ''}`}
          onClick={() => handleSourceChange('lab512')}
        >
          <ComputerIcon />
          <span>Lab512</span>
          <span className="badge">Local</span>
        </button>
      </div>
      
      {/* Status indicator */}
      <div className="source-status">
        {source === 'github' ? (
          <span className="status-text">
            <span className="dot green" />
            Conectado via GitHub App
          </span>
        ) : (
          <span className="status-text">
            <span className="dot blue" />
            lab512.logline.world
          </span>
        )}
      </div>
      
      {/* Actions */}
      <div className="repo-actions">
        <button 
          className="btn-secondary"
          onClick={fetchRepos}
          disabled={loading}
        >
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
        <button 
          className="btn-primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          + Novo Repositório
        </button>
      </div>
      
      {/* Create form */}
      {showCreateForm && (
        <form className="create-repo-form" onSubmit={handleCreateRepo}>
          <input
            type="text"
            placeholder="Nome do repositório"
            value={newRepoName}
            onChange={(e) => setNewRepoName(e.target.value)}
            disabled={creating}
            pattern="[a-zA-Z0-9_-]+"
            title="Apenas letras, números, - e _"
          />
          <button type="submit" disabled={creating || !newRepoName.trim()}>
            {creating ? 'Criando...' : 'Criar'}
          </button>
          <button type="button" onClick={() => setShowCreateForm(false)}>
            Cancelar
          </button>
        </form>
      )}
      
      {/* Error */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
      
      {/* Repository list */}
      <div className="repo-list">
        {loading ? (
          <div className="loading">Carregando repositórios...</div>
        ) : repos.length === 0 ? (
          <div className="empty">
            Nenhum repositório encontrado.
            {source === 'lab512' && (
              <p>Crie um novo repositório para começar.</p>
            )}
          </div>
        ) : (
          repos.map((repo) => (
            <div
              key={`${repo.source}-${repo.name}`}
              className={`repo-item ${selectedRepo?.name === repo.name ? 'selected' : ''}`}
              onClick={() => handleRepoSelect(repo)}
            >
              <div className="repo-icon">
                {repo.source === 'github' ? <GithubIcon /> : <FolderIcon />}
              </div>
              <div className="repo-info">
                <div className="repo-name">
                  {repo.name}
                  {repo.private && <span className="private-badge">Private</span>}
                </div>
                {repo.description && (
                  <div className="repo-description">{repo.description}</div>
                )}
                <div className="repo-meta">
                  <span>{repo.defaultBranch}</span>
                  <span className="source-badge">{repo.source}</span>
                </div>
              </div>
              <div className="repo-select">
                {selectedRepo?.name === repo.name ? '✓' : '→'}
              </div>
            </div>
          ))
        )}
      </div>
      
      <style jsx>{`
        .repo-source-selector {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        
        .source-toggle {
          display: flex;
          gap: 0.5rem;
          background: var(--bg-secondary, #1a1a2e);
          padding: 0.25rem;
          border-radius: 0.5rem;
        }
        
        .source-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border: none;
          background: transparent;
          color: var(--text-secondary, #a0a0a0);
          border-radius: 0.375rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .source-btn:hover {
          background: var(--bg-hover, #252540);
        }
        
        .source-btn.active {
          background: var(--accent, #6366f1);
          color: white;
        }
        
        .source-btn .badge {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background: rgba(255,255,255,0.2);
          border-radius: 0.25rem;
        }
        
        .source-status {
          font-size: 0.875rem;
          color: var(--text-secondary, #a0a0a0);
        }
        
        .status-text {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .dot.green { background: #22c55e; }
        .dot.blue { background: #3b82f6; }
        
        .repo-actions {
          display: flex;
          gap: 0.5rem;
        }
        
        .btn-primary, .btn-secondary {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 0.375rem;
          cursor: pointer;
          font-size: 0.875rem;
          transition: all 0.2s;
        }
        
        .btn-primary {
          background: var(--accent, #6366f1);
          color: white;
        }
        
        .btn-primary:hover {
          background: var(--accent-hover, #4f46e5);
        }
        
        .btn-secondary {
          background: var(--bg-secondary, #1a1a2e);
          color: var(--text-primary, #ffffff);
          border: 1px solid var(--border, #2a2a4e);
        }
        
        .btn-secondary:hover {
          background: var(--bg-hover, #252540);
        }
        
        .create-repo-form {
          display: flex;
          gap: 0.5rem;
          padding: 1rem;
          background: var(--bg-secondary, #1a1a2e);
          border-radius: 0.5rem;
        }
        
        .create-repo-form input {
          flex: 1;
          padding: 0.5rem;
          border: 1px solid var(--border, #2a2a4e);
          border-radius: 0.375rem;
          background: var(--bg-primary, #0f0f1a);
          color: var(--text-primary, #ffffff);
        }
        
        .error-message {
          padding: 0.75rem;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 0.375rem;
          color: #ef4444;
          font-size: 0.875rem;
        }
        
        .repo-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          max-height: 400px;
          overflow-y: auto;
        }
        
        .repo-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2a2a4e);
          border-radius: 0.5rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .repo-item:hover {
          border-color: var(--accent, #6366f1);
        }
        
        .repo-item.selected {
          border-color: var(--accent, #6366f1);
          background: rgba(99, 102, 241, 0.1);
        }
        
        .repo-icon {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-primary, #0f0f1a);
          border-radius: 0.5rem;
        }
        
        .repo-info {
          flex: 1;
        }
        
        .repo-name {
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        
        .private-badge {
          font-size: 0.625rem;
          padding: 0.125rem 0.375rem;
          background: rgba(234, 179, 8, 0.2);
          color: #eab308;
          border-radius: 0.25rem;
        }
        
        .repo-description {
          font-size: 0.875rem;
          color: var(--text-secondary, #a0a0a0);
          margin-top: 0.25rem;
        }
        
        .repo-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: var(--text-tertiary, #6b6b6b);
          margin-top: 0.5rem;
        }
        
        .source-badge {
          padding: 0.125rem 0.375rem;
          background: var(--bg-primary, #0f0f1a);
          border-radius: 0.25rem;
          text-transform: uppercase;
        }
        
        .repo-select {
          font-size: 1.25rem;
          color: var(--accent, #6366f1);
        }
        
        .loading, .empty {
          padding: 2rem;
          text-align: center;
          color: var(--text-secondary, #a0a0a0);
        }
      `}</style>
    </div>
  );
}

// Icons
function GithubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
    </svg>
  );
}

