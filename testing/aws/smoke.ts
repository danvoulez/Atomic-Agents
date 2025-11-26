/**
 * AWS Staging Smoke Tests
 * 
 * Basic health checks and simple job runs against AWS staging environment.
 * These tests verify that the deployed infrastructure is working correctly.
 */

import https from "https";

interface SmokeConfig {
  apiUrl: string;
  dashboardUrl: string;
  region: string;
  environment: "staging" | "production";
}

interface SmokeResult {
  name: string;
  passed: boolean;
  duration: number;
  details: string;
}

const config: SmokeConfig = {
  apiUrl: process.env.API_URL || "https://api.staging.ai-coding-team.example.com",
  dashboardUrl: process.env.DASHBOARD_URL || "https://staging.ai-coding-team.example.com",
  region: process.env.AWS_REGION || "us-east-1",
  environment: (process.env.ENVIRONMENT as "staging" | "production") || "staging",
};

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

async function httpPost(
  url: string,
  data: unknown
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });

    req.write(postData);
    req.end();
  });
}

// =============================================================================
// Smoke Tests
// =============================================================================

async function checkApiHealth(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status, body } = await httpGet(`${config.apiUrl}/health`);
    const duration = Date.now() - start;

    if (status === 200) {
      const data = JSON.parse(body);
      return {
        name: "API Health",
        passed: data.status === "ok",
        duration,
        details: `Status: ${data.status}, DB: ${data.database || "unknown"}`,
      };
    }

    return {
      name: "API Health",
      passed: false,
      duration,
      details: `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "API Health",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function checkDashboard(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status } = await httpGet(config.dashboardUrl);
    const duration = Date.now() - start;

    return {
      name: "Dashboard",
      passed: status === 200,
      duration,
      details: `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "Dashboard",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function checkDatabaseConnectivity(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status, body } = await httpGet(`${config.apiUrl}/health/db`);
    const duration = Date.now() - start;

    if (status === 200) {
      const data = JSON.parse(body);
      return {
        name: "Database",
        passed: data.connected === true,
        duration,
        details: `Connected: ${data.connected}, Latency: ${data.latency || "N/A"}ms`,
      };
    }

    return {
      name: "Database",
      passed: false,
      duration,
      details: `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "Database",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function checkJobsEndpoint(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status, body } = await httpGet(`${config.apiUrl}/api/jobs?limit=1`);
    const duration = Date.now() - start;

    if (status === 200) {
      const data = JSON.parse(body);
      return {
        name: "Jobs API",
        passed: Array.isArray(data.jobs),
        duration,
        details: `Retrieved ${data.jobs?.length || 0} jobs`,
      };
    }

    return {
      name: "Jobs API",
      passed: false,
      duration,
      details: `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "Jobs API",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function createTestJob(): Promise<SmokeResult> {
  // Only run in staging
  if (config.environment !== "staging") {
    return {
      name: "Create Test Job",
      passed: true,
      duration: 0,
      details: "Skipped in production",
    };
  }

  const start = Date.now();
  try {
    const { status, body } = await httpPost(`${config.apiUrl}/api/jobs`, {
      goal: "Smoke test: Add a comment to README.md",
      mode: "mechanic",
      repo: "smoke-test-repo",
    });

    const duration = Date.now() - start;

    if (status === 201 || status === 200) {
      const data = JSON.parse(body);
      return {
        name: "Create Test Job",
        passed: !!data.id,
        duration,
        details: `Job ID: ${data.id || "N/A"}`,
      };
    }

    return {
      name: "Create Test Job",
      passed: false,
      duration,
      details: `HTTP ${status}: ${body}`,
    };
  } catch (error) {
    return {
      name: "Create Test Job",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function checkWorkerActivity(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status, body } = await httpGet(`${config.apiUrl}/api/workers`);
    const duration = Date.now() - start;

    if (status === 200) {
      const data = JSON.parse(body);
      const activeWorkers = data.workers?.filter(
        (w: { status: string }) => w.status === "active"
      ).length || 0;

      return {
        name: "Worker Activity",
        passed: activeWorkers > 0,
        duration,
        details: `Active workers: ${activeWorkers}`,
      };
    }

    return {
      name: "Worker Activity",
      passed: false,
      duration,
      details: `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "Worker Activity",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

async function checkMetrics(): Promise<SmokeResult> {
  const start = Date.now();
  try {
    const { status, body } = await httpGet(`${config.apiUrl}/metrics`);
    const duration = Date.now() - start;

    return {
      name: "Metrics Endpoint",
      passed: status === 200 && body.includes("jobs_total"),
      duration,
      details: status === 200 ? "Metrics available" : `HTTP ${status}`,
    };
  } catch (error) {
    return {
      name: "Metrics Endpoint",
      passed: false,
      duration: Date.now() - start,
      details: String(error),
    };
  }
}

// =============================================================================
// Main Runner
// =============================================================================

async function runSmokeTests(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("AWS STAGING SMOKE TESTS");
  console.log("=".repeat(60) + "\n");
  console.log(`Environment: ${config.environment}`);
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Dashboard URL: ${config.dashboardUrl}`);
  console.log(`Region: ${config.region}`);
  console.log();

  const tests = [
    checkApiHealth,
    checkDashboard,
    checkDatabaseConnectivity,
    checkJobsEndpoint,
    createTestJob,
    checkWorkerActivity,
    checkMetrics,
  ];

  const results: SmokeResult[] = [];

  for (const test of tests) {
    const result = await test();
    results.push(result);

    const status = result.passed ? "✓" : "✗";
    console.log(`${status} ${result.name}`);
    console.log(`  Duration: ${result.duration}ms`);
    console.log(`  Details: ${result.details}`);
    console.log();
  }

  // Summary
  console.log("=".repeat(60));
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const result of results.filter((r) => !r.passed)) {
      console.log(`  - ${result.name}: ${result.details}`);
    }
  }

  console.log("=".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
}

runSmokeTests();

