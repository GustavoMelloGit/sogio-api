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
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { db } from "../../src/core/infra/database/drizzle/database";
import { externalBookingSources } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { inputSchema } from "../../src/booking/presentation/mcp_tool/create_external_booking_source.mcp_tool";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["external_booking_sources", "properties", "addresses", "users"];

const SYNC_URL = "https://www.airbnb.com/calendar/ical/12345.ics";

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

function registerCreateExternalBookingSourceTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyDi = new PropertyDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    propertyDi.makeCreateExternalBookingSourceTool()
  );
}

describe("create_external_booking_source tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("registers a calendar for a property owned by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerCreateExternalBookingSourceTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        platform_name: "AIRBNB",
        sync_url: SYNC_URL,
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const rows = await db
      .select()
      .from(externalBookingSources)
      .where(eq(externalBookingSources.property_id, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform_name).toBe("AIRBNB");
    expect(rows[0]?.sync_url).toBe(SYNC_URL);
  });

  it("registers a calendar for a platform outside the known list, like VRBO", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerCreateExternalBookingSourceTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        platform_name: "VRBO",
        sync_url: SYNC_URL,
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const rows = await db
      .select()
      .from(externalBookingSources)
      .where(eq(externalBookingSources.property_id, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform_name).toBe("VRBO");
  });

  it("normalizes a lowercase platform name to uppercase in the database", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });

    const registeredTool = registerCreateExternalBookingSourceTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        platform_name: "vrbo",
        sync_url: SYNC_URL,
      },
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const rows = await db
      .select()
      .from(externalBookingSources)
      .where(eq(externalBookingSources.property_id, property.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.platform_name).toBe("VRBO");
  });

  it("rejects a platform name with an illegal character before the use case runs", () => {
    const parsed = z.object(inputSchema).safeParse({
      property_id: crypto.randomUUID(),
      platform_name: "VRBO!",
      sync_url: SYNC_URL,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a sync_url that is not a URL before the use case is invoked", () => {
    const parsed = z.object(inputSchema).safeParse({
      property_id: crypto.randomUUID(),
      platform_name: "AIRBNB",
      sync_url: "not-a-url",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects registering a calendar for a property that belongs to another user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: intruder } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });

    const registeredTool = registerCreateExternalBookingSourceTool(intruder);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        platform_name: "AIRBNB",
        sync_url: SYNC_URL,
      },
      makeExtra()
    );

    expect(result.isError).toBe(true);

    const rows = await db
      .select()
      .from(externalBookingSources)
      .where(eq(externalBookingSources.property_id, property.id));

    expect(rows).toHaveLength(0);
  });
});
