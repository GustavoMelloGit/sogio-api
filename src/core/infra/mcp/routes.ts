import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import { MiddlewareDi } from "../../../auth/infra/di/middleware";
import type { PropertyDi } from "../../../booking/infra/di/property_di";
import type { StayDi } from "../../../booking/infra/di/stay_di";
import type { FinanceDi } from "../../../finance/infra/di/finance_di";
import type { PropertyManagementDi } from "../../../property_management/infra/di/property_management_di";
import { UnauthorizedError } from "../../application/error/unauthorized_error";
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

/**
 * Path of the resource server's protected-resource metadata document
 * (RFC 9728), advertised via `resource_metadata` in `WWW-Authenticate` so a
 * generic MCP client can discover the authorization server and drive the
 * OAuth flow automatically. The endpoint itself does not exist yet — it is
 * introduced by a later task in the OAuth plan — so this is currently a
 * placeholder path a client can resolve against once that document ships.
 */
const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

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
 * reused across requests. Identity itself is resolved once per HTTP request,
 * at this transport boundary, before anything MCP-specific is touched: on
 * failure the handler returns `401` directly — see `unauthorizedResponse` —
 * and never instantiates a `McpServer`/transport pair or reaches a tool
 * handler. On success, the resolved `User` is handed to `createMcpServer`,
 * which binds every tool registered for this request to that same caller
 * (see `mcp_tool.ts`); tools no longer resolve identity on their own.
 *
 * Only the `McpServer`/transport pair is rebuilt per request:
 * `WebStandardStreamableHTTPServerTransport` refuses to be reused once it
 * has handled a request in stateless mode (`sessionIdGenerator: undefined`),
 * and a `McpServer` can only ever be connected to a single transport at a
 * time. This mirrors the official SDK example for stateless deployments
 * (fresh server + transport per request). Every `McpServer`/transport pair
 * that does get created is closed once its response finishes, so the
 * process never accumulates one live pair per request (see
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
    const authorizationHeader =
      request.headers.get("authorization") ?? undefined;

    let user: User;
    try {
      user = await identityResolver.resolveUser(authorizationHeader);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return unauthorizedResponse(request, authorizationHeader !== undefined);
      }

      throw error;
    }

    const server = createMcpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      user,
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
 * Transport-level credential gate, per RFC 9728: resolves the caller's
 * identity before a `McpServer`/transport pair is ever instantiated, so an
 * unauthenticated or invalid caller never reaches `initialize`, `tools/list`,
 * or the unauthenticated `GET /mcp` SSE stream.
 *
 * `WWW-Authenticate` carries `resource_metadata` pointing at this resource
 * server's protected-resource metadata document, which is what lets a
 * generic MCP client discover the authorization server and drive the OAuth
 * flow on its own instead of surfacing a dead-end error to the user. That
 * metadata endpoint is introduced by a later task; the path used here is the
 * canonical well-known location it is expected to live at.
 *
 * `hadCredential` distinguishes "no credential presented" (`invalid_request`)
 * from "credential presented but rejected" (`invalid_token`), per RFC 6750 —
 * both cases still resolve to the same `401`.
 */
function unauthorizedResponse(
  request: Request,
  hadCredential: boolean
): Response {
  const resourceMetadataUrl = new URL(
    OAUTH_PROTECTED_RESOURCE_METADATA_PATH,
    request.url
  ).toString();
  const error = hadCredential ? "invalid_token" : "invalid_request";
  const errorDescription = hadCredential
    ? "The access token is expired, revoked, malformed, or otherwise invalid."
    : "A bearer token is required to access this resource.";

  return new Response(
    JSON.stringify({ error, error_description: errorDescription }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer error="${error}", error_description="${errorDescription}", resource_metadata="${resourceMetadataUrl}"`,
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
