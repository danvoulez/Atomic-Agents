/**
 * API Middleware
 * 
 * Provides:
 * - Rate limiting
 * - CORS configuration
 * - Request validation
 * - Error handling
 */

import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// RATE LIMITING
// ============================================================================

interface RateLimitConfig {
  windowMs: number;       // Time window in ms
  maxRequests: number;    // Max requests per window
  keyGenerator?: (req: NextRequest) => string;
}

// In-memory rate limit store (would use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore) {
    if (value.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Every minute

/**
 * Rate limit configuration by endpoint pattern
 */
const rateLimitConfigs: Record<string, RateLimitConfig> = {
  "/api/jobs": { windowMs: 60000, maxRequests: 30 },
  "/api/chat": { windowMs: 60000, maxRequests: 60 },
  "/api/conversation": { windowMs: 60000, maxRequests: 100 },
  "/api/messages": { windowMs: 60000, maxRequests: 120 },
  "/api/events": { windowMs: 60000, maxRequests: 100 },
  default: { windowMs: 60000, maxRequests: 100 },
};

/**
 * Get rate limit config for a path
 */
function getRateLimitConfig(path: string): RateLimitConfig {
  for (const [pattern, config] of Object.entries(rateLimitConfigs)) {
    if (pattern !== "default" && path.startsWith(pattern)) {
      return config;
    }
  }
  return rateLimitConfigs.default;
}

/**
 * Check rate limit and return headers
 */
export function checkRateLimit(req: NextRequest): {
  allowed: boolean;
  headers: Record<string, string>;
  retryAfter?: number;
} {
  const config = getRateLimitConfig(req.nextUrl.pathname);
  
  // Generate key from IP + path
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || 
             req.headers.get("x-real-ip") || 
             "unknown";
  const key = `${ip}:${req.nextUrl.pathname}`;
  
  const now = Date.now();
  const entry = rateLimitStore.get(key);
  
  if (!entry || entry.resetAt < now) {
    // New window
    rateLimitStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return {
      allowed: true,
      headers: {
        "X-RateLimit-Limit": String(config.maxRequests),
        "X-RateLimit-Remaining": String(config.maxRequests - 1),
        "X-RateLimit-Reset": String(Math.ceil((now + config.windowMs) / 1000)),
      },
    };
  }
  
  entry.count++;
  
  if (entry.count > config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return {
      allowed: false,
      headers: {
        "X-RateLimit-Limit": String(config.maxRequests),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        "Retry-After": String(retryAfter),
      },
      retryAfter,
    };
  }
  
  return {
    allowed: true,
    headers: {
      "X-RateLimit-Limit": String(config.maxRequests),
      "X-RateLimit-Remaining": String(config.maxRequests - entry.count),
      "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
    },
  };
}

// ============================================================================
// CORS CONFIGURATION
// ============================================================================

/**
 * Allowed origins for CORS
 */
const ALLOWED_ORIGINS = [
  // Development
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  // Production - add your domains
  process.env.DASHBOARD_URL,
  process.env.API_URL,
].filter(Boolean) as string[];

/**
 * Check if origin is allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // Same-origin requests
  if (process.env.NODE_ENV === "development") return true; // Allow all in dev
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Get CORS headers for a request
 */
export function getCORSHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  
  if (!isOriginAllowed(origin)) {
    return {};
  }
  
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-ID, X-Trace-ID",
    "Access-Control-Max-Age": "86400", // 24 hours
    "Access-Control-Allow-Credentials": "true",
  };
  
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  
  return headers;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  statusCode: number;
}

export const API_ERRORS = {
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later.",
    statusCode: 429,
  },
  VALIDATION_ERROR: {
    code: "VALIDATION_ERROR",
    message: "Invalid request parameters",
    statusCode: 400,
  },
  NOT_FOUND: {
    code: "NOT_FOUND",
    message: "Resource not found",
    statusCode: 404,
  },
  INTERNAL_ERROR: {
    code: "INTERNAL_ERROR",
    message: "An unexpected error occurred",
    statusCode: 500,
  },
  BAD_REQUEST: {
    code: "BAD_REQUEST",
    message: "Invalid request",
    statusCode: 400,
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    message: "Access denied",
    statusCode: 403,
  },
} as const;

/**
 * Create error response
 */
export function createErrorResponse(
  error: typeof API_ERRORS[keyof typeof API_ERRORS],
  details?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details,
      },
    },
    { status: error.statusCode }
  );
}

// ============================================================================
// REQUEST HELPERS
// ============================================================================

/**
 * Add standard headers to response
 */
export function addStandardHeaders(
  response: NextResponse,
  req: NextRequest
): NextResponse {
  // Add CORS headers
  const corsHeaders = getCORSHeaders(req);
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  
  // Add rate limit headers
  const rateLimit = checkRateLimit(req);
  for (const [key, value] of Object.entries(rateLimit.headers)) {
    response.headers.set(key, value);
  }
  
  // Add request ID for tracing
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  response.headers.set("X-Request-ID", requestId);
  
  return response;
}

/**
 * Validate JSON body
 */
export async function validateBody<T>(
  req: NextRequest,
  validator: (body: unknown) => T | null
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    const body = await req.json();
    const validated = validator(body);
    
    if (validated === null) {
      return {
        error: createErrorResponse(API_ERRORS.VALIDATION_ERROR, {
          message: "Invalid request body",
        }),
      };
    }
    
    return { data: validated };
  } catch {
    return {
      error: createErrorResponse(API_ERRORS.BAD_REQUEST, {
        message: "Invalid JSON body",
      }),
    };
  }
}

// ============================================================================
// MIDDLEWARE WRAPPER
// ============================================================================

type APIHandler = (req: NextRequest) => Promise<NextResponse>;

/**
 * Wrap API handler with standard middleware
 */
export function withMiddleware(handler: APIHandler): APIHandler {
  return async (req: NextRequest) => {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      const response = new NextResponse(null, { status: 204 });
      return addStandardHeaders(response, req);
    }
    
    // Check rate limit
    const rateLimit = checkRateLimit(req);
    if (!rateLimit.allowed) {
      const response = createErrorResponse(API_ERRORS.RATE_LIMITED, {
        retryAfter: rateLimit.retryAfter,
      });
      return addStandardHeaders(response, req);
    }
    
    try {
      const response = await handler(req);
      return addStandardHeaders(response, req);
    } catch (error) {
      console.error("[API Error]", error);
      
      const response = createErrorResponse(API_ERRORS.INTERNAL_ERROR, {
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return addStandardHeaders(response, req);
    }
  };
}

