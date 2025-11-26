/**
 * AWS Canary Tests
 * 
 * Periodic real jobs run against staging to ensure the system is working.
 * Designed to be run on a schedule (e.g., every hour).
 */

import https from "https";

const config = {
  apiUrl: process.env.API_URL || "https://api.staging.ai-coding-team.example.com",
  testRepo: process.env.TEST_REPO || "staging-test-repo",
  timeout: parseInt(process.env.CANARY_TIMEOUT || "120000"), // 2 minutes
  slackWebhook: process.env.SLACK_WEBHOOK,
};

interface CanaryResult {
  success: boolean;
  jobId: string | null;
  status: string;
  duration: number;
  error?: string;
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

async function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
  });
}

async function createCanaryJob(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  
  const { status, body } = await httpPost(`${config.apiUrl}/api/jobs`, {
    goal: `[Canary ${timestamp}] Add a comment to README.md with timestamp`,
    mode: "mechanic",
    repo: config.testRepo,
    constraints: {
      stepCap: 10,
      tokenCap: 10000,
      timeLimitMs: config.timeout,
    },
  });

  if (status !== 201 && status !== 200) {
    throw new Error(`Failed to create job: HTTP ${status} - ${body}`);
  }

  const data = JSON.parse(body);
  return data.id;
}

async function waitForJobCompletion(
  jobId: string,
  timeout: number
): Promise<{ status: string; success: boolean }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const { status, body } = await httpGet(`${config.apiUrl}/api/jobs/${jobId}`);

    if (status !== 200) {
      throw new Error(`Failed to get job: HTTP ${status}`);
    }

    const job = JSON.parse(body);
    const jobStatus = job.status;

    if (["succeeded", "failed", "aborted", "waiting_human"].includes(jobStatus)) {
      return {
        status: jobStatus,
        success: jobStatus === "succeeded",
      };
    }

    // Wait before polling again
    await new Promise((r) => setTimeout(r, 5000));
  }

  return { status: "timeout", success: false };
}

async function sendSlackAlert(result: CanaryResult): Promise<void> {
  if (!config.slackWebhook) return;

  const color = result.success ? "#36a64f" : "#ff0000";
  const text = result.success
    ? `Canary passed: Job ${result.jobId} completed in ${result.duration}ms`
    : `Canary FAILED: ${result.error || result.status}`;

  try {
    await httpPost(config.slackWebhook, {
      attachments: [
        {
          color,
          title: "AI Coding Team Canary",
          text,
          fields: [
            { title: "Job ID", value: result.jobId || "N/A", short: true },
            { title: "Status", value: result.status, short: true },
            { title: "Duration", value: `${result.duration}ms`, short: true },
          ],
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    });
  } catch (error) {
    console.error("Failed to send Slack alert:", error);
  }
}

async function runCanary(): Promise<CanaryResult> {
  const startTime = Date.now();
  let jobId: string | null = null;

  console.log("\n" + "=".repeat(60));
  console.log("CANARY TEST");
  console.log("=".repeat(60) + "\n");
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Test Repo: ${config.testRepo}`);
  console.log(`Timeout: ${config.timeout}ms`);
  console.log();

  try {
    // Create canary job
    console.log("Creating canary job...");
    jobId = await createCanaryJob();
    console.log(`Job ID: ${jobId}`);

    // Wait for completion
    console.log("Waiting for completion...");
    const { status, success } = await waitForJobCompletion(jobId, config.timeout);

    const duration = Date.now() - startTime;
    console.log(`Status: ${status}`);
    console.log(`Duration: ${duration}ms`);

    const result: CanaryResult = {
      success,
      jobId,
      status,
      duration,
    };

    // Send alert if configured
    await sendSlackAlert(result);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);

    const result: CanaryResult = {
      success: false,
      jobId,
      status: "error",
      duration,
      error: errorMessage,
    };

    await sendSlackAlert(result);

    return result;
  }
}

async function main(): Promise<void> {
  const result = await runCanary();

  console.log("\n" + "=".repeat(60));
  console.log(result.success ? "CANARY PASSED" : "CANARY FAILED");
  console.log("=".repeat(60) + "\n");

  process.exit(result.success ? 0 : 1);
}

main();

