import { describe, expect, it } from "bun:test";
import { ConflictError } from "../../src/core/application/error/conflict_error";
import { ForbiddenError } from "../../src/core/application/error/forbidden_error";
import { IllegalStateError } from "../../src/core/application/error/illegal_state_error";
import { ResourceNotFoundError } from "../../src/core/application/error/resource_not_found_error";
import { UnauthorizedError } from "../../src/core/application/error/unauthorized_error";
import { ValidationError } from "../../src/core/application/error/validation_error";
import { mapErrorToToolResult } from "../../src/core/infra/mcp/mcp_error_mapper";

describe("mapErrorToToolResult", () => {
  it.each([
    ["ConflictError", new ConflictError("Property already booked")],
    ["ForbiddenError", new ForbiddenError("You cannot manage this property")],
    ["IllegalStateError", new IllegalStateError("Invalid stay state")],
    ["ResourceNotFoundError", new ResourceNotFoundError("Stay not found")],
    ["UnauthorizedError", new UnauthorizedError("Unauthorized")],
    ["ValidationError", new ValidationError("Invalid input")],
  ])("surfaces the domain message for %s", (_name, error) => {
    const result = mapErrorToToolResult(error);

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: error.message }]);
  });

  it("returns a generic message for an unmapped Error", () => {
    const result = mapErrorToToolResult(new Error("some internal detail"));

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Internal server error" },
    ]);
  });

  it("returns a generic message for a non-Error throwable", () => {
    const result = mapErrorToToolResult("boom");

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "Internal server error" },
    ]);
  });

  it("does not leak the stack trace for unmapped errors", () => {
    const error = new Error("sensitive stack trace details");

    const result = mapErrorToToolResult(error);

    const [content] = result.content;
    expect(content?.type).toBe("text");
    if (content?.type === "text") {
      expect(content.text).not.toContain("sensitive stack trace details");
    }
  });
});
