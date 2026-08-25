import { describe, it } from "bun:test";
import { RuleTester } from "eslint";
import { zodArrayMax } from "../../eslint-rules/zod_array_max.js";
import { zodIntBounds } from "../../eslint-rules/zod_int_bounds.js";
import { zodStringMax } from "../../eslint-rules/zod_string_max.js";
import { handlerOnlyEventHandlers } from "../../eslint-rules/handler_only_event_handlers.js";
import { serviceOnlyServiceObjects } from "../../eslint-rules/service_only_service_objects.js";
import { noInlineInputSchema } from "../../eslint-rules/no_inline_input_schema.js";
import tsParser from "@typescript-eslint/parser";

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

describe("sogio/zod-array-max", () => {
  it("enforces an upper bound on the number of items in a zod array", () => {
    ruleTester.run("zod-array-max", zodArrayMax as never, {
      valid: [
        "const inputSchema = z.array(z.string().max(100)).max(50);",
        "const inputSchema = z.array(z.string().max(100)).length(3);",
        "const inputSchema = z.array(z.string().max(100)).max(50).optional();",
        "const inputSchema = z.object({ tags: z.array(z.string().max(20)).max(10) });",
        "const outputSchema = z.object({ images: z.array(z.string()) });",
        "const stayItemOutputSchema = z.object({ images: z.array(z.string()) });",
        "const listResponseSchema = z.object({ images: z.array(z.string()) });",
        "const value = builder.array();",
      ],
      invalid: [
        {
          code: "const inputSchema = z.array(z.string().max(100));",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.array(z.string().max(100)).optional();",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.object({ images: z.array(z.string().max(2048)) });",
          errors: [{ messageId: "missingMax" }],
        },
        {
          code: "const inputSchema = z.array(z.string().max(100)).min(1);",
          errors: [{ messageId: "missingMax" }],
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

describe("sogio/no-inline-input-schema", () => {
  it("requires input schemas to be imported from presentation/schema/", () => {
    ruleTester.run("no-inline-input-schema", noInlineInputSchema as never, {
      valid: [
        "const inputSchema = z.object(createPropertyInput);",
        "const inputSchema = z.object(bookStayInput).extend({ check_in: z.coerce.date() });",
        "const inputSchema = z.object(bookStayInput).omit({ property_id: true });",
        "const inputSchema = createPropertyInputSchema;",
        "const inputSchema = { ...createPropertyInput };",
        "const inputSchema = { q: tenantSearchQuery };",
        "const recordSchema = z.object({ price: shape.price.describe('x') });",
        "const outputSchema = z.object({ id: z.string() });",
        "const addressSchema = z.object({ street: z.string() });",
      ],
      invalid: [
        {
          code: "const inputSchema = z.object({ name: z.string() });",
          errors: [{ messageId: "inlineInputSchema" }],
        },
        {
          code: "const inputSchema = { name: z.string() };",
          errors: [{ messageId: "inlineInputSchema" }],
        },
        {
          code: "export const inputSchema = { name: z.string().max(10) };",
          errors: [{ messageId: "inlineInputSchema" }],
        },
        {
          code: "const recordSchema = z.object({ price: z.number() });",
          errors: [{ messageId: "inlineInputSchema" }],
        },
      ],
    });
  });
});

const tsRuleTester = new RuleTester({
  languageOptions: {
    parser: tsParser as never,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

describe("sogio/handler-only-event-handlers", () => {
  it("keeps application/handler/ for event handlers only", () => {
    tsRuleTester.run(
      "handler-only-event-handlers",
      handlerOnlyEventHandlers as never,
      {
        valid: [
          "export class NotifyOnX implements EventHandler<XEvent> { async handle() {} }",
          "export class NotifyOnX implements Something, EventHandler<XEvent> { async handle() {} }",
          "export type StayReference = { id: string };",
          "export interface Whatever { id: string }",
          "function helper() {} export class NotifyOnX implements EventHandler<XEvent> { async handle() { helper(); } }",
          "const DATE = 1; export class NotifyOnX implements EventHandler<XEvent> { async handle() {} }",
          'export type { Thing } from "./thing";',
        ],
        invalid: [
          {
            code: "export function describeStayRevenue() { return 1; }",
            errors: [{ messageId: "notAnEventHandler" }],
          },
          {
            code: "export const STAY_TIME_ZONE = 'America/Sao_Paulo';",
            errors: [{ messageId: "notAnEventHandler" }],
          },
          {
            code: "export class PlainHelper { run() {} }",
            errors: [{ messageId: "notAnEventHandler" }],
          },
          {
            code: "export class NotifyOnX implements SomethingElse { async handle() {} }",
            errors: [{ messageId: "notAnEventHandler" }],
          },
          {
            code: 'export * from "./helpers";',
            errors: [{ messageId: "unnamedExport" }],
          },
          {
            code: "function helper() {} export { helper };",
            errors: [{ messageId: "notAnEventHandler" }],
          },
        ],
      }
    );
  });
});

describe("sogio/service-only-service-objects", () => {
  it("keeps application/service/ for application services and their ports", () => {
    tsRuleTester.run(
      "service-only-service-objects",
      serviceOnlyServiceObjects as never,
      {
        valid: [
          "export class SessionManager implements ISessionManager { async createSession() {} }",
          "export interface Hasher { hash(value: string): Promise<string> }",
          "export type NotifyInput = { user_id: string };",
          "const DEFAULTS = { locale: 'pt-BR' }; export class X { run() { return DEFAULTS; } }",
          "function helper() {} export class X { run() { helper(); } }",
          'export type { Thing } from "./thing";',
        ],
        invalid: [
          {
            code: "export function revokeConsentCascade() {}",
            errors: [{ messageId: "notAServiceObject" }],
          },
          {
            code: "export const STAY_TIME_ZONE = 'America/Sao_Paulo';",
            errors: [{ messageId: "notAServiceObject" }],
          },
          {
            code: "export async function composePasswordResetEmail() {}",
            errors: [{ messageId: "notAServiceObject" }],
          },
          {
            code: 'export * from "./helpers";',
            errors: [{ messageId: "unnamedExport" }],
          },
          {
            code: "function helper() {} export { helper };",
            errors: [{ messageId: "notAServiceObject" }],
          },
        ],
      }
    );
  });
});
