/**
 * L2 Test Runner
 * 
 * Runs individual agent job scenarios with mock LLM responses
 * for controlled, reproducible testing.
 */

import { Worker } from "../../src";
import { insertJob, getJob, listEvents, pool } from "@ai-coding-team/db";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { execSync } from "child_process";
import os from "os";

export interface L2Scenario {
  name: string;
  level: "L2";
  type: "bug_fix" | "feature" | "review" | "analyze";
  mode: "mechanic" | "genius";
  agent_type?: "builder" | "planner" | "reviewer" | "coordinator"; // Which agent to use directly
  
  setup: {
    repo: string;
    files?: {
      path: string;
      content?: string;
      inject_bug?: string;
    }[];
    branch?: string;
  };
  
  input: {
    goal: string;
    constraints?: {
      stepCap?: number;
      tokenCap?: number;
      timeLimitMs?: number;
    };
  };
  
  mockResponses?: {
    scenario: string;
  };
  
  expectations: {
    max_steps?: number;
    must_call?: string[];
    must_not_call?: string[];
    final_status: "succeeded" | "failed" | "waiting_human" | "aborted";
    patch_contains?: string;
    tests_pass?: boolean;
    escalation_reason?: string;
  };
}

/**
 * Determine which agent type to use based on scenario type
 */
function getAgentTypeForScenario(scenario: L2Scenario): string {
  // Use explicit agent_type if specified
  if (scenario.agent_type) {
    return scenario.agent_type;
  }
  
  // Default mapping based on scenario type
  switch (scenario.type) {
    case "bug_fix":
    case "feature":
      return "builder"; // Builder handles code changes directly
    case "review":
      return "reviewer";
    case "analyze":
      return "planner";
    default:
      return "builder";
  }
}

export interface L2Result {
  scenario: string;
  passed: boolean;
  job: {
    id: string;
    status: string;
    stepsUsed: number;
    tokensUsed: number;
  };
  toolsCalled: string[];
  violations: string[];
  duration: number;
}

/**
 * Load scenario from YAML file
 */
export function loadScenario(scenarioPath: string): L2Scenario {
  const content = fs.readFileSync(scenarioPath, "utf-8");
  return yaml.load(content) as L2Scenario;
}

/**
 * Set up test repository from scenario config
 */
export async function setupTestRepo(setup: L2Scenario["setup"]): Promise<string> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "l2-test-"));
  
  // Copy base repo if specified
  if (setup.repo) {
    // Fixtures are in the root /testing/fixtures/repos directory
    const sourceRepo = path.resolve(__dirname, "../../../../testing/fixtures/repos", setup.repo);
    if (fs.existsSync(sourceRepo)) {
      fs.cpSync(sourceRepo, tempDir, { recursive: true });
    } else {
      console.warn(`Fixture repo not found: ${sourceRepo}`);
    }
  }
  
  // Initialize git if not already
  if (!fs.existsSync(path.join(tempDir, ".git"))) {
    execSync("git init", { cwd: tempDir });
    execSync("git config user.email 'test@example.com'", { cwd: tempDir });
    execSync("git config user.name 'Test User'", { cwd: tempDir });
  }
  
  // Apply file modifications
  if (setup.files) {
    for (const file of setup.files) {
      const filePath = path.join(tempDir, file.path);
      const dirPath = path.dirname(filePath);
      
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
      
      if (file.content) {
        fs.writeFileSync(filePath, file.content);
      } else if (file.inject_bug && fs.existsSync(filePath)) {
        // Replace content with buggy version
        let content = fs.readFileSync(filePath, "utf-8");
        // Simple bug injection - replace first instance
        content = content.replace(/return x \* y/, file.inject_bug);
        fs.writeFileSync(filePath, content);
      }
    }
  }
  
  // Commit initial state
  execSync("git add .", { cwd: tempDir });
  try {
    execSync("git commit -m 'Test setup'", { cwd: tempDir });
  } catch {
    // Ignore if nothing to commit
  }
  
  // Switch to branch if specified
  if (setup.branch) {
    execSync(`git checkout -b ${setup.branch}`, { cwd: tempDir });
  }
  
  return tempDir;
}

/**
 * Create job from scenario input
 */
export async function createJob(
  input: L2Scenario["input"],
  repoPath: string,
  mode: "mechanic" | "genius"
): Promise<string> {
  const jobId = crypto.randomUUID();
  
  await insertJob({
    id: jobId,
    goal: input.goal,
    mode,
    repo_path: repoPath,
    status: "queued",
    step_cap: input.constraints?.stepCap ?? 20,
    token_cap: input.constraints?.tokenCap ?? 50000,
    agent_type: "coordinator",
  });
  
  return jobId;
}

/**
 * Verify expectations against job result
 */
