import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConflictError } from "../../application/error/conflict_error";
import { ForbiddenError } from "../../application/error/forbidden_error";
import { ResourceNotFoundError } from "../../application/error/resource_not_found_error";
import { TooManyRequestsError } from "../../application/error/too_many_requests_error";
import { UnauthorizedError } from "../../application/error/unauthorized_error";
import { ValidationError } from "../../application/error/validation_error";

const domainErrorNames = new Set<string>([
  ConflictError.name,
  ForbiddenError.name,
  ResourceNotFoundError.name,
  TooManyRequestsError.name,
  UnauthorizedError.name,
  ValidationError.name,
]);

export function mapErrorToToolResult(error: unknown): CallToolResult {
  if (Error.isError(error) && domainErrorNames.has(error.name)) {
    return toolErrorResult(error.message);
  }

  return toolErrorResult("Internal server error");
}

function toolErrorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
