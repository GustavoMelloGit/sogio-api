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
      "200": responseFromZod("Paginated subscription history", outputSchema, {
        data: [
          {
            id: "b8a1f4d2-6c3e-4f57-9a20-5e7d1c8b3f92",
            type: "payment_failed",
            resulting_status: "past_due",
            plan_id: "7b2d9e04-1c5f-4e83-8a77-9f0c3b5d2e64",
            plan_code: "pro",
            plan_name: "Pro",
            occurred_at: "2026-08-18T09:12:44.000Z",
            access_until: "2026-08-25T09:12:44.000Z",
            reason: "insufficient_funds",
          },
          {
            id: "1d5c8e30-9b47-4a62-8f13-c0a6d2b74e51",
            type: "started",
            resulting_status: "trialing",
            plan_id: "7b2d9e04-1c5f-4e83-8a77-9f0c3b5d2e64",
            plan_code: "pro",
            plan_name: "Pro",
            occurred_at: "2026-08-01T14:03:07.000Z",
            access_until: "2026-08-15T14:03:07.000Z",
            reason: null,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      }),
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
