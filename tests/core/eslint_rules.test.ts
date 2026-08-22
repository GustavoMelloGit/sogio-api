import { describe, it } from "bun:test";
import { RuleTester } from "eslint";
import { zodIntBounds } from "../../eslint-rules/zod_int_bounds.js";
import { zodStringMax } from "../../eslint-rules/zod_string_max.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("sogio/zod-int-bounds", () => {
  it("enforces explicit bounds on zod integers", () => {
    ruleTester.run("zod-int-bounds", zodIntBounds as never, {
      valid: [
        "const inputSchema = z.int().min(1).max(10);",
        "const inputSchema = z.number().int().gte(0).lte(100);",
        "const inputSchema = z.int().min(1).max(50).default(20);",
        "const inputSchema = z.coerce.number().int().positive().max(3600);",
        "const outputSchema = z.object({ total: z.int() });",
        "const stayOutputSchema = z.object({ total: z.int() });",
        "const listResponseSchema = z.object({ total: z.int() });",
        "const value = parser.int();",
      ],
      invalid: [
        {
          code: "const inputSchema = z.int();",
          errors: [{ messageId: "missingBounds" }],
        },
        {
          code: "const inputSchema = z.int().min(1);",
          errors: [{ messageId: "missingBounds" }],
        },
        {
          code: "const inputSchema = z.number().int().positive();",
          errors: [{ messageId: "missingBounds" }],
        },
        {
          code: "const inputSchema = z.object({ page: z.int().positive() });",
          errors: [{ messageId: "missingBounds" }],
        },
      ],
    });
  });
});

describe("sogio/zod-string-max", () => {
  it("enforces an upper bound on unbounded zod strings", () => {
    ruleTester.run("zod-string-max", zodStringMax as never, {
      valid: [
        "const inputSchema = z.string().max(100);",
        "const inputSchema = z.string().min(2).max(100);",
        "const inputSchema = z.string().length(13);",
        "const inputSchema = z.email().max(255);",
        "const inputSchema = z.uuid();",
        "const inputSchema = z.string().uuid();",
        "const inputSchema = z.string().datetime();",
        "const outputSchema = z.object({ name: z.string() });",
        "const value = builder.string();",
      ],
      invalid: [
        {
          code: "const inputSchema = z.string();",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.string().min(2);",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.email();",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.object({ name: z.string().trim() });",
          errors: [{ messageId: "missingMax" }],
        },
      ],
    });
  });
});
