import { afterAll, describe, expect, it } from "bun:test";
import {
  bunRoutes,
  bunServeOptions,
} from "../../src/core/infra/http/routes/routes";
import {
  MAX_BUFFERED_BODY_BYTES,
  MAX_REQUEST_BODY_BYTES,
} from "../../src/core/infra/http/body/body_limits";
import { MAX_IMPORT_BYTES } from "../../src/core/infra/http/csv/streaming_csv_reader";

describe("bunServeOptions wiring", () => {
  it("passes MAX_REQUEST_BODY_BYTES as maxRequestBodySize", () => {
    expect(bunServeOptions.maxRequestBodySize).toBe(MAX_REQUEST_BODY_BYTES);
  });

  it("passes bunRoutes as the routes table", () => {
    expect(bunServeOptions.routes).toBe(bunRoutes);
  });
});

describe("Bun.serve maxRequestBodySize cuts the body at the socket", () => {
  const TOY_LIMIT = 16;
  let handlerCalled = false;

  const toyServer = Bun.serve({
    port: 0,
    maxRequestBodySize: TOY_LIMIT,
    routes: {
      "/toy-socket-limit": {
        POST: async (request: Request) => {
          handlerCalled = true;
          const text = await request.text();
          return new Response(text);
        },
      },
    },
  });

  afterAll(() => {
    toyServer.stop();
  });

  it("rejects a body over the socket limit with 413 before the handler runs", async () => {
    const response = await fetch(
      `http://localhost:${toyServer.port}/toy-socket-limit`,
      {
        method: "POST",
        body: "x".repeat(TOY_LIMIT * 10),
      }
    );

    expect(response.status).toBe(413);
    expect(handlerCalled).toBe(false);
  });
});

describe("relationship between the body-size constants", () => {
  it("keeps the socket ceiling above the import ceiling so a full 5 MB CSV still gets the 422 report instead of a bare 413 from the socket", () => {
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_IMPORT_BYTES);
  });

  it("keeps the buffered-body ceiling below the socket ceiling", () => {
    expect(MAX_BUFFERED_BODY_BYTES).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });
});
