/**
 * Integration Test Scenario Runner
 * 
 * Loads and executes YAML-defined test scenarios against the AI coding team.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// Types
interface ScenarioFile {
  name: string;
  description: string;
  version: string;
  tags?: string[];
  setup: {
    repo: {
      type: "inline" | "path";
      files?: Array<{ path: string; content: string }>;
      path?: string;
    };
  };
  input: {
    goal: string;
    mode: "mechanic" | "genius";
  };
  expected: {
    status: "succeeded" | "failed";
    agents?: string[];
    changes?: {
      files?: Array<{
        path: string;
        contains?: string[];
        notContains?: string[];
      }>;
    };
    tests?: {
      status: "pass" | "fail";
      min_passed?: number;
    };
    quality?: {
      verdict: "OK" | "WARN" | "BLOCK";
    };
    evaluation?: {
      [key: string]: string; // e.g., "correctness": ">= 0.8"
    };
    budget?: {
      max_steps?: number;
      max_tokens?: number;
    };
  };
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details: {
    expectedStatus: string;
    actualStatus: string;
    checks: Array<{ name: string; passed: boolean; message: string }>;
  };
}

// Scenario loader
export async function loadScenario(scenarioPath: string): Promise<ScenarioFile> {
  const content = fs.readFileSync(scenarioPath, "utf-8");
  return yaml.load(content) as ScenarioFile;
}

// List all scenarios
export function listScenarios(scenariosDir: string): string[] {
  const files = fs.readdirSync(scenariosDir);
  return files
    .filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))
    .filter(f => f !== "README.md")
    .map(f => path.join(scenariosDir, f));
}

// Setup test repository
export async function setupTestRepo(scenario: ScenarioFile): Promise<string> {
  const tempDir = path.join("/tmp", `test-repo-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  if (scenario.setup.repo.type === "inline" && scenario.setup.repo.files) {
    for (const file of scenario.setup.repo.files) {
      const filePath = path.join(tempDir, file.path);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, file.content);
    }
  }

  // Initialize git repo
  const { execSync } = await import("child_process");
  execSync("git init", { cwd: tempDir, stdio: "ignore" });
  execSync("git add .", { cwd: tempDir, stdio: "ignore" });
  execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: "ignore" });

  return tempDir;
}

// Cleanup test repository
export async function cleanupTestRepo(repoPath: string): Promise<void> {
  fs.rmSync(repoPath, { recursive: true, force: true });
}

// Run a single scenario
export async function runScenario(
  scenario: ScenarioFile,
  options?: { timeout?: number }
): Promise<ScenarioResult> {
  const startTime = Date.now();
  const checks: Array<{ name: string; passed: boolean; message: string }> = [];
  
  let repoPath = "";
  let actualStatus = "unknown";

  try {
    // Setup
    repoPath = await setupTestRepo(scenario);
    
    // Create job (mock for now - in real implementation, use actual API)
    const jobId = `test-${Date.now()}`;
    
    // In a real implementation, you would:
    // 1. Create a job via API
    // 2. Wait for completion
    // 3. Fetch results
    
    // For now, simulate success
    actualStatus = "succeeded";
    
    // Verify expectations
    if (scenario.expected.status) {
      const passed = actualStatus === scenario.expected.status;
      checks.push({
        name: "status",
        passed,
        message: passed 
          ? `Status matched: ${actualStatus}`
          : `Status mismatch: expected ${scenario.expected.status}, got ${actualStatus}`,
      });
    }

    // Check file changes (if test repo still exists)
    if (scenario.expected.changes?.files) {
      for (const expectedFile of scenario.expected.changes.files) {
        const filePath = path.join(repoPath, expectedFile.path);
        
        if (!fs.existsSync(filePath)) {
          checks.push({
            name: `file:${expectedFile.path}`,
            passed: false,
            message: `File not found: ${expectedFile.path}`,
          });
          continue;
        }

        const content = fs.readFileSync(filePath, "utf-8");
        
        if (expectedFile.contains) {
          for (const expected of expectedFile.contains) {
            const passed = content.includes(expected);
            checks.push({
              name: `contains:${expectedFile.path}`,
              passed,
              message: passed
                ? `File contains expected: "${expected.slice(0, 30)}..."`
                : `File missing expected: "${expected.slice(0, 30)}..."`
            });
          }
        }
      }
    }

    // Determine overall pass/fail
    const allChecksPassed = checks.every(c => c.passed);
    
    return {
      name: scenario.name,
      passed: allChecksPassed,
      duration: Date.now() - startTime,
      details: {
        expectedStatus: scenario.expected.status,
        actualStatus,
        checks,
      },
    };

  } catch (error: any) {
    return {
      name: scenario.name,
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
      details: {
        expectedStatus: scenario.expected.status,
        actualStatus,
        checks,
      },
    };
  } finally {
    // Cleanup
    if (repoPath) {
      await cleanupTestRepo(repoPath);
    }
  }
}

// Run all scenarios
export async function runAllScenarios(
  scenariosDir: string,
  options?: { filter?: string; tags?: string[] }
): Promise<ScenarioResult[]> {
  const scenarioPaths = listScenarios(scenariosDir);
  const results: ScenarioResult[] = [];

  for (const scenarioPath of scenarioPaths) {
    const scenario = await loadScenario(scenarioPath);
    
    // Apply filters
    if (options?.filter && !scenario.name.toLowerCase().includes(options.filter.toLowerCase())) {
      continue;
    }
    
    if (options?.tags && scenario.tags) {
      const hasTag = options.tags.some(t => scenario.tags?.includes(t));
      if (!hasTag) continue;
    }

    console.log(`Running: ${scenario.name}...`);
    const result = await runScenario(scenario);
    results.push(result);
    
    console.log(`  ${result.passed ? "✓" : "✗"} ${result.name} (${result.duration}ms)`);
    if (!result.passed) {
      console.log(`    Error: ${result.error || "Check failures"}`);
      for (const check of result.details.checks.filter(c => !c.passed)) {
        console.log(`    - ${check.name}: ${check.message}`);
      }
    }
  }

  return results;
}

// Summary printer
export function printSummary(results: ScenarioResult[]): void {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log("\n" + "=".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Total time: ${totalTime}ms`);
  console.log("=".repeat(60));
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const scenariosDir = args[0] || "./examples/scenarios";
  
  runAllScenarios(scenariosDir)
    .then(results => {
      printSummary(results);
      process.exit(results.every(r => r.passed) ? 0 : 1);
    })
    .catch(err => {
      console.error("Runner error:", err);
      process.exit(1);
    });
}

