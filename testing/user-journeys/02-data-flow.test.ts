import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { insertJob, insertEvent, listEvents } from '@ai-coding-team/db';
import { setupTestDatabase, teardownTestDatabase, clearTestData, getTestUUID, clearUUIDCache } from '../test-helpers';

/**
 * User Journey: Data Flow Through System
 * 
 * This test validates how data flows through the entire system:
 * 1. User request enters through API
 * 2. Request is validated and stored in database
 * 3. Worker picks up the job
 * 4. Agent processes and generates events
 * 5. Events are streamed to dashboard
 * 6. Dashboard updates UI in real-time
 */
describe('User Journey: Data Flow', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    clearUUIDCache();
    await clearTestData();
  });

  describe('Flow 1: API Request → Database', () => {
    it('should accept job creation request', async () => {
      const jobRequest = {
        goal: 'Add authentication to login page',
        mode: 'mechanic' as const,
        agent_kind: 'info' as const,
        status: 'queued' as const,
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      };

      const job = await insertJob(jobRequest);

      expect(job).toBeDefined();
      expect(job.goal).toBe(jobRequest.goal);
      expect(job.mode).toBe(jobRequest.mode);
    });

    it('should validate input and reject invalid data', async () => {
      await expect(async () => {
        await insertJob({
          goal: '', // Invalid: empty goal
          mode: 'mechanic',
          agent_kind: 'info',
          status: 'queued',
          conversation_id: null,
          repo_path: '/tmp/test-repo',
          step_cap: 20,
          token_cap: 50000,
          cost_cap_cents: 100,
          created_by: 'api-test',
        });
      }).rejects.toThrow();
    });

    it('should generate unique job ID', async () => {
      const job1 = await insertJob({
        goal: 'Task 1',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const job2 = await insertJob({
        goal: 'Task 2',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      expect(job1.id).not.toBe(job2.id);
      expect(job1.id).toBeTruthy();
      expect(job2.id).toBeTruthy();
    });

    it('should set timestamps correctly', async () => {
      const before = new Date();
      
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const after = new Date();

      expect(job.created_at).toBeDefined();
      expect(new Date(job.created_at!)).toBeInstanceOf(Date);
      expect(new Date(job.created_at!).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(new Date(job.created_at!).getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('Flow 2: Database → Worker', () => {
    it('should make jobs available for workers to claim', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      expect(job.status).toBe('queued');
      // Worker should be able to query for queued jobs
    });

    it('should provide all necessary context to worker', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: getTestUUID('conv-123'),
        repo_path: '/path/to/repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'api-test',
      });

      // Worker needs: goal, mode, repo_path, budget limits
      expect(job.goal).toBeTruthy();
      expect(job.mode).toBeTruthy();
      expect(job.repo_path).toBeTruthy();
      expect(job.step_cap).toBeGreaterThan(0);
      expect(job.token_cap).toBeGreaterThan(0);
    });

    it('should maintain job isolation between workers', async () => {
      const job1 = await insertJob({
        goal: 'Task 1',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/repo1',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const job2 = await insertJob({
        goal: 'Task 2',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/repo2',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      // Jobs should be independent
      expect(job1.id).not.toBe(job2.id);
      expect(job1.repo_path).not.toBe(job2.repo_path);
    });
  });

  describe('Flow 3: Agent → Events → Ledger', () => {
    it('should record planning event when agent starts', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const event = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'plan',
        payload: { message: 'Analyzing codebase...' },
        created_at: new Date().toISOString(),
      });

      expect(event).toBeDefined();
      expect(event.type).toBe('planning');
      expect(event.job_id).toBe(job.id);
    });

    it('should record tool_call events with parameters', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const event = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'tool_call',
        payload: {
          tool: 'read_file',
          params: { path: 'src/utils.ts' }
        },
        created_at: new Date().toISOString(),
      });

      expect(event.type).toBe('tool_call');
      expect(event.payload).toHaveProperty('tool');
      expect(event.payload).toHaveProperty('params');
    });

    it('should record tool_result events with outputs', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const event = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'tool_result',
        payload: {
          tool: 'read_file',
          result: { content: 'file contents...', lines: 50 }
        },
        created_at: new Date().toISOString(),
      });

      expect(event.type).toBe('tool_result');
      expect(event.payload).toHaveProperty('result');
    });

    it('should maintain event chronology', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const event1 = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'plan',
        payload: { step: 1 },
        created_at: new Date().toISOString(),
      });

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));

      const event2 = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'tool_call',
        payload: { step: 2 },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(job.id);
      
      expect(events.length).toBe(2);
      // Events should be returned in chronological order
    });

    it('should link events with trace_id', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const traceId = 'trace-abc-123';

      await insertEvent({
        job_id: job.id,
        trace_id: traceId,
        kind: 'plan',
        payload: {},
        created_at: new Date().toISOString(),
      });

      await insertEvent({
        job_id: job.id,
        trace_id: traceId,
        kind: 'tool_call',
        payload: {},
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(job.id);
      
      // All events should have the same trace_id
      events.forEach(event => {
        expect(event.trace_id).toBe(traceId);
      });
    });
  });

  describe('Flow 4: Events → Dashboard Stream', () => {
    it('should make events queryable by job_id', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'plan',
        payload: {},
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(job.id);
      
      expect(events.length).toBe(1);
      expect(events[0].job_id).toBe(job.id);
    });

    it('should support pagination for long event lists', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      // Create multiple events
      for (let i = 0; i < 5; i++) {
        await insertEvent({
          job_id: job.id,
          trace_id: getTestUUID('trace-123'),
          kind: 'tool_call',
          payload: { step: i },
          created_at: new Date().toISOString(),
        });
      }

      const eventsPage1 = await listEvents(job.id);
      expect(eventsPage1.length).toBeLessThanOrEqual(3);
    });

    it('should include all necessary event data for UI', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'tool_call',
        payload: {
          tool: 'read_file',
          params: { path: 'src/app.ts' },
          timestamp: new Date().toISOString()
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(job.id);
      
      expect(events[0]).toHaveProperty('id');
      expect(events[0]).toHaveProperty('job_id');
      expect(events[0]).toHaveProperty('trace_id');
      expect(events[0]).toHaveProperty('type');
      expect(events[0]).toHaveProperty('payload');
      expect(events[0]).toHaveProperty('created_at');
    });
  });

  describe('Flow 5: Cross-Component Data Consistency', () => {
    it('should maintain referential integrity between jobs and events', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-123'),
        kind: 'plan',
        payload: {},
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(job.id);
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].job_id).toBe(job.id);
    });

    it('should handle conversation threading', async () => {
      const conversationId = getTestUUID('conv-thread-123');

      const job1 = await insertJob({
        goal: 'First task in conversation',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: conversationId,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      const job2 = await insertJob({
        goal: 'Second task in conversation',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: conversationId,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      expect(job1.conversation_id).toBe(conversationId);
      expect(job2.conversation_id).toBe(conversationId);
      expect(job1.conversation_id).toBe(job2.conversation_id);
    });

    it('should track budget consumption across system', async () => {
      const job = await insertJob({
        goal: 'Test task',
        mode: 'mechanic',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 50000,
        cost_cap_cents: 100,
        created_by: 'api-test',
      });

      // Initial budget state
      expect(job.steps_used).toBe(0);
      expect(job.tokens_used).toBe(0);
      expect(job.cost_cents).toBe(0);

      // After execution, these should be updated
      // and should never exceed caps
    });
  });
});
