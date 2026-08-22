import z from "zod";
import {
  HttpControllerMethod,
  type Controller,
} from "../../../core/presentation/controller/controller";
import type { ListPlansUseCase } from "../../application/use_case/list_plans";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import { responseFromZod } from "../../../core/infra/http/swagger/schema_helpers";

const outputSchema = z.array(
  z.object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    price_amount: z.int(),
    billing_interval: z.string(),
    max_properties: z.int(),
    trial_days: z.int(),
  })
);

export class ListPlansController implements Controller {
  path = "/billing/plans";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "List plans",
    description:
      "Returns every plan currently offered, for the public pricing page. No authentication required.",
    tags: ["Billing"],
    responses: {
      "200": responseFromZod("Plans currently offered", outputSchema, [
        {
          id: "3f1c6a92-8f4c-4a1a-9b0e-2d6b7c1f4a10",
          code: "free",
          name: "Free",
          price_amount: 0,
          billing_interval: "monthly",
          max_properties: 1,
          trial_days: 0,
        },
        {
          id: "7b2d9e04-1c5f-4e83-8a77-9f0c3b5d2e64",
          code: "pro",
          name: "Pro",
          price_amount: 2500,
          billing_interval: "monthly",
          max_properties: 5,
          trial_days: 14,
        },
      ]),
    },
  };

  constructor(private readonly useCase: ListPlansUseCase) {}

  async handle() {
    const plans = await this.useCase.execute();

    return plans.map(plan => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      price_amount: plan.price_amount,
      billing_interval: plan.billing_interval,
      max_properties: plan.max_properties,
      trial_days: plan.trial_days,
    }));
  }
}
