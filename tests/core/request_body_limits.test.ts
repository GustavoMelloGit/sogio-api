import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  HttpControllerMethod,
  type Controller,
} from "../../src/core/presentation/controller/controller";
import { BunHttpControllerAdapter } from "../../src/core/infra/http/adapters/http_controller_adapter";
import type { EntitlementService } from "../../src/billing/application/service/entitlement_service";
import {
  MAX_BUFFERED_BODY_BYTES,
  MAX_JSON_DEPTH,
  MAX_REQUEST_BODY_BYTES,
} from "../../src/core/infra/http/body/body_limits";
import { resetSharedRateLimiter } from "../../src/core/infra/di/core_di";
import { baseUrl as appBaseUrl } from "../setup";

const unusedEntitlementService: EntitlementService = {
  entitlementOf: () => {
    throw new Error("not implemented — unauthenticated routes never call this");
  },
};

let handleCallCount = 0;

class SpyController implements Controller {
  path = "/__test/body-limits/echo";
  method = HttpControllerMethod.POST;
  inputSchema = z.object({ name: z.string() });

  async handle() {
    handleCallCount++;
    return { ok: true };
  }
}

const spyController = new SpyController();

const server = Bun.serve({
  port: 0,
  routes: {
    [spyController.path]: {
      [HttpControllerMethod.POST]: BunHttpControllerAdapter(
        spyController,
        false,
        unusedEntitlementService
      ),
    },
  },
});

function requireListeningPort(port: number | undefined): number {
  if (port === undefined) {
    throw new Error("expected the test server to be bound to a TCP port");
  }
  return port;
}

const serverPort = requireListeningPort(server.port);
const baseUrl = `http://localhost:${serverPort}`;

afterAll(() => {
  server.stop();
});

type ChunkedRequestResult = { status: number; bytesWritten: number };

function postWithUncappedChunkedBody(
  path: string,
  chunkBytes: number,
  maxChunks: number
): Promise<ChunkedRequestResult> {
  return new Promise((resolve, reject) => {
    const chunkPayload = new Uint8Array(chunkBytes).fill(97);
    const chunkHeader = Buffer.from(
      chunkPayload.byteLength.toString(16) + "\r\n"
    );
    const chunkTrailer = Buffer.from("\r\n");

    let responseText = "";
    let bytesWritten = 0;
    let settled = false;

    const writeLoopDone = (async () => {
      const socket = await Bun.connect({
        hostname: "localhost",
        port: serverPort,
        socket: {
          data(_socket, data) {
            responseText += data.toString();
            if (!settled && responseText.includes("\r\n\r\n")) {
              settled = true;
              const statusLine = responseText.slice(
                0,
                responseText.indexOf("\r\n")
              );
              const status = Number(statusLine.split(" ")[1]);
              resolve({ status, bytesWritten });
            }
          },
          close() {
            if (!settled) {
              settled = true;
              reject(new Error("socket closed before a response arrived"));
            }
          },
          error(_socket, error) {
            if (!settled) {
              settled = true;
              reject(error);
            }
          },
        },
      });

      socket.write(
        `POST ${path} HTTP/1.1\r\n` +
          "Host: localhost\r\n" +
          "Content-Type: application/json\r\n" +
          "Transfer-Encoding: chunked\r\n" +
          "Connection: close\r\n" +
          "\r\n"
      );

      for (let i = 0; i < maxChunks && !settled; i++) {
        socket.write(chunkHeader);
        socket.write(chunkPayload);
        socket.write(chunkTrailer);
        bytesWritten += chunkPayload.byteLength;
        await new Promise(resolveDelay => setTimeout(resolveDelay, 2));
      }

      socket.end();
    })();

    writeLoopDone.catch(error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function makeChunkedByteStream(
  totalBytes: number,
  chunkBytes: number
): { readable: ReadableStream<Uint8Array>; chunksPulled: () => number } {
  let pulled = 0;
  let remaining = totalBytes;

  const readable = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, remaining);
      remaining -= size;
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });

  return { readable, chunksPulled: () => pulled };
}

function makePacedChunkedByteStream(
  totalBytes: number,
  chunkBytes: number,
  delayMs: number
): { readable: ReadableStream<Uint8Array>; chunksPulled: () => number } {
  let pulled = 0;
  let remaining = totalBytes;

  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      const size = Math.min(chunkBytes, remaining);
      remaining -= size;
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(97));
    },
  });

  return { readable, chunksPulled: () => pulled };
}

