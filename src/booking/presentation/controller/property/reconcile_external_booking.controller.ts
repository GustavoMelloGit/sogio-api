import z from "zod";
import type { ReconcileExternalBookingsUseCase } from "../../../application/use_case/property/reconcile_external_bookings";
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

const outputSchema = z.array(
  z.object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    sourcePlatform: z.enum(["AIRBNB", "BOOKING"]),
    property: z.object({
      id: z.uuid(),
      name: z.string(),
    }),
  })
);

export class ReconcileExternalBookingController implements Controller {
  path = "/booking/reconcile-external-booking";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "Reconcile external bookings",
    description:
      "Fetches bookings from external platforms (Airbnb, Booking) and returns those not yet registered internally.",
    tags: ["Booking"],
    responses: {
      "200": responseFromZod("Unreconciled external bookings", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: ReconcileExternalBookingsUseCase) {}

  async handle(_req: ControllerRequest, user: User) {
    const output = await this.useCase.execute({ user });
    return output;
  }
}
