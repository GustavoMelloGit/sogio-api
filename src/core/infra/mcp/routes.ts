import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { z } from "zod";
import type { Requester } from "../../../auth/application/service/credential_verifier";
import { MiddlewareDi } from "../../../auth/infra/di/middleware";
import type { PropertyDi } from "../../../booking/infra/di/property_di";
import type { StayDi } from "../../../booking/infra/di/stay_di";
import type { FinanceDi } from "../../../finance/infra/di/finance_di";
import type { PropertyManagementDi } from "../../../property_management/infra/di/property_management_di";
import type { BillingDi } from "../../../billing/infra/di/billing_di";
import { ForbiddenError } from "../../application/error/forbidden_error";
import { UnauthorizedError } from "../../application/error/unauthorized_error";
import { mapErrorToToolResult } from "./mcp_error_mapper";
import type { Logger } from "../../application/logger/logger";
import { CoreDi } from "../di/core_di";
import { CorsMiddleware } from "../../presentation/middleware/cors.middleware";
import { McpIdentityResolver } from "./identity_resolver";
import { createMcpServer } from "./mcp_server";
import type { McpToolDefinition } from "./mcp_tool";
import {
  makeBookStayTool,
  makeCancelStayTool,
  makeCreatePropertySettingTool,
  makeDeletePropertySettingTool,
  makeGetPropertySettingTool,
  makeListPropertiesTool,
  makeListPropertySettingsTool,
  makeListStaysTool,
  makeRecordExpenseTool,
  makeUpdatePropertySettingTool,
} from "./tools";

const MCP_SERVER_NAME = "sogio";
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
  billingDi: BillingDi;
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
 * handler. The credential accepted here is the OAuth access token issued by
 * the Auth BC's delegated-access subdomain (task 13) — resolution goes
 * through `MiddlewareDi.makeCredentialVerifier()`, never a JWT session
 * token, and there is no environment branch that falls back to one. On
 * success, the resolved `Requester`'s `user` is handed to `createMcpServer`,
 * which binds every tool registered for this request to that same caller
 * (see `mcp_tool.ts`); tools still only ever see the `User`, never the rest
 * of the `Requester` — the application identity (`appRegistrationId`) is a
 * transport-level concern, logged here by allowlist (E7), not something a
 * tool handler needs.
 *
 * Every response — success or 401 — carries public CORS headers (task 14,
 * closing the E8 gap task 13 left open): `/mcp` never sits behind
 * `BunHttpControllerAdapter`/`CorsMiddleware` the way a regular `Controller`
 * does, so without this it would have no `Access-Control-Allow-Origin` at
 * all, and a cross-origin browser fetch would fail the CORS check before
 * JavaScript ever got to inspect a status code or a header — `WWW-Authenticate`
 * exposure alone (already in place since task 13) is not reachable without
 * it. See `CorsMiddleware.getPublicCorsHeaders` for why the wildcard origin
 * is safe here. For the same reason — no `BunHttpControllerAdapter` in the
 * way — every response also gets `no-store`/`no-cache` applied directly here
 * (`withNoStore`, correção pós-revisão B3): `/mcp` carries guest personal
 * data and would otherwise ship with no cache header at all, unlike every
 * other protocol route (E8's default).
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
    middlewareDi.makeCredentialVerifier()
  );
  const logger: Logger = new CoreDi().makeLogger();
  const corsMiddleware = new CorsMiddleware();
  const entitlementService = dependencies.billingDi.makeEntitlementService();

  const tools: McpToolDefinition<z.ZodRawShape>[] = [
    makeListPropertiesTool(dependencies.propertyManagementDi),
    makeListStaysTool(dependencies.stayDi),
    makeRecordExpenseTool(dependencies.financeDi),
    makeBookStayTool(dependencies.propertyDi),
    makeCancelStayTool(dependencies.stayDi),
    makeListPropertySettingsTool(dependencies.propertyManagementDi),
    makeGetPropertySettingTool(dependencies.propertyManagementDi),
    makeCreatePropertySettingTool(dependencies.propertyManagementDi),
    makeUpdatePropertySettingTool(dependencies.propertyManagementDi),
    makeDeletePropertySettingTool(dependencies.propertyManagementDi),
  ];

  return async function handleMcpRequest(request: Request): Promise<Response> {
    const origin = request.headers.get("Origin");
    const authorizationHeader =
      request.headers.get("authorization") ?? undefined;

    let requester: Requester;
    try {
      requester = await identityResolver.resolveRequester(authorizationHeader);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        logger.warn("mcp", { endpoint: "mcp", result: "unauthorized" });
        const hadCredential = authorizationHeader !== undefined;
        return corsMiddleware.addCorsHeaders(
          withNoStore(unauthorizedResponse(request, hadCredential)),
          origin,
          "public"
        );
      }

      throw error;
    }

    logger.info("mcp", {
      endpoint: "mcp",
      result: "authenticated",
      client_id: requester.appRegistrationId,
    });

    /**
     * Platform-access gate (DA-9). `/mcp` has no account-recovery tool, so
     * unlike the HTTP adapter there is no exception list — a blocked
     * account is blocked outright. Admins still pass: staff can't be locked
     * out of tooling by a billing problem.
     */
    if (requester.user.role !== "admin") {
      const entitlement = await entitlementService.entitlementOf(
        requester.user.id
      );
      if (!entitlement.has_platform_access) {
        logger.warn("mcp", {
          endpoint: "mcp",
          result: "forbidden",
          blocked_reason: entitlement.blocked_reason,
        });
        return corsMiddleware.addCorsHeaders(
          withNoStore(
            forbiddenResponse(
              entitlement.blocked_reason ?? "no_platform_access"
            )
          ),
          origin,
          "public"
        );
      }
    }

    const server = createMcpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      user: requester.user,
      tools,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request);

      return corsMiddleware.addCorsHeaders(
        withNoStore(closeServerWhenResponseEnds(response, server)),
        origin,
        "public"
      );
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
 * both cases still resolve to the same `401`. Never distinguishes *why* a
 * presented credential was rejected (nonexistent, expired, revoked, or
 * wrong audience — see `CredentialVerifier`): all four collapse to the same
 * `invalid_token`, so this response is never an oracle over the reason.
 *
 * `Access-Control-Expose-Headers` is set so a browser-based MCP client can
 * actually read `WWW-Authenticate` off a cross-origin response (E8) —
 * without it, the header exists on the wire but is invisible to
 * `fetch`/`XMLHttpRequest`, and the 401 never triggers the client's OAuth
 * flow. That alone isn't sufficient, though: without
 * `Access-Control-Allow-Origin` the browser fails the response's CORS check
 * before JavaScript can read anything off it, exposed or not — the caller
 * (`handleMcpRequest`) adds that via `CorsMiddleware.addCorsHeaders` (task
 * 14), which preserves this header untouched.
 */
/**
 * Correção pós-revisão (B3). `/mcp` carries guest personal data (task 15/16
 * of the MCP server plan) over responses that, before this, shipped neither
 * `Cache-Control` nor `Pragma` at all — unlike every other protocol route,
 * which defaults to `no-store` (E8). Applied to both the 401 and the
 * success path, mirroring how `BunHttpControllerAdapter` now does the same
 * for every OAuth protocol route it fronts (M5).
 */
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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
        "Access-Control-Expose-Headers": "WWW-Authenticate",
      },
    }
  );
}

/** Reuses the existing tool-error shape (`mcp_error_mapper`) for the 403. */
function forbiddenResponse(reason: string): Response {
  const result = mapErrorToToolResult(new ForbiddenError(reason));
  return Response.json(result, { status: 403 });
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
