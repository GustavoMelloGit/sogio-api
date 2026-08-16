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
import type { z } from "zod";
import type { User } from "../../src/auth/domain/entity/user";
import { db } from "../../src/core/infra/database/drizzle/database";
import { propertySettingsTable } from "../../src/core/infra/database/drizzle/schema";
import { registerMcpTool } from "../../src/core/infra/mcp/mcp_tool";
import { makeUpdatePropertySettingTool } from "../../src/core/infra/mcp/tools/update_property_setting";
import { PropertyManagementDi } from "../../src/property_management/infra/di/property_management_di";
import { makeTestEntitlementService } from "../helpers/entitlement_service";
import { truncate } from "../helpers/database";
import { createUserFixture } from "../helpers/fixtures/user";
import { createPropertyFixture } from "../helpers/fixtures/property";

const TABLES = ["property_settings", "properties", "addresses", "users"];

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

function registerUpdatePropertySettingTool(user: User): RegisteredTool {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService()
  );

  return registerMcpTool(
    server,
    user,
    makeUpdatePropertySettingTool(propertyManagementDi)
  );
}

async function createSettingFixture(propertyId: string, user: User) {
  const propertyManagementDi = new PropertyManagementDi(
    makeTestEntitlementService()
  );

  return propertyManagementDi.makeCreatePropertySettingUseCase().execute(
    {
      property_id: propertyId,
      key: "checkin_time",
      value: "14:00",
      type: "string",
    },
    user
  );
}

describe("update_property_setting tool", () => {
  beforeEach(async () => {
    await truncate(TABLES);
  });

  it("updates a setting owned by the authenticated user's property", async () => {
    const { user } = await createUserFixture({
      name: "João Silva",
      email: "joao@sogio.dev",
      password: "password123",
    });
    const property = await createPropertyFixture({ userId: user.id });
    const setting = await createSettingFixture(property.id, user);

    const registeredTool = registerUpdatePropertySettingTool(user);
    const result = await callTool(
      registeredTool,
      {
        property_id: property.id,
        id: setting.id,
        value: "15:00",
      },
      makeExtra()
    );

    const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
    const output = JSON.parse(text) as { id: string; value: string };

    expect(result.isError).toBeUndefined();
    expect(output.id).toBe(setting.id);
    expect(output.value).toBe("15:00");

    const rows = await db
      .select()
      .from(propertySettingsTable)
      .where(eq(propertySettingsTable.id, setting.id));

    expect(rows[0]?.value).toBe("15:00");
  });

  it("does not distinguish another owner's property setting from a nonexistent one", async () => {
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
    const ownerProperty = await createPropertyFixture({ userId: owner.id });
    const setting = await createSettingFixture(ownerProperty.id, owner);

    const registeredTool = registerUpdatePropertySettingTool(intruder);

    const resultForAnotherOwnersSetting = await callTool(
      registeredTool,
      { property_id: ownerProperty.id, id: setting.id, value: "hacked" },
      makeExtra()
    );
    const resultForNonexistentSetting = await callTool(
      registeredTool,
      {
        property_id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        value: "hacked",
      },
      makeExtra()
    );

    expect(resultForAnotherOwnersSetting.isError).toBe(true);
    expect(resultForNonexistentSetting.isError).toBe(true);

    const textForAnotherOwnersSetting =
      (resultForAnotherOwnersSetting.content as Array<{ text: string }>)[0]
        ?.text ?? "";
    const textForNonexistentSetting =
      (resultForNonexistentSetting.content as Array<{ text: string }>)[0]
        ?.text ?? "";

    expect(textForAnotherOwnersSetting).toBe(textForNonexistentSetting);

    const rows = await db
      .select()
      .from(propertySettingsTable)
      .where(eq(propertySettingsTable.id, setting.id));

    expect(rows[0]?.value).toBe("14:00");
  });
});
