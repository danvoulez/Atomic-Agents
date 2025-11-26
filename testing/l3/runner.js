/**
 * L3 Batch Test Runner
 * 
 * Runs multiple jobs through the full system with real queue processing,
 * multiple workers, and comprehensive metrics collection.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import pg from 'pg';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const { Pool } = pg;

// Configuration
const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:testpassword@localhost:55434/ai_coding_team_l3',
  dashboardUrl: process.env.DASHBOARD_URL || 'http://localhost:3001',
  scenariosPath: process.env.SCENARIOS_PATH || './scenarios',
  resultsPath: process.env.RESULTS_PATH || './results',
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '5'),
  jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '300000'), // 5 minutes
};

// Database connection
const pool = new Pool({ connectionString: config.databaseUrl });

// Prometheus metrics
const register = new Registry();

const jobsTotal = new Counter({
  name: 'l3_jobs_total',
  help: 'Total number of jobs processed',
  labelNames: ['status', 'type', 'mode'],
  registers: [register],
});

const jobDuration = new Histogram({
  name: 'l3_job_duration_ms',
  help: 'Job duration in milliseconds',
  labelNames: ['type', 'mode'],
  buckets: [1000, 5000, 10000, 30000, 60000, 120000, 300000],
  registers: [register],
});

const jobSteps = new Histogram({
  name: 'l3_job_steps',
  help: 'Number of steps per job',
  labelNames: ['type', 'mode'],
  buckets: [1, 3, 5, 10, 15, 20, 30, 50],
  registers: [register],
});

const jobTokens = new Histogram({
  name: 'l3_job_tokens',
  help: 'Tokens used per job',
  labelNames: ['type', 'mode'],
  buckets: [1000, 5000, 10000, 20000, 50000, 100000],
  registers: [register],
});

const activeJobs = new Gauge({
  name: 'l3_active_jobs',
  help: 'Currently active jobs',
  registers: [register],
});

// Batch definitions
const batches = {
  easy: {
    name: 'Easy Batch (10 trivial bugs)',
    scenarios: Array(10).fill('bug-trivial.yaml'),
  },
  mixed: {
    name: 'Mixed Batch (5 easy, 5 hard)',
    scenarios: [
      ...Array(5).fill('bug-trivial.yaml'),
      ...Array(3).fill('bug-unclear.yaml'),
      ...Array(2).fill('feature-simple.yaml'),
    ],
  },
  all: {
    name: 'All Scenarios',
    scenarios: [
      'bug-trivial.yaml',
      'bug-unclear.yaml',
      'bug-large-fix.yaml',
      'feature-simple.yaml',
      'review-approve.yaml',
      'review-reject.yaml',
    ],
  },
};

// Load scenario from YAML
function loadScenario(filename) {
  const filepath = path.join(config.scenariosPath, filename);
  if (!fs.existsSync(filepath)) {
    console.warn(`Scenario not found: ${filepath}`);
    return null;
  }
  const content = fs.readFileSync(filepath, 'utf-8');
  return yaml.load(content);
}

// Create a job in the database
async function createJob(scenario) {
  const jobId = crypto.randomUUID();
  
  await pool.query(`
    INSERT INTO jobs (id, goal, mode, status, step_cap, token_cap, created_at)
    VALUES ($1, $2, $3, 'queued', $4, $5, NOW())
  `, [
    jobId,
    scenario.input?.goal || 'L3 test job',
    scenario.mode || 'mechanic',
    scenario.input?.constraints?.stepCap || 20,
    scenario.input?.constraints?.tokenCap || 50000,
  ]);
  
  return jobId;
}

// Wait for job completion
async function waitForJob(jobId, timeoutMs) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const result = await pool.query(
      'SELECT status, steps_used, tokens_used, started_at, finished_at FROM jobs WHERE id = $1',
      [jobId]
    );
    
    const job = result.rows[0];
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    if (['succeeded', 'failed', 'waiting_human', 'aborted'].includes(job.status)) {
      const duration = job.finished_at && job.started_at
        ? new Date(job.finished_at) - new Date(job.started_at)
        : Date.now() - startTime;
      
      return {
        status: job.status,
        stepsUsed: job.steps_used || 0,
        tokensUsed: job.tokens_used || 0,
        durationMs: duration,
      };
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Timeout - try to cancel the job
  await pool.query(
    "UPDATE jobs SET status = 'cancelling', cancel_requested_at = NOW() WHERE id = $1",
    [jobId]
  );
  
  return {
    status: 'timeout',
    stepsUsed: 0,
    tokensUsed: 0,
    durationMs: timeoutMs,
  };
}

// Run a single scenario
async function runScenario(scenarioFile, index) {
  const scenario = loadScenario(scenarioFile);
  if (!scenario) {
    return {
      scenario: scenarioFile,
      index,
      passed: false,
      error: 'Scenario file not found',
    };
  }
  
  console.log(`[${index}] Starting: ${scenario.name || scenarioFile}`);
  activeJobs.inc();
  
  try {
    const jobId = await createJob(scenario);
    const result = await waitForJob(jobId, config.jobTimeoutMs);
    
    // Record metrics
    const type = scenario.type || 'unknown';
    const mode = scenario.mode || 'mechanic';
    
    jobsTotal.inc({ status: result.status, type, mode });
    jobDuration.observe({ type, mode }, result.durationMs);
    jobSteps.observe({ type, mode }, result.stepsUsed);
    jobTokens.observe({ type, mode }, result.tokensUsed);
    
    // Check if passed expectations
    const passed = checkExpectations(result, scenario.expectations);
    
    console.log(`[${index}] ${passed ? '✓' : '✗'} ${scenario.name} - ${result.status} (${result.durationMs}ms)`);
    
    return {
      scenario: scenarioFile,
      name: scenario.name,
      index,
      passed,
      jobId,
      result,
    };
  } catch (error) {
    console.error(`[${index}] Error: ${scenarioFile}`, error.message);
    return {
      scenario: scenarioFile,
      index,
      passed: false,
      error: error.message,
    };
  } finally {
    activeJobs.dec();
  }
}

// Check if result meets expectations
function checkExpectations(result, expectations) {
  if (!expectations) return true;
  
  if (expectations.final_status && result.status !== expectations.final_status) {
    return false;
  }
  
  if (expectations.max_steps && result.stepsUsed > expectations.max_steps) {
    return false;
  }
  
  return true;
}

// Run a batch of scenarios
async function runBatch(batchName) {
  const batch = batches[batchName];
  if (!batch) {
    console.error(`Unknown batch: ${batchName}`);
    process.exit(1);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`L3 BATCH TEST: ${batch.name}`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Total scenarios: ${batch.scenarios.length}`);
  console.log(`Max concurrent: ${config.maxConcurrentJobs}`);
  console.log(`Job timeout: ${config.jobTimeoutMs}ms`);
  console.log();
  
  const startTime = Date.now();
  const results = [];
  
  // Run scenarios with concurrency limit
  const queue = batch.scenarios.map((s, i) => ({ scenario: s, index: i }));
  const running = new Set();
  
  while (queue.length > 0 || running.size > 0) {
    // Start new jobs up to limit
    while (running.size < config.maxConcurrentJobs && queue.length > 0) {
      const { scenario, index } = queue.shift();
      const promise = runScenario(scenario, index).then(result => {
        results.push(result);
        running.delete(promise);
      });
      running.add(promise);
    }
    
    // Wait for at least one to complete
    if (running.size > 0) {
      await Promise.race([...running]);
    }
  }
  
  const totalTime = Date.now() - startTime;
  
  // Generate report
  printReport(results, batch.name, totalTime);
  saveResults(results, batchName, totalTime);
  
  return results;
}

// Print results report
function printReport(results, batchName, totalTime) {
  console.log(`\n${'='.repeat(60)}`);
  console.log('L3 BATCH RESULTS');
  console.log(`${'='.repeat(60)}\n`);
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`Batch: ${batchName}`);
  console.log(`Total: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Pass Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log(`Total Time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log();
  
  // Per-scenario breakdown
  console.log('SCENARIO RESULTS:');
  console.log('-'.repeat(60));
  
  for (const result of results.sort((a, b) => a.index - b.index)) {
    const status = result.passed ? '✓' : '✗';
    const duration = result.result?.durationMs
      ? `${(result.result.durationMs / 1000).toFixed(1)}s`
      : 'N/A';
    const steps = result.result?.stepsUsed || 'N/A';
    
    console.log(`${status} ${result.name || result.scenario}`);
    console.log(`  Status: ${result.result?.status || result.error}`);
    console.log(`  Duration: ${duration} | Steps: ${steps}`);
  }
  
  console.log(`\n${'='.repeat(60)}\n`);
}

// Save results to file
function saveResults(results, batchName, totalTime) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `l3-${batchName}-${timestamp}.json`;
  const filepath = path.join(config.resultsPath, filename);
  
  if (!fs.existsSync(config.resultsPath)) {
    fs.mkdirSync(config.resultsPath, { recursive: true });
  }
  
  const report = {
    batch: batchName,
    timestamp: new Date().toISOString(),
    totalTimeMs: totalTime,
    summary: {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
    },
    results,
  };
  
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`Results saved to: ${filepath}`);
}

// Metrics endpoint for Prometheus
import http from 'http';

function startMetricsServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  
  server.listen(9100, () => {
    console.log('Metrics server listening on :9100');
  });
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  let batchName = 'easy';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      batchName = args[i + 1];
    }
  }
  
  startMetricsServer();
  
  try {
    const results = await runBatch(batchName);
    const passed = results.filter(r => r.passed).length;
    const passRate = (passed / results.length) * 100;
    
    // Exit with error if pass rate is below threshold
    if (passRate < 80) {
      console.error(`Pass rate ${passRate.toFixed(1)}% is below 80% threshold`);
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('L3 batch failed:', error);
    process.exit(1);
  }
}

main();

