import { z } from "zod";
import type { GetDashboardOverviewUseCase } from "../../../application/use_case/dashboard/get_dashboard_overview";
import type { User } from "../../../../auth/domain/entity/user";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  date: z.iso
    .date()
    .transform(s => new Date(`${s}T00:00:00.000Z`))
    .optional(),
});

const outputSchema = z.object({
  kpis: z.object({
    active_stays: z.number().int(),
    upcoming_check_ins: z.number().int(),
    monthly_revenue: z.number().int().describe("Revenue in cents"),
  }),
  upcoming_stays: z.array(
    z.object({
      id: z.uuid(),
      property_id: z.uuid(),
      property_name: z.string(),
      check_in: z.iso.datetime(),
      tenant: z.object({
        name: z.string(),
      }),
    })
  ),
});

type Input = z.infer<typeof inputSchema>;

export class GetDashboardOverviewController implements Controller {
  path = "/dashboard/overview";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get dashboard overview",
    description:
      "Returns KPIs and upcoming stays for the authenticated user's properties.",
    tags: ["Dashboard"],
    parameters: [
      {
        name: "date",
        in: "query",
        required: false,
        schema: { type: "string", format: "date", example: "2026-06-04" },
      },
    ],
    responses: {
      "200": responseFromZod("Dashboard overview", outputSchema),
      "401": errorResponse("Unauthorized"),
      "422": errorResponse("Validation error"),
    },
  };

  constructor(private readonly useCase: GetDashboardOverviewUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    const output = await this.useCase.execute({
      user_id: user.id,
      date: input.date,
    });

    return output;
  }
}
