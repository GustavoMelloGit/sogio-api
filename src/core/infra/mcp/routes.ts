import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import { MiddlewareDi } from "../../../auth/infra/di/middleware";
import type { PropertyDi } from "../../../booking/infra/di/property_di";
import type { StayDi } from "../../../booking/infra/di/stay_di";
import type { FinanceDi } from "../../../finance/infra/di/finance_di";
import type { PropertyManagementDi } from "../../../property_management/infra/di/property_management_di";
import { McpIdentityResolver } from "./identity_resolver";
import { createMcpServer } from "./mcp_server";
import type { McpToolDefinition } from "./mcp_tool";
import {
  makeBookStayTool,
  makeListPropertiesTool,
  makeListStaysTool,
  makeRecordExpenseTool,
} from "./tools";

const MCP_SERVER_NAME = "stayhub";
const MCP_SERVER_VERSION = "1.0.0";

export type McpRouteDependencies = {
  propertyDi: PropertyDi;
  stayDi: StayDi;
  financeDi: FinanceDi;
  propertyManagementDi: PropertyManagementDi;
};

/**
 * Builds the `/mcp` HTTP handler.
 *
 * The DI containers must be the same instances the HTTP routes use, not
 * fresh ones: some of them (`StayDi`, `FinanceDi`) register event handlers
 * on the shared in-memory event dispatcher from their constructor, and that
 * registration is not idempotent — a second container instance would make
 * every handler run twice per event.
 *
 * Tool definitions and the identity resolver are built once, up front, and
 * reused across requests. Only the `McpServer`/transport pair is rebuilt per
 * request: `WebStandardStreamableHTTPServerTransport` refuses to be reused
 * once it has handled a request in stateless mode
 * (`sessionIdGenerator: undefined`), and a `McpServer` can only ever be
 * connected to a single transport at a time. This mirrors the official SDK
 * example for stateless deployments (fresh server + transport per request).
 *
 * Every request must carry an `Authorization` header to reach that transport
 * at all — see `unauthorizedResponse` — and every `McpServer`/transport pair
 * that does get created is closed once its response finishes, so the process
 * never accumulates one live pair per request (see
 * `closeServerWhenResponseEnds`).
 */
export function makeMcpRequestHandler(
  dependencies: McpRouteDependencies
): (request: Request) => Promise<Response> {
  const middlewareDi = new MiddlewareDi();
  const identityResolver = new McpIdentityResolver(
    middlewareDi.makeAuthRepository(),
    middlewareDi.makeSessionManager()
  );

  const tools: McpToolDefinition<z.ZodRawShape>[] = [
    makeListPropertiesTool(dependencies.propertyManagementDi),
    makeListStaysTool(dependencies.stayDi),
    makeRecordExpenseTool(dependencies.financeDi),
    makeBookStayTool(dependencies.propertyDi),
  ];

  return async function handleMcpRequest(request: Request): Promise<Response> {
    if (!request.headers.has("authorization")) {
      return unauthorizedResponse();
    }

    const server = createMcpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      identityResolver,
      tools,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);

      return closeServerWhenResponseEnds(response, server);
    } catch (error) {
      await server.close();
      throw error;
    }
  };
}

/**
 * Cheap, transport-level credential gate: rejects requests that don't even
 * carry an `Authorization` header before a `McpServer`/transport pair is
 * instantiated, so an anonymous caller can never complete `initialize` or
 * `tools/list`, let alone open the unauthenticated `GET /mcp` SSE stream.
 *
 * This does not replace `McpIdentityResolver` — a present-but-invalid token
 * still passes this gate and is only rejected when a tool handler actually
 * resolves the caller's identity. That per-tool resolution is what performs
 * real authentication; this gate only keeps the transport closed to callers
 * that never even attempt it.
 */
function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Unauthorized" },
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      },
    }
  );
}

/**
 * Closes the per-request `McpServer` (which in turn closes its transport)
 * once the response body is fully drained, instead of right after
 * `transport.handleRequest` resolves.
 *
 * Those two moments are not the same: in SSE mode, `handleRequest` hands
 * back a `Response` wrapping a `ReadableStream` whose content is filled in
 * by fire-and-forget message handling that keeps running after the promise
 * resolves (this is how the SDK itself streams tool results). Closing the
 * server at that point — rather than after the stream actually ends — tears
 * down the transport mid-flight: `server.close()` closes the transport,
 * which fires `onclose`, which the SDK wires to abort every in-flight
 * request handler. That would cancel the very tool call whose result is
 * still being written to the stream. Deferring the close until the body is
 * fully read (or the client disconnects) still guarantees the server/
 * transport pair never outlives its request, without cutting off an
 * in-progress response.
 */
function closeServerWhenResponseEnds(
  response: Response,
  server: McpServer
): Response {
  const originalBody = response.body;

  if (!originalBody) {
    void server.close();
    return response;
  }

  const reader = originalBody.getReader();
  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    await server.close();
  };

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          await closeOnce();
          return;
        }

        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        await closeOnce();
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
      await closeOnce();
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
