import {
  chainedMethodsAfter,
  isIgnoredSchema,
  isZodChain,
  ignoredSchemaNamesOption,
} from "./schema_scope.js";

const UPPER_BOUND_METHODS = ["max", "length"];

const SELF_BOUNDED_FORMATS = [
  "uuid",
  "guid",
  "ulid",
  "cuid",
  "cuid2",
  "nanoid",
  "datetime",
  "date",
  "time",
  "duration",
  "ip",
  "ipv4",
  "ipv6",
  "cidrv4",
  "cidrv6",
  "base64",
  "e164",
  "emoji",
];

const UNBOUNDED_STRING_FACTORIES = [
  "string",
  "email",
  "url",
  "jwt",
  "base64url",
];

export const zodStringMax = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require an explicit .max() on zod string schemas that accept untrusted input",
    },
    messages: {
      missingMax: "z.{{factory}}() must declare .max() or .length().",
    },
    schema: [ignoredSchemaNamesOption],
  },
  create(context) {
    const ignoredSchemaNames = context.options[0]?.ignoredSchemaNames;

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed) return;
        if (callee.property.type !== "Identifier") return;
        if (!isZodChain(node)) return;

        const factory = callee.property.name;
        if (!UNBOUNDED_STRING_FACTORIES.includes(factory)) return;
        if (isIgnoredSchema(node, ignoredSchemaNames)) return;

        const chained = chainedMethodsAfter(node);
        if (chained.some(method => SELF_BOUNDED_FORMATS.includes(method))) {
          return;
        }
        if (chained.some(method => UPPER_BOUND_METHODS.includes(method))) {
          return;
        }

        context.report({
          node: callee.property,
          messageId: "missingMax",
          data: { factory },
        });
      },
    };
  },
};
