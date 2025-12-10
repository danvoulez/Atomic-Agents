/**
 * HTTP Server for Worker Metrics
 *
 * Exposes a /metrics endpoint for Prometheus scraping and a /health endpoint
 * for Kubernetes liveness probes.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { exportPrometheusMetrics } from "./metrics";
import { getLogger } from "./logger";

const logger = getLogger().child({ component: "http-server" });

const DEFAULT_PORT = 9090;

interface MetricsServerOptions {
  port?: number;
}

let server: ReturnType<typeof createServer> | null = null;

/**
 * Handle incoming HTTP requests
 */
function requestHandler(req: IncomingMessage, res: ServerResponse): void {
  const { url, method } = req;

  logger.debug("HTTP request", { method, url });

  // Health check endpoint
  if (url === "/health" || url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "healthy", timestamp: new Date().toISOString() }));
    return;
  }

  // Readiness check endpoint
  if (url === "/ready" || url === "/readyz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ready", timestamp: new Date().toISOString() }));
    return;
  }

  // Prometheus metrics endpoint
  if (url === "/metrics") {
    const metrics = exportPrometheusMetrics();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(metrics);
    return;
  }

  // Not found
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not Found" }));
}

/**
 * Start the metrics HTTP server
 */
export function startMetricsServer(options: MetricsServerOptions = {}): void {
  if (server) {
    logger.warn("Metrics server already running");
    return;
  }

  const port = options.port ?? parseInt(process.env.METRICS_PORT ?? String(DEFAULT_PORT), 10);

  server = createServer(requestHandler);

  server.listen(port, () => {
    logger.info("Metrics server started", { port });
    logger.info(`  Health:  http://localhost:${port}/health`);
    logger.info(`  Metrics: http://localhost:${port}/metrics`);
  });

  server.on("error", (err) => {
    logger.error("Metrics server error", err);
  });
}

/**
 * Stop the metrics HTTP server
 */
export function stopMetricsServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      logger.info("Metrics server stopped");
      server = null;
      resolve();
    });
  });
}

/**
 * Get metrics server status
 */
export function isMetricsServerRunning(): boolean {
  return server !== null && server.listening;
}
