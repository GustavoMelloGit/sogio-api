import type { GetUserPreferencesUseCase } from "../../application/use_case/get_user_preferences";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";

export const inputSchema = {};

export function makeGetUserPreferencesTool(
  useCase: GetUserPreferencesUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_user_preferences",
    description:
      "Returns the language and time zone the authenticated user chose. Everything the platform writes to this user — notifications, emails — is rendered with them. Also lists the languages the platform supports.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (_input, user) => useCase.execute(undefined, user),
  };
}
