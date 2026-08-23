import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, beforeEach } from "bun:test";
import type { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { makeTestPropertyOccupancy } from "../helpers/property_occupancy";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["properties", "addresses", "users"];

function makeExtra(): RequestHandlerExtra<ServerRequest, ServerNotification> {
  return {
    signal: new AbortController().signal,
    requestId: "test-request-id",
    sendNotification: async () => {},
    sendRequest: () => {
      throw new Error("not implemented in test stub");
    },
  };
}

async function callTool(
  registeredTool: RegisteredTool,
  input: Record<string, unknown>,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const handler = registeredTool.handler as ToolCallback<z.ZodRawShape>;
  return handler(input, extra);
}

function registerGetPropertyTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyManagementDi.makeGetPropertyTool()
  );
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ text: string }>)[0]?.text ?? "";
}

describe("get_property tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("returns a property administered by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "get-property-tool.owner@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({
      userId: user.id,
      name: "Apartamento Vista Mar",
      capacity: 6,
    });

    const registeredTool = registerGetPropertyTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as {
      id: string;
      name: string;
      capacity: number;
      user_id: string;
      address: { city: string };
    };
    expect(output.id).toBe(property.id);
    expect(output.name).toBe("Apartamento Vista Mar");
    expect(output.capacity).toBe(6);
    expect(output.user_id).toBe(user.id);
    expect(output.address.city).toBe("São Paulo");
  });

  it("does not distinguish another owner's property from a nonexistent one", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "get-property-tool.owner-2@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "get-property-tool.intruder@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerGetPropertyTool(intruder);

    const resultForAnotherOwnersProperty = await callTool(
      registeredTool,
      { property_id: property.id },
      makeExtra()
    );
    const resultForNonexistentProperty = await callTool(
      registeredTool,
      { property_id: crypto.randomUUID() },
      makeExtra()
    );

    expect(resultForAnotherOwnersProperty.isError).toBe(true);
    expect(resultForNonexistentProperty.isError).toBe(true);
    expect(textOf(resultForAnotherOwnersProperty)).toBe(
      textOf(resultForNonexistentProperty)
    );
  });
});
