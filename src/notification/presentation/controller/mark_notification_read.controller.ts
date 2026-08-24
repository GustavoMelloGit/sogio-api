import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { MarkNotificationReadUseCase } from "../../application/use_case/mark_notification_read";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const inputSchema = z
  .object({
    notification_id: z.uuidv4("Notification ID must be a valid UUID"),
  })
  .strict();

const outputSchema = z.object({
  id: z.uuid(),
  read_at: z.iso.datetime(),
});

type Input = z.infer<typeof inputSchema>;

export class MarkNotificationReadController implements Controller {
  path = "/notifications/:notification_id/read";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;

  openApiSpec: OpenApiOperation = {
    summary: "Mark notification as read",
    description:
      "Marks one of the authenticated user's own delivered notifications as read. Returns 200 with the read_at timestamp instead of 204, so a client can update a badge without refetching the inbox. Marking an already-read notification again is a no-op that returns the same read_at.",
    tags: ["Notifications"],
    parameters: [
      {
        name: "notification_id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      "200": responseFromZod("Notification marked as read", outputSchema, {
        id: "b8a1f4d2-6c3e-4f57-9a20-5e7d1c8b3f92",
        read_at: "2026-08-18T09:12:44.000Z",
      }),
      "401": errorResponse("Unauthorized"),
      "404": errorResponse(
        "Notification not found, not owned by the caller, or never delivered"
      ),
    },
  };

  constructor(private readonly useCase: MarkNotificationReadUseCase) {}

  async handle(request: ControllerRequest, user: User) {
    const input = request.body as Input;

    return this.useCase.execute(
      { notification_id: input.notification_id },
      user
    );
  }
}
