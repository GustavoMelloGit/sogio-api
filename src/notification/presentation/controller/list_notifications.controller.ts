import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { ListNotificationsUseCase } from "../../application/use_case/list_notifications";
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  paginatedOutputSchema,
  paginationFields,
  toPaginationInput,
} from "../../../core/application/dto/pagination";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z.object(paginationFields);

const notificationOutputSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  created_at: z.iso.datetime(),
  read_at: z.iso.datetime().nullable(),
});

const outputSchema = paginatedOutputSchema(notificationOutputSchema).extend({
  unread_count: z.number().int(),
});

type Input = z.infer<typeof inputSchema>;

export class ListNotificationsController implements Controller {
  path = "/notifications";
  method = HttpControllerMethod.GET;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "List notifications",
    description:
      "Returns the authenticated user's own notification inbox, paginated, newest first. Only notifications that were actually delivered appear: one still pending or one the platform gave up retrying (failed) never shows up here. title and body are rendered on the fly, in the caller's own locale and time zone, from the facts stored with the notification. unread_count covers the whole inbox, not just the current page.",
    tags: ["Notifications"],
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
      "200": responseFromZod("Paginated notification inbox", outputSchema, {
        data: [
          {
            id: "b8a1f4d2-6c3e-4f57-9a20-5e7d1c8b3f92",
            type: "subscription_payment_failed",
            title: "Falha no pagamento da sua assinatura",
            body: "Não conseguimos processar o pagamento da sua assinatura. Regularize até 10/06/2040 para não perder o acesso à plataforma.",
            created_at: "2026-08-18T09:12:44.000Z",
            read_at: null,
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
        unread_count: 1,
      }),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: ListNotificationsUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    return this.useCase.execute({ pagination: toPaginationInput(input) }, user);
  }
}
