import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export function makeGetMeTool(): McpToolDefinition {
  return {
    name: "get_me",
    description:
      "Returns the profile of the authenticated user: id, name, email, locale, time zone, and account timestamps.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
    },
    handler: async (_input, user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      locale: user.locale,
      time_zone: user.time_zone,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }),
  };
}
