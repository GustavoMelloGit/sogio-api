import { z } from "zod";
import type { RateLimitPolicy } from "../../../core/application/rate_limit/rate_limit_policy";
import {
  bodyFromZod,
  errorResponse,
  responseFromZod,
  validationErrorResponse,
} from "../../../core/infra/http/swagger/schema_helpers";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../core/presentation/open_api/open_api_types";
import type { JoinWaitlistUseCase } from "../../application/use_case/join_waitlist";
import { PROPERTY_COUNT_RANGES } from "../../domain/entity/waitlist_lead";

const RATE_LIMIT_POLICY: RateLimitPolicy = {
  keyDimension: "peer-ip",
  windowMs: 10 * 60 * 1000,
  maxAttempts: 5,
};

const inputSchema = z.object({
  name: z.string().min(2).max(255),
  whatsapp: z.string().min(1).max(30),
  property_count: z.enum(PROPERTY_COUNT_RANGES),
  source: z.string().max(50).optional(),
});

const outputSchema = z.object({
  id: z.uuidv4(),
});

type Input = z.infer<typeof inputSchema>;

export class JoinWaitlistController implements Controller {
  path = "/waitlist";
  method = HttpControllerMethod.POST;
  inputSchema = inputSchema;
  parameterSource = "json" as const;
  corsPolicy = "public" as const;
  rateLimitPolicy = RATE_LIMIT_POLICY;

  openApiSpec: OpenApiOperation = {
    summary: "Join the waitlist",
    description:
      "Registers a lead from the landing page waitlist. Public route: no authentication, and any Authorization header is ignored. Joining twice with the same WhatsApp number updates the existing lead and answers 201 again.",
    tags: ["Marketing"],
    requestBody: bodyFromZod(inputSchema, {
      example: {
        name: "Maria Silva",
        whatsapp: "11987654321",
        property_count: "2-3",
        source: "landing",
      },
    }),
    responses: {
      "201": responseFromZod("Lead registered", outputSchema),
      "422": validationErrorResponse(),
      "429": errorResponse("Too many requests from this IP"),
    },
  };

  constructor(private readonly useCase: JoinWaitlistUseCase) {}

  async handle(request: ControllerRequest) {
    const output = await this.useCase.execute(request.body as Input);

    return new ControllerHttpResponse({ status: 201, body: output });
  }
}
