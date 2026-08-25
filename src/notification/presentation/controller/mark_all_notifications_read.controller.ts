import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { User } from "../../../auth/domain/entity/user";
import type { MarkAllNotificationsReadUseCase } from "../../application/use_case/mark_all_notifications_read";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.object({
  marked_as_read: z.number().int(),
});

export class MarkAllNotificationsReadController implements Controller {
  path = "/notifications/read-all";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Mark every notification as read",
    description:
      "Marks every unread notification in the authenticated user's own inbox as read, and returns how many were marked. Only delivered notifications are affected, which is exactly the set the inbox listing shows. Calling it again returns 0.",
    tags: ["Notifications"],
    responses: {
      "200": responseFromZod(
        "Number of notifications marked as read",
        outputSchema,
        {
          marked_as_read: 3,
        }
      ),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: MarkAllNotificationsReadUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    return this.useCase.execute({}, user);
  }
}
