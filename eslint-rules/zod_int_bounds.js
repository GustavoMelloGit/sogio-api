import {
  chainedMethodsAfter,
  isIgnoredSchema,
  isZodChain,
  ignoredSchemaNamesOption,
} from "./schema_scope.js";

const LOWER_BOUND_METHODS = ["min", "gte", "positive", "nonnegative"];
const UPPER_BOUND_METHODS = ["max", "lte", "negative", "nonpositive"];

export const zodIntBounds = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require an explicit lower and upper bound on zod integer schemas",
    },
    messages: {
      missingBounds: "z.int() must declare {{missing}}.",
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
        if (callee.property.name !== "int") return;
        if (isIgnoredSchema(node, ignoredSchemaNames)) return;

        const chained = chainedMethodsAfter(node);
        const missing = [];
        if (!chained.some(method => LOWER_BOUND_METHODS.includes(method))) {
          missing.push(".min()");
        }
        if (!chained.some(method => UPPER_BOUND_METHODS.includes(method))) {
          missing.push(".max()");
        }
        if (missing.length === 0) return;

        context.report({
          node: callee.property,
          messageId: "missingBounds",
          data: { missing: missing.join(" and ") },
        });
      },
    };
  },
};