export async function verifyExpectations(
  jobId: string,
  expectations: L2Scenario["expectations"],
  toolsCalled: string[],
  repoPath: string
): Promise<{ passed: boolean; violations: string[] }> {
  const violations: string[] = [];
  const job = await getJob(jobId);
  
  if (!job) {
    return { passed: false, violations: ["Job not found"] };
  }
  
  // Check final status
  if (job.status !== expectations.final_status) {
    violations.push(
      `Expected status '${expectations.final_status}', got '${job.status}'`
    );
  }
  
  // Check max steps
  if (expectations.max_steps && (job.steps_used ?? 0) > expectations.max_steps) {
    violations.push(
      `Exceeded max steps: ${job.steps_used} > ${expectations.max_steps}`
    );
  }
  
  // Check must_call tools
  if (expectations.must_call) {
    for (const tool of expectations.must_call) {
      if (!toolsCalled.includes(tool)) {
        violations.push(`Expected tool call not made: ${tool}`);
      }
    }
  }
  
  // Check must_not_call tools
  if (expectations.must_not_call) {
    for (const tool of expectations.must_not_call) {
      if (toolsCalled.includes(tool)) {
        violations.push(`Unexpected tool call made: ${tool}`);
      }
    }
  }
  
  // Check patch contents if applicable
  if (expectations.patch_contains) {
    const events = await listEvents(jobId);
    const patchEvents = events.filter(e => e.tool_name === "apply_patch");
    const patchContainsExpected = patchEvents.some(e => {
      const params = e.params as { patch?: string } | null;
      return params?.patch?.includes(expectations.patch_contains!);
    });
    
    if (!patchContainsExpected) {
      violations.push(`Patch does not contain expected string: ${expectations.patch_contains}`);
    }
  }
  
  // Check test pass status if applicable
  if (expectations.tests_pass !== undefined) {
    const events = await listEvents(jobId);
    const testEvents = events.filter(e => e.tool_name === "run_tests");
    const lastTestEvent = testEvents[testEvents.length - 1];
    
    if (lastTestEvent) {
      const result = lastTestEvent.result as { success?: boolean } | null;
      if (result?.success !== expectations.tests_pass) {
        violations.push(
          `Expected tests to ${expectations.tests_pass ? "pass" : "fail"}, but they ${result?.success ? "passed" : "failed"}`
        );
      }
    }
  }
  
  return { passed: violations.length === 0, violations };
}

/**
 * Run a single L2 scenario
 */
export async function runL2Scenario(scenarioPath: string): Promise<L2Result> {
  const startTime = Date.now();
  const scenario = loadScenario(scenarioPath);
  
  console.log(`Running L2 scenario: ${scenario.name}`);
  
  // Set up test repo
  const repoPath = await setupTestRepo(scenario.setup);
  
  // Create job in database for tracking
  const jobId = await createJob(scenario.input, repoPath, scenario.mode);
  
  // Configure mock LLM if specified
  if (scenario.mockResponses) {
    process.env.MOCK_LLM_SCENARIO = scenario.mockResponses.scenario;
  }
  
  // Determine which agent to use
  const agentType = getAgentTypeForScenario(scenario);
  console.log(`Using agent: ${agentType}`);
  
  // Run the agent directly using worker.handle()
  const worker = new Worker({ mode: scenario.mode });
  
  try {
    // Run the agent directly with the correct type
    await worker.handle(scenario.input.goal, {
      id: jobId,
      traceId: jobId,
      mode: scenario.mode,
      repoPath,
      agentType,
    });
  } catch (error) {
    console.error(`Scenario error:`, error);
  }
  
  // Get final job state
  let job = await getJob(jobId);
  
  // Collect tool calls from events
  const events = await listEvents(jobId);
  const toolsCalled = events
    .filter(e => e.kind === "tool_call")
    .map(e => e.tool_name!)
    .filter(Boolean);
  
  // Verify expectations
  const { passed, violations } = await verifyExpectations(
    jobId,
    scenario.expectations,
    toolsCalled,
    repoPath
  );
  
  // Clean up
  fs.rmSync(repoPath, { recursive: true, force: true });
  
  const duration = Date.now() - startTime;
  const finalJob = await getJob(jobId);
  
  return {
    scenario: scenario.name,
    passed,
    job: {
      id: jobId,
      status: finalJob?.status ?? "unknown",
      stepsUsed: finalJob?.steps_used ?? 0,
      tokensUsed: finalJob?.tokens_used ?? 0,
    },
    toolsCalled,
    violations,
    duration,
  };
}

/**
 * Run all L2 scenarios in a directory
 */
export async function runAllL2Scenarios(scenariosDir: string): Promise<L2Result[]> {
  const results: L2Result[] = [];
  const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith(".yaml"));
  
  for (const file of files) {
    try {
      const result = await runL2Scenario(path.join(scenariosDir, file));
      results.push(result);
    } catch (error) {
      console.error(`Error running scenario ${file}:`, error);
      results.push({
        scenario: file,
        passed: false,
        job: { id: "", status: "error", stepsUsed: 0, tokensUsed: 0 },
        toolsCalled: [],
        violations: [(error as Error).message],
        duration: 0,
      });
    }
  }
  
  return results;
}

/**
 * Print L2 results summary
 */
export function printL2Results(results: L2Result[]): void {
  console.log("\n" + "=".repeat(60));
  console.log("L2 TEST RESULTS");
  console.log("=".repeat(60) + "\n");
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  for (const result of results) {
    const status = result.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${status} ${result.scenario}`);
    console.log(`  Status: ${result.job.status}`);
    console.log(`  Steps: ${result.job.stepsUsed}`);
    console.log(`  Duration: ${result.duration}ms`);
    
    if (result.violations.length > 0) {
      console.log("  Violations:");
      for (const v of result.violations) {
        console.log(`    - ${v}`);
      }
    }
    console.log();
  }
  
  console.log("=".repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log(`Pass Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log("=".repeat(60));
}

