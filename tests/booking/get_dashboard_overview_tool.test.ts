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
import { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { PropertyDi } from "../../src/booking/infra/di/property_di";
import { StayDi } from "../../src/booking/infra/di/stay_di";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool_adapter";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";
import { inputSchema } from "../../src/booking/presentation/mcp_tool/get_dashboard_overview.mcp_tool";

const TABLES = [
  "ledger_entries",
  "stays",
  "tenants",
  "properties",
  "addresses",
  "users",
];

type OverviewPayload = {
  kpis: {
    active_stays: number;
    upcoming_check_ins: number;
    monthly_revenue: number;
  };
  upcoming_stays: Array<{ id: string; property_name: string }>;
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

function asToolArguments(
  raw: Record<string, unknown>
): Record<string, unknown> {
  return z.object(inputSchema).parse(raw);
}

function payloadOf(result: CallToolResult): OverviewPayload {
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  return JSON.parse(text) as OverviewPayload;
}

function registerGetDashboardOverviewTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const stayDi = new StayDi();

  return registerMcpTool(
    server,
    user,
    CapabilitySet.of({}),
    stayDi.makeGetDashboardOverviewTool()
  );
}

async function bookStayFixture(propertyId: string, user: User) {
  const propertyDi = new PropertyDi();

  return propertyDi.makeBookStayUseCase().execute(
    {
      guests: 2,
      property_id: propertyId,
      check_in: new Date("2040-06-01T12:00:00.000Z"),
      check_out: new Date("2040-06-03T12:00:00.000Z"),
      price: 10000,
      source: "DIRECT",
      tenant: {
        name: "Ana Souza",
        phone: "5511999990001",
        sex: "FEMALE",
      },
    },
    user
  );
}

describe("get_dashboard_overview tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("summarises the stays of every property administered by the authenticated user", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const bookedStay = await bookStayFixture(property.id, user);

    const registeredTool = registerGetDashboardOverviewTool(user);
    const result = await callTool(
      registeredTool,
      asToolArguments({ date: "2040-05-28" }),
      makeExtra()
    );

    expect(result.isError).toBeUndefined();

    const output = payloadOf(result);
    expect(output.kpis.upcoming_check_ins).toBe(1);
    expect(output.upcoming_stays).toHaveLength(1);
    expect(output.upcoming_stays[0]?.id).toBe(bookedStay.id);
  });

  it("anchors the counters on the reference day it is given", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    await bookStayFixture(property.id, user);

    const registeredTool = registerGetDashboardOverviewTool(user);
    const result = await callTool(
      registeredTool,
      asToolArguments({ date: "2040-05-01" }),
      makeExtra()
    );

    const output = payloadOf(result);
    expect(output.kpis.upcoming_check_ins).toBe(0);
    expect(output.upcoming_stays).toHaveLength(1);
  });

  it("returns zeroed counters for a user with no properties", async () => {
    const { user } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });

    const registeredTool = registerGetDashboardOverviewTool(user);
    const result = await callTool(registeredTool, {}, makeExtra());

    expect(result.isError).toBeUndefined();

    const output = payloadOf(result);
    expect(output.kpis).toEqual({
      active_stays: 0,
      upcoming_check_ins: 0,
      monthly_revenue: 0,
    });
    expect(output.upcoming_stays).toEqual([]);
  });

  it("never counts stays of a property administered by another user", async () => {
    const { user: owner } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const { user: outsider } = await createUserFixture({
      name: "Maria Souza",
      email: "maria@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: owner.id });
    await bookStayFixture(property.id, owner);

    const registeredTool = registerGetDashboardOverviewTool(outsider);
    const result = await callTool(
      registeredTool,
      asToolArguments({ date: "2040-05-01" }),
      makeExtra()
    );

    const output = payloadOf(result);
    expect(output.kpis.upcoming_check_ins).toBe(0);
    expect(output.upcoming_stays).toEqual([]);
  });
});
