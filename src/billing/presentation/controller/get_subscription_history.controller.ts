import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { GetSubscriptionHistoryUseCase } from "../../application/use_case/get_subscription_history";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
} from "../../../core/application/dto/pagination";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object({
  page: z.coerce.number().int().positive().default(DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT),
});

const outputSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().uuid(),
      type: z.enum([
        "started",
        "plan_changed",
        "payment_failed",
        "canceled",
        "renewed",
      ]),
      resulting_status: z.enum(["trialing", "active", "past_due", "canceled"]),
      plan_id: z.string().uuid(),
      plan_code: z.string(),
      plan_name: z.string(),
      occurred_at: z.string().datetime(),
      access_until: z.string().datetime().nullable(),
      reason: z.string().nullable(),
    })
  ),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
    has_next: z.boolean(),
    has_previous: z.boolean(),
  }),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Deliberately `allowWithoutPlatformAccess: true` in routes.ts — same
 * reasoning as `GET /billing/subscription` (DA-4): a blocked account still
 * needs to see the timeline that explains why it's blocked.
 */
export class GetSubscriptionHistoryController implements Controller {
  path = "/billing/subscription/history";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Get subscription history",
    description:
      "Returns a paginated, append-only timeline of everything that happened to the authenticated user's own subscription.",
    tags: ["Billing"],
    parameters: [
      {
        name: "page",
        in: "query",
        required: false,
        schema: { type: "integer", default: DEFAULT_PAGE },
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", default: DEFAULT_LIMIT },
      },
    ],
    responses: {
      "200": responseFromZod("Paginated subscription history", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: GetSubscriptionHistoryUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    return this.useCase.execute(
      { pagination: { page: input.page, limit: input.limit } },
      user
    );
  }
}
