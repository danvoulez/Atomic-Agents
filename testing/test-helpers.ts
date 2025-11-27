import { Pool } from 'pg';
import { randomUUID } from 'crypto';

let testPool: Pool | null = null;

// UUID cache for consistent trace IDs in tests
const uuidCache = new Map<string, string>();

/**
 * Get or create a UUID for a given key (for consistent trace IDs in tests)
 */
export function getTestUUID(key: string): string {
  if (!uuidCache.has(key)) {
    uuidCache.set(key, randomUUID());
  }
  return uuidCache.get(key)!;
}

/**
 * Generate a fresh UUID
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * Clear the UUID cache (call in beforeEach)
 */
export function clearUUIDCache(): void {
  uuidCache.clear();
}

export async function setupTestDatabase() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:testpassword@localhost:5432/ai_coding_team_test';
  
  testPool = new Pool({
    connectionString: databaseUrl,
  });

  // Verify connection (migrations should already be applied via pnpm db:migrate)
  try {
    await testPool.query('SELECT 1');
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
}

export async function teardownTestDatabase() {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

export async function clearTestData() {
  if (!testPool) {
    throw new Error('Test pool not initialized');
  }

  try {
    // Clear tables in correct order (respecting foreign keys)
    await testPool.query('DELETE FROM events');
    await testPool.query('DELETE FROM jobs');
    await testPool.query('DELETE FROM conversations');
  } catch (error) {
    console.error('Failed to clear test data:', error);
    throw error;
  }
}

export async function getTestPool(): Promise<Pool> {
  if (!testPool) {
    throw new Error('Test pool not initialized. Call setupTestDatabase() first.');
  }
  return testPool;
}

/**
 * Create a test job with default values
 */
export function createTestJobData(overrides: Partial<any> = {}) {
  return {
    id: crypto.randomUUID(),
    trace_id: crypto.randomUUID(),
    goal: 'Test goal',
    mode: 'mechanic' as const,
    agent_type: 'coordinator' as const,
    status: 'queued' as const,
    conversation_id: null,
    repo_path: '/tmp/test-repo',
    step_cap: 20,
    token_cap: 50000,
    cost_cap_cents: 100,
    created_by: 'test-user',
    ...overrides,
  };
}

/**
 * Create a test event with default values
 */
export function createTestEventData(jobId: string, overrides: Partial<any> = {}) {
  return {
    job_id: jobId,
    trace_id: 'trace-test-123',
    type: 'planning',
    payload: {},
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Create a mock LLM client for testing
 */
export function createMockLLMClient() {
  return {
    chat: async (messages: any[]) => {
      return {
        role: 'assistant',
        content: 'Mock response',
        tool_calls: [],
      };
    },
  };
}

/**
 * Create a test repository
 */
export async function createTestRepo(path: string) {
  const fs = await import('fs/promises');
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Create directory
  await fs.mkdir(path, { recursive: true });

  // Initialize git repo
  await execAsync('git init', { cwd: path });
  await execAsync('git config user.email "test@example.com"', { cwd: path });
  await execAsync('git config user.name "Test User"', { cwd: path });

  // Create initial file
  await fs.writeFile(`${path}/README.md`, '# Test Repo\n');
  await execAsync('git add .', { cwd: path });
  await execAsync('git commit -m "Initial commit"', { cwd: path });
}

/**
 * Clean up test repository
 */
export async function cleanupTestRepo(path: string) {
  const fs = await import('fs/promises');
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
  }
}
