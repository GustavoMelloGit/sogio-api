import type { GetDashboardOverviewUseCase } from "../../application/use_case/dashboard/get_dashboard_overview";
import type { McpToolDefinition } from "../../../core/presentation/mcp_tool/mcp_tool";
import { getDashboardOverviewInput } from "../schema/get_dashboard_overview.schema";

export const inputSchema = getDashboardOverviewInput;

export function makeGetDashboardOverviewTool(
  useCase: GetDashboardOverviewUseCase
): McpToolDefinition<typeof inputSchema> {
  return {
    name: "get_dashboard_overview",
    description:
      "Returns an overview across every property administered by the authenticated user: how many stays are active, how many check-ins are coming, the revenue of the month in cents, and the next stays to check in.",
    inputSchema,
    annotations: {
      readOnlyHint: true,
    },
    handler: async (input, user) => {
      return useCase.execute({ user_id: user.id, date: input.date });
    },
  };
}