describe("request body byte cap — 413 without materializing the payload (IE-1)", () => {
  it("processes a normal body under the cap end to end", async () => {
    const before = handleCallCount;

    const res = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Casa da Praia" }),
    });
    await res.json();

    expect(res.status).toBe(200);
    expect(handleCallCount).toBe(before + 1);
  });

  it("returns 413 for a body over the cap declared through Content-Length, without ever invoking the controller", async () => {
    const before = handleCallCount;
    const oversized = "x".repeat(MAX_BUFFERED_BODY_BYTES + 1024);

    const res = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: oversized }),
    });
    await res.json();

    expect(res.status).toBe(413);
    expect(handleCallCount).toBe(before);
  });

  it("returns the same 413 for an equally sized body sent without Content-Length, proving the header decides nothing (D2)", async () => {
    const before = handleCallCount;
    const { readable } = makeChunkedByteStream(
      MAX_BUFFERED_BODY_BYTES + 1024,
      64 * 1024
    );

    const res = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: readable,
      duplex: "half",
    } as RequestInit);
    await res.json();

    expect(res.status).toBe(413);
    expect(handleCallCount).toBe(before);
  });

  it("cuts off a chunked body without Content-Length once its own read budget is crossed, not the runtime's maxRequestBodySize (D1-bis)", async () => {
    const before = handleCallCount;

    const result = await postWithUncappedChunkedBody(
      spyController.path,
      64 * 1024,
      4000
    );

    expect(result.status).toBe(413);
    expect(handleCallCount).toBe(before);
    expect(result.bytesWritten).toBeGreaterThan(MAX_REQUEST_BODY_BYTES);
    expect(result.bytesWritten).toBeLessThan(
      MAX_REQUEST_BODY_BYTES + 10 * 64 * 1024
    );
  });

  it("keeps the keep-alive connection usable after rejecting an oversized body (D2-bis)", async () => {
    const oversizedButWithinReadBudget = 2 * MAX_BUFFERED_BODY_BYTES;
    const { readable, chunksPulled } = makePacedChunkedByteStream(
      oversizedButWithinReadBudget,
      64 * 1024,
      5
    );

    const rejectionStart = performance.now();
    const rejection = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: readable,
      duplex: "half",
    } as RequestInit);
    await rejection.json();
    const rejectionElapsedMs = performance.now() - rejectionStart;

    expect(rejection.status).toBe(413);
    expect(chunksPulled()).toBeGreaterThan(0);
    expect(rejectionElapsedMs).toBeLessThan(3000);

    const before = handleCallCount;
    const followUpStart = performance.now();
    const followUp = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "still alive" }),
      signal: AbortSignal.timeout(3000),
    });
    await followUp.json();
    const followUpElapsedMs = performance.now() - followUpStart;

    expect(followUp.status).toBe(200);
    expect(handleCallCount).toBe(before + 1);
    expect(followUpElapsedMs).toBeLessThan(3000);
  });
});

describe("request body depth cap — 422 before JSON.parse (IE-2)", () => {
  it("returns 422 for a body nested past MAX_JSON_DEPTH without invoking the controller", async () => {
    const before = handleCallCount;
    const tooDeep =
      "[".repeat(MAX_JSON_DEPTH + 1) + "]".repeat(MAX_JSON_DEPTH + 1);

    const res = await fetch(`${baseUrl}${spyController.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: tooDeep,
    });
    await res.json();

    expect(res.status).toBe(422);
    expect(handleCallCount).toBe(before);
  });
});

describe("rate limit 429 — drains the request body instead of abandoning it (IE-1)", () => {
  const rateLimitedPath = "/import/properties";
  const rateLimitedMaxAttempts = 5;

  beforeEach(() => {
    resetSharedRateLimiter();
  });

  it("drains an oversized body rejected by the rate limiter and keeps the connection usable for the next request", async () => {
    for (let attempt = 0; attempt < rateLimitedMaxAttempts; attempt++) {
      const burn = await fetch(`${appBaseUrl}${rateLimitedPath}`, {
        method: "POST",
      });
      await burn.text();
      expect(burn.status).not.toBe(429);
    }

    const { readable, chunksPulled } = makeChunkedByteStream(
      2 * MAX_BUFFERED_BODY_BYTES,
      64 * 1024
    );

    const rejectionStart = performance.now();
    const rejected = await fetch(`${appBaseUrl}${rateLimitedPath}`, {
      method: "POST",
      body: readable,
      duplex: "half",
    } as RequestInit);
    await rejected.text();
    const rejectionElapsedMs = performance.now() - rejectionStart;

    expect(rejected.status).toBe(429);
    expect(chunksPulled()).toBeGreaterThan(0);
    expect(rejectionElapsedMs).toBeLessThan(3000);

    const CONNECTION_SURVIVAL_TIMEOUT_MS = 3000;
    const followUpStart = performance.now();
    const followUp = await fetch(`${appBaseUrl}/health`, {
      signal: AbortSignal.timeout(CONNECTION_SURVIVAL_TIMEOUT_MS),
    });
    await followUp.text();
    const followUpElapsedMs = performance.now() - followUpStart;

    expect(followUp.status).toBe(200);
    expect(followUpElapsedMs).toBeLessThan(CONNECTION_SURVIVAL_TIMEOUT_MS);
  });
});
