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
    const server = createMcpServer({
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
      identityResolver,
      tools,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);

    return transport.handleRequest(request);
  };
}
