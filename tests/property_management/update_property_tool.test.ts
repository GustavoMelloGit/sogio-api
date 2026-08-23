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

type PropertyOutput = {
  id: string;
  name: string;
  capacity: number;
  images: string[];
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zip_code: string;
    country: string;
    complement: string;
  };
};

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

function registerUpdatePropertyTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService(),
    makeTestPropertyOccupancy()
  );

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyManagementDi.makeUpdatePropertyTool()
  );
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ text: string }>)[0]?.text ?? "";
}

describe("update_property tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("changes only the fields that were sent", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-tool.partial@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({
      userId: user.id,
      name: "Casa Antiga",
      capacity: 4,
    });

    const registeredTool = registerUpdatePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, name: "Casa Reformada" },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as PropertyOutput;
    expect(output.name).toBe("Casa Reformada");
    expect(output.capacity).toBe(4);
    expect(output.images).toEqual(["https://example.com/image.jpg"]);
    expect(output.address.street).toBe("Rua das Flores");
  });

  it("patches a single address field and keeps the rest of the address", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-tool.address@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerUpdatePropertyTool(user);
    const result = await callTool(
      registeredTool,
      { property_id: property.id, address: { city: "Vitória" } },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as PropertyOutput;
    expect(output.address).toEqual({
      street: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Vitória",
      state: "SP",
      zip_code: "01310-100",
      country: "Brasil",
      complement: "",
    });
  });

  it("does not clear the complement when the address patch omits it", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-tool.complement@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerUpdatePropertyTool(user);
    await callTool(
      registeredTool,
      { property_id: property.id, address: { complement: "Apto 302" } },
      makeExtra()
    );
    const result = await callTool(
      registeredTool,
      { property_id: property.id, address: { city: "Vitória" } },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();
    const output = JSON.parse(textOf(result)) as PropertyOutput;
    expect(output.address.complement).toBe("Apto 302");
    expect(output.address.city).toBe("Vitória");
  });

  it("applying the same patch twice leaves the same state", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "update-property-tool.idempotent@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerUpdatePropertyTool(user);
    const patch = {
      property_id: property.id,
      name: "Casa Reformada",
      capacity: 8,
      address: { city: "Vitória" },
    };

    const first = JSON.parse(
      textOf(await callTool(registeredTool, patch, makeExtra()))
    ) as PropertyOutput;
    const second = JSON.parse(
      textOf(await callTool(registeredTool, patch, makeExtra()))
    ) as PropertyOutput;

    expect(second.name).toBe(first.name);
    expect(second.capacity).toBe(first.capacity);
    expect(second.address).toEqual(first.address);
  });

  it("does not distinguish another owner's property from a nonexistent one", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "update-property-tool.owner@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "update-property-tool.intruder@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerUpdatePropertyTool(intruder);

    const resultForAnotherOwnersProperty = await callTool(
      registeredTool,
      { property_id: property.id, name: "Invadida" },
      makeExtra()
    );
    const resultForNonexistentProperty = await callTool(
      registeredTool,
      { property_id: crypto.randomUUID(), name: "Invadida" },
      makeExtra()
    );

    expect(resultForAnotherOwnersProperty.isError).toBe(true);
    expect(resultForNonexistentProperty.isError).toBe(true);
    expect(textOf(resultForAnotherOwnersProperty)).toBe(
      textOf(resultForNonexistentProperty)
    );
  });
});
