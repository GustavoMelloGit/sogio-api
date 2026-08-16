import { afterAll, describe, expect, it } from "bun:test";
import {
  HttpControllerMethod,
  type Controller,
} from "../../src/core/presentation/controller/controller";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import type { RateLimitPolicy } from "../../src/core/application/rate_limit/rate_limit_policy";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";

/**
 * Every route registered below is `authenticated: false`, so the DA-9 gate
 * never runs and never calls this — it only exists to satisfy
 * `BunHttpControllerAdapter`'s required parameter.
 */
const unusedEntitlementService: EntitlementService = {
  entitlementOf: () => {
    throw new Error("not implemented — unauthenticated routes never call this");
  },
};

/**
 * A throwaway controller used only to prove the rate limit mechanism works
 * end-to-end through `BunHttpControllerAdapter` — it is not, and must never
 * become, a real route. Each test below gets its own path so the shared,
 * per-process rate limiter (a real limitation, not a test-isolation bug —
 * see `CoreDi.makeRateLimiter`) can't leak state between assertions.
 */
class FakeRateLimitedController implements Controller {
  path: string;
  method = HttpControllerMethod.GET;
  rateLimitPolicy: RateLimitPolicy;

  constructor(path: string, rateLimitPolicy: RateLimitPolicy) {
    this.path = path;
    this.rateLimitPolicy = rateLimitPolicy;
  }

  async handle() {
    return { ok: true };
  }
}

const allowController = new FakeRateLimitedController(
  "/__test/rate-limit/allow",
  { keyDimension: "peer-ip", windowMs: 60_000, maxAttempts: 5 }
);
const denyController = new FakeRateLimitedController(
  "/__test/rate-limit/deny",
  { keyDimension: "peer-ip", windowMs: 60_000, maxAttempts: 1 }
);
const windowController = new FakeRateLimitedController(
  "/__test/rate-limit/window",
  { keyDimension: "peer-ip", windowMs: 150, maxAttempts: 1 }
);
const xffController = new FakeRateLimitedController("/__test/rate-limit/xff", {
  keyDimension: "peer-ip",
  windowMs: 60_000,
  maxAttempts: 1,
});

const server = Bun.serve({
  port: 0,
  routes: {
    [allowController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        allowController,
        false,
        unusedEntitlementService
      ),
    },
    [denyController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        denyController,
        false,
        unusedEntitlementService
      ),
    },
    [windowController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        windowController,
        false,
        unusedEntitlementService
      ),
    },
    [xffController.path]: {
      [HttpControllerMethod.GET]: BunHttpControllerAdapter(
        xffController,
        false,
        unusedEntitlementService
      ),
    },
  },
});

const baseUrl = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
});

describe("rate limiting through BunHttpControllerAdapter", () => {
  it("allows requests within the declared limit", async () => {
    const first = await fetch(`${baseUrl}${allowController.path}`);
    const second = await fetch(`${baseUrl}${allowController.path}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("denies with 429 and a coarse Retry-After once the limit is exceeded, without leaking rate limit headers", async () => {
    const first = await fetch(`${baseUrl}${denyController.path}`);
    const second = await fetch(`${baseUrl}${denyController.path}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("60");
    expect(second.headers.get("X-RateLimit-Remaining")).toBeNull();
    expect(second.headers.get("X-RateLimit-Limit")).toBeNull();

    const body = (await second.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("frees the caller up again once the window elapses", async () => {
    const first = await fetch(`${baseUrl}${windowController.path}`);
    const second = await fetch(`${baseUrl}${windowController.path}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);

    await new Promise(resolve => setTimeout(resolve, 200));

    const third = await fetch(`${baseUrl}${windowController.path}`);
    expect(third.status).toBe(200);
  });

  it("ignores a forged X-Forwarded-For and keys off the real peer IP when no trusted proxy is configured", async () => {
    const first = await fetch(`${baseUrl}${xffController.path}`, {
      headers: { "X-Forwarded-For": "203.0.113.1" },
    });
    const second = await fetch(`${baseUrl}${xffController.path}`, {
      headers: { "X-Forwarded-For": "198.51.100.7" },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});
