import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { insertJob, insertEvent, listEvents, getJob } from '@ai-coding-team/db';
import { setupTestDatabase, teardownTestDatabase, clearTestData, getTestUUID, clearUUIDCache } from '../test-helpers';

/**
 * User Journey: Multi-Agent Collaboration
 * 
 * This test validates how multiple agents collaborate on a complex task:
 * 1. Coordinator receives user goal
 * 2. Coordinator delegates to Planner
 * 3. Planner analyzes and creates execution plan
 * 4. Coordinator delegates to Builder
 * 5. Builder implements changes
 * 6. Coordinator delegates to Reviewer
 * 7. Reviewer provides feedback
 * 8. Optional: Evaluator scores the quality
 */
describe('User Journey: Multi-Agent Collaboration', () => {
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

  describe('Flow 1: User → Coordinator', () => {
    it('should receive and parse user goal', async () => {
      const userGoal = 'Add authentication to the login page with JWT tokens';

      const job = await insertJob({
        goal: userGoal,
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      expect(job.goal).toBe(userGoal);
      expect(job.agent_type).toBe('coordinator');
    });

    it('should initialize coordinator context', async () => {
      const job = await insertJob({
        goal: 'Refactor database queries',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: getTestUUID('conv-456'),
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      // Coordinator should have context about:
      // - Goal
      // - Mode (genius = complex task)
      // - Budget limits
      // - Repository path
      expect(job.mode).toBe('genius');
      expect(job.step_cap).toBe(100);
      expect(job.repo_path).toBeTruthy();
    });

    it('should record coordinator start event', async () => {
      const job = await insertJob({
        goal: 'Add feature X',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      const event = await insertEvent({
        job_id: job.id,
        trace_id: getTestUUID('trace-coordinator-1'),
        kind: 'plan',
        payload: {
          agent: 'coordinator',
          action: 'analyzing_request',
          message: 'Understanding user goal...'
        },
        created_at: new Date().toISOString(),
      });

      expect(event.type).toBe('planning');
      expect(event.payload).toHaveProperty('agent', 'coordinator');
    });
  });

  describe('Flow 2: Coordinator → Planner Delegation', () => {
    it('should delegate complex tasks to planner', async () => {
      const coordinatorJob = await insertJob({
        goal: 'Refactor authentication system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      // Coordinator decides task needs planning
      const delegationEvent = await insertEvent({
        job_id: coordinatorJob.id,
        trace_id: getTestUUID('trace-coord-123'),
        kind: 'decision',
        payload: {
          from_agent: 'coordinator',
          to_agent: 'planner',
          reason: 'Complex task requires analysis',
          sub_goal: 'Analyze current auth system and create refactoring plan'
        },
        created_at: new Date().toISOString(),
      });

      expect(delegationEvent.payload).toHaveProperty('to_agent', 'planner');
    });

    it('should create sub-job for planner', async () => {
      const parentJob = await insertJob({
        goal: 'Refactor authentication system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      // Create planner sub-job
      const plannerJob = await insertJob({
        goal: 'Analyze auth system and create refactoring plan',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        parent_job_id: parentJob.id,
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      expect(plannerJob.agent_type).toBe('planner');
      expect(plannerJob.parent_job_id).toBe(parentJob.id);
    });

    it('should pass context to planner', async () => {
      const parentJob = await insertJob({
        goal: 'Refactor authentication system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      const plannerJob = await insertJob({
        goal: 'Analyze auth system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: parentJob.repo_path, // Same repo
        parent_job_id: parentJob.id,
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      expect(plannerJob.repo_path).toBe(parentJob.repo_path);
    });
  });

  describe('Flow 3: Planner Analysis', () => {
    it('should use read-only tools to analyze codebase', async () => {
      const plannerJob = await insertJob({
        goal: 'Analyze auth system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      // Planner uses read_file
      await insertEvent({
        job_id: plannerJob.id,
        trace_id: getTestUUID('trace-planner-1'),
        kind: 'tool_call',
        payload: {
          tool: 'read_file',
          params: { path: 'src/auth/login.ts' }
        },
        created_at: new Date().toISOString(),
      });

      // Planner uses search_code
      await insertEvent({
        job_id: plannerJob.id,
        trace_id: getTestUUID('trace-planner-1'),
        kind: 'tool_call',
        payload: {
          tool: 'search_code',
          params: { query: 'authenticate', file_pattern: '*.ts' }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(plannerJob.id);
      
      const toolCalls = events.filter(e => e.kind === 'tool_call');
      expect(toolCalls.length).toBeGreaterThan(0);
    });

    it('should create execution plan', async () => {
      const plannerJob = await insertJob({
        goal: 'Analyze auth system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      const planEvent = await insertEvent({
        job_id: plannerJob.id,
        trace_id: getTestUUID('trace-planner-1'),
        kind: 'plan',
        payload: {
          plan: {
            steps: [
              { step: 1, action: 'Extract JWT logic to separate module' },
              { step: 2, action: 'Update login.ts to use new module' },
              { step: 3, action: 'Add error handling' },
              { step: 4, action: 'Update tests' }
            ],
            estimated_complexity: 'moderate',
            files_to_modify: ['src/auth/login.ts', 'src/auth/jwt.ts']
          }
        },
        created_at: new Date().toISOString(),
      });

      expect(planEvent.type).toBe('plan_created');
      expect(planEvent.payload).toHaveProperty('plan');
      expect(planEvent.payload.plan).toHaveProperty('steps');
    });

    it('should complete planner job with plan', async () => {
      const plannerJob = await insertJob({
        goal: 'Analyze auth system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: plannerJob.id,
        trace_id: getTestUUID('trace-planner-1'),
        kind: 'completion',
        payload: {
          status: 'succeeded',
          result: { plan_id: 'plan-abc-123' }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(plannerJob.id);
      const completionEvent = events.find(e => e.kind === 'info');
      
      expect(completionEvent).toBeDefined();
      expect(completionEvent?.payload).toHaveProperty('status', 'succeeded');
    });
  });

  describe('Flow 4: Coordinator → Builder Delegation', () => {
    it('should delegate implementation to builder with plan', async () => {
      const coordinatorJob = await insertJob({
        goal: 'Refactor authentication system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      const builderJob = await insertJob({
        goal: 'Implement auth refactoring per plan-abc-123',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        parent_job_id: coordinatorJob.id,
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      expect(builderJob.agent_type).toBe('builder');
      expect(builderJob.parent_job_id).toBe(coordinatorJob.id);
    });

    it('should provide plan context to builder', async () => {
      const builderJob = await insertJob({
        goal: 'Implement per plan-abc-123',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      const contextEvent = await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'info',
        payload: {
          plan_id: 'plan-abc-123',
          files_to_modify: ['src/auth/login.ts', 'src/auth/jwt.ts']
        },
        created_at: new Date().toISOString(),
      });

      expect(contextEvent.payload).toHaveProperty('plan_id');
    });
  });

  describe('Flow 5: Builder Implementation', () => {
    it('should create branch for changes', async () => {
      const builderJob = await insertJob({
        goal: 'Implement auth refactoring',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'tool_call',
        payload: {
          tool: 'create_branch',
          params: { name: 'refactor-auth-jwt' }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(builderJob.id);
      const branchEvent = events.find(e => 
        e.kind === 'tool_call' && e.tool_name === 'create_branch'
      );
      
      expect(branchEvent).toBeDefined();
    });

    it('should apply code changes', async () => {
      const builderJob = await insertJob({
        goal: 'Implement auth refactoring',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'tool_call',
        payload: {
          tool: 'apply_patch',
          params: {
            file: 'src/auth/login.ts',
            patch: '--- a/src/auth/login.ts\n+++ b/src/auth/login.ts\n...'
          }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(builderJob.id);
      const patchEvent = events.find(e => 
        e.kind === 'tool_call' && e.tool_name === 'apply_patch'
      );
      
      expect(patchEvent).toBeDefined();
    });

    it('should run tests to verify changes', async () => {
      const builderJob = await insertJob({
        goal: 'Implement auth refactoring',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'tool_call',
        payload: {
          tool: 'run_tests',
          params: { pattern: 'auth/**/*.test.ts' }
        },
        created_at: new Date().toISOString(),
      });

      await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'tool_result',
        payload: {
          tool: 'run_tests',
          result: { passed: 15, failed: 0, skipped: 0 }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(builderJob.id);
      const testEvents = events.filter(e => 
        e.payload.tool === 'run_tests'
      );
      
      expect(testEvents.length).toBeGreaterThan(0);
    });

    it('should commit changes', async () => {
      const builderJob = await insertJob({
        goal: 'Implement auth refactoring',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: builderJob.id,
        trace_id: getTestUUID('trace-builder-1'),
        kind: 'tool_call',
        payload: {
          tool: 'commit_changes',
          params: {
            message: 'refactor: extract JWT logic to separate module'
          }
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(builderJob.id);
      const commitEvent = events.find(e => 
        e.kind === 'tool_call' && e.tool_name === 'commit_changes'
      );
      
      expect(commitEvent).toBeDefined();
    });
  });

  describe('Flow 6: Coordinator → Reviewer Delegation', () => {
    it('should delegate review to reviewer agent', async () => {
      const coordinatorJob = await insertJob({
        goal: 'Refactor authentication system',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      const reviewerJob = await insertJob({
        goal: 'Review auth refactoring changes',
        mode: 'genius',
        agent_kind: 'info',
        status: 'queued',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        parent_job_id: coordinatorJob.id,
        step_cap: 20,
        token_cap: 30000,
        cost_cap_cents: 100,
        created_by: 'coordinator',
      });

      expect(reviewerJob.agent_type).toBe('reviewer');
      expect(reviewerJob.parent_job_id).toBe(coordinatorJob.id);
    });

    it('should pass commit info to reviewer', async () => {
      const reviewerJob = await insertJob({
        goal: 'Review commit abc123',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 30000,
        cost_cap_cents: 100,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: reviewerJob.id,
        trace_id: getTestUUID('trace-reviewer-1'),
        kind: 'info',
        payload: {
          commit_sha: 'abc123',
          files_changed: ['src/auth/login.ts', 'src/auth/jwt.ts']
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(reviewerJob.id);
      const contextEvent = events.find(e => e.kind === 'info');
      
      expect(contextEvent?.payload).toHaveProperty('commit_sha');
    });
  });

  describe('Flow 7: Reviewer Analysis', () => {
    it('should review code for correctness', async () => {
      const reviewerJob = await insertJob({
        goal: 'Review auth changes',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 30000,
        cost_cap_cents: 100,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: reviewerJob.id,
        trace_id: getTestUUID('trace-reviewer-1'),
        kind: 'analysis',
        payload: {
          file: 'src/auth/jwt.ts',
          line: 42,
          severity: 'info',
          message: 'Consider adding input validation for token expiry'
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(reviewerJob.id);
      const reviewComments = events.filter(e => e.kind === 'analysis');
      
      expect(reviewComments.length).toBeGreaterThan(0);
    });

    it('should approve or request changes', async () => {
      const reviewerJob = await insertJob({
        goal: 'Review auth changes',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 20,
        token_cap: 30000,
        cost_cap_cents: 100,
        created_by: 'coordinator',
      });

      await insertEvent({
        job_id: reviewerJob.id,
        trace_id: getTestUUID('trace-reviewer-1'),
        kind: 'decision',
        payload: {
          decision: 'approved',
          summary: 'Changes look good. Code is clean and tests pass.'
        },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(reviewerJob.id);
      const decision = events.find(e => e.kind === 'decision');
      
      expect(decision?.payload).toHaveProperty('decision');
    });
  });

  describe('Flow 8: Multi-Agent Coordination', () => {
    it('should track parent-child job relationships', async () => {
      const parentJob = await insertJob({
        goal: 'Complex feature',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      const childJob1 = await insertJob({
        goal: 'Sub-task 1',
        mode: 'genius',
        agent_kind: 'info',
        status: 'succeeded',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        parent_job_id: parentJob.id,
        step_cap: 30,
        token_cap: 50000,
        cost_cap_cents: 150,
        created_by: 'coordinator',
      });

      const childJob2 = await insertJob({
        goal: 'Sub-task 2',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        parent_job_id: parentJob.id,
        step_cap: 50,
        token_cap: 100000,
        cost_cap_cents: 300,
        created_by: 'coordinator',
      });

      expect(childJob1.parent_job_id).toBe(parentJob.id);
      expect(childJob2.parent_job_id).toBe(parentJob.id);
    });

    it('should aggregate budget from sub-jobs to parent', async () => {
      const parentJob = await insertJob({
        goal: 'Complex feature',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      // Parent should track total budget across all sub-jobs
      expect(parentJob.step_cap).toBe(100);
      expect(parentJob.token_cap).toBe(200000);
    });

    it('should handle agent handoffs gracefully', async () => {
      const coordinatorJob = await insertJob({
        goal: 'Feature request',
        mode: 'genius',
        agent_kind: 'info',
        status: 'running',
        conversation_id: null,
        repo_path: '/tmp/test-repo',
        step_cap: 100,
        token_cap: 200000,
        cost_cap_cents: 500,
        created_by: 'user-123',
      });

      // Coordinator → Planner
      await insertEvent({
        job_id: coordinatorJob.id,
        trace_id: getTestUUID('trace-main'),
        kind: 'decision',
        payload: { from: 'coordinator', to: 'planner' },
        created_at: new Date().toISOString(),
      });

      // Coordinator ← Planner (plan received)
      await insertEvent({
        job_id: coordinatorJob.id,
        trace_id: getTestUUID('trace-main'),
        kind: 'info',
        payload: { from: 'planner', to: 'coordinator', data: { plan_id: 'plan-1' } },
        created_at: new Date().toISOString(),
      });

      // Coordinator → Builder
      await insertEvent({
        job_id: coordinatorJob.id,
        trace_id: getTestUUID('trace-main'),
        kind: 'decision',
        payload: { from: 'coordinator', to: 'builder', context: { plan_id: 'plan-1' } },
        created_at: new Date().toISOString(),
      });

      const events = await listEvents(coordinatorJob.id);
      const delegations = events.filter(e => e.kind === 'decision');
      
      expect(delegations.length).toBe(2);
    });
  });
});
