import { describe, it } from "bun:test";
import { RuleTester } from "eslint";
import { zodFormatShorthand } from "../../eslint-rules/zod_format_shorthand.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("sogio/zod-format-shorthand", () => {
  it("forbids the z.string().<format>() spelling", () => {
    ruleTester.run("zod-format-shorthand", zodFormatShorthand as never, {
      valid: [
        "const inputSchema = z.uuid();",
        "const inputSchema = z.uuid().max(36);",
        "const inputSchema = z.iso.datetime();",
        "const inputSchema = z.email().max(255);",
        "const inputSchema = z.string().max(100);",
        "const inputSchema = z.string().min(2);",
        "const value = builder.string().uuid();",
      ],
      invalid: [
        {
          code: "const inputSchema = z.string().uuid();",
          errors: [
            {
              messageId: "useTopLevelFactory",
              data: { format: "uuid", replacement: "z.uuid()" },
            },
          ],
        },
        {
          code: "const inputSchema = z.string().datetime();",
          errors: [
            {
              messageId: "useTopLevelFactory",
              data: { format: "datetime", replacement: "z.iso.datetime()" },
            },
          ],
        },
        {
          code: "const inputSchema = z.string().max(100).uuid();",
          errors: [
            {
              messageId: "useTopLevelFactory",
              data: { format: "uuid", replacement: "z.uuid()" },
            },
          ],
        },
        {
          code: "const inputSchema = z.object({ id: z.string().uuid() });",
          errors: [
            {
              messageId: "useTopLevelFactory",
              data: { format: "uuid", replacement: "z.uuid()" },
            },
          ],
        },
      ],
    });
  });
});
