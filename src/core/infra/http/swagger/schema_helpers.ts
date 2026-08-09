import { z } from "zod";
import type {
  OpenApiRequestBody,
  OpenApiResponse,
} from "../../../presentation/open_api/open_api_types";

function toSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema, ...rest } = z.toJSONSchema(schema, {
    unrepresentable: "any",
  }) as Record<string, unknown>;
  return rest;
}

export function bodyFromZod(
  schema: z.ZodTypeAny,
  opts?: {
    description?: string;
    required?: boolean;
    example?: Record<string, unknown>;
  }
): OpenApiRequestBody {
  return {
    description: opts?.description,
    required: opts?.required ?? true,
    content: {
      "application/json": {
        schema: toSchema(schema),
        example: opts?.example,
      },
    },
  };
}

export function responseFromZod(
  description: string,
  schema: z.ZodTypeAny,
  example?: Record<string, unknown>
): OpenApiResponse {
  return {
    description,
    content: {
      "application/json": {
        schema: toSchema(schema),
        ...(example ? { example } : {}),
      },
    },
  };
}

export function errorResponse(description: string): OpenApiResponse {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
      },
    },
  };
}

export function validationErrorResponse(): OpenApiResponse {
  return errorResponse("Validation error — invalid request body");
}

export function noContentResponse(description: string): OpenApiResponse {
  return { description };
}
