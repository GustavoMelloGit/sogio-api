import { afterAll, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../src/core/presentation/controller/controller";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";
import { MAX_BUFFERED_BODY_BYTES } from "../../src/core/infra/http/body/body_limits";

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
 * A throwaway `bodyMode: "stream"` controller used only to prove IM-1 end to
 * end through `BunHttpControllerAdapter` — it is not, and must never
 * become, a real route. It reads `request.bodyStream` itself, the only way
 * a streaming controller is supposed to consume the body.
 */
class FakeStreamController implements Controller {
  path: string;
  method = HttpControllerMethod.POST;
  bodyMode = "stream" as const;

  constructor(path: string) {
    this.path = path;
  }

  async handle(request: ControllerRequest) {
    let totalBytes = 0;
    let text = "";

    if (request.bodyStream) {
      const reader = request.bodyStream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        totalBytes += value.length;
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }

    return {
      totalBytes,
      text,
      rawBody: request.rawBody,
      bodyKeyCount: Object.keys(request.body).length,
    };
  }
}

const streamController = new FakeStreamController("/__test/stream-body/echo");

const server = Bun.serve({
  port: 0,
  routes: {
    [streamController.path]: {
      [HttpControllerMethod.POST]: BunHttpControllerAdapter(
        streamController,
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

describe("bodyMode: 'stream' — never buffers the body (IM-1)", () => {
  it("hands the controller the raw, unconsumed body stream instead of buffering it into text", async () => {
    const payload = "row-marker-" + "x".repeat(2_000_000);

    const res = await fetch(`${baseUrl}${streamController.path}`, {
      method: "POST",
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalBytes: number;
      text: string;
      rawBody: string | null;
      bodyKeyCount: number;
    };

    expect(body.totalBytes).toBe(new TextEncoder().encode(payload).length);
    expect(body.text).toBe(payload);
    expect(body.rawBody).toBeNull();
    expect(body.bodyKeyCount).toBe(0);
  });

  it("returns 200 for a payload larger than MAX_BUFFERED_BODY_BYTES, proving the byte cap never reaches stream routes (D6)", async () => {
    const payload = "z".repeat(MAX_BUFFERED_BODY_BYTES + 1024);

    const res = await fetch(`${baseUrl}${streamController.path}`, {
      method: "POST",
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalBytes: number };
    expect(body.totalBytes).toBeGreaterThan(MAX_BUFFERED_BODY_BYTES);
  });

  it("still hands the controller an unconsumed stream for an empty body", async () => {
    const res = await fetch(`${baseUrl}${streamController.path}`, {
      method: "POST",
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { totalBytes: number };
    expect(body.totalBytes).toBe(0);
  });
});

describe("bodyMode: 'stream' + inputSchema — rejected at boot", () => {
  it("throws when a controller declares bodyMode: 'stream' together with inputSchema", () => {
    class MisconfiguredController implements Controller {
      path = "/__test/stream-body/misconfigured";
      method = HttpControllerMethod.POST;
      bodyMode = "stream" as const;
      inputSchema = z.object({ name: z.string() });

      async handle() {
        return { ok: true };
      }
    }

    expect(() =>
      BunHttpControllerAdapter(
        new MisconfiguredController(),
        false,
        unusedEntitlementService
      )
    ).toThrow();
  });

  it("does not throw when bodyMode: 'stream' is declared without inputSchema", () => {
    class StreamOnlyController implements Controller {
      path = "/__test/stream-body/stream-only";
      method = HttpControllerMethod.POST;
      bodyMode = "stream" as const;

      async handle() {
        return { ok: true };
      }
    }

    expect(() =>
      BunHttpControllerAdapter(
        new StreamOnlyController(),
        false,
        unusedEntitlementService
      )
    ).not.toThrow();
  });

  it("does not throw when inputSchema is declared without bodyMode: 'stream'", () => {
    class SchemaOnlyController implements Controller {
      path = "/__test/stream-body/schema-only";
      method = HttpControllerMethod.POST;
      inputSchema = z.object({ name: z.string() });

      async handle() {
        return { ok: true };
      }
    }

    expect(() =>
      BunHttpControllerAdapter(
        new SchemaOnlyController(),
        false,
        unusedEntitlementService
      )
    ).not.toThrow();
  });
});
