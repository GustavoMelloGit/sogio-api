import {
  chainedMethodsAfter,
  isIgnoredSchema,
  isZodChain,
  ignoredSchemaNamesOption,
} from "./schema_scope.js";

const UPPER_BOUND_METHODS = ["max", "length", "nonempty"];

export const zodArrayMax = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require an explicit .max() on zod array schemas that accept untrusted input",
    },
    messages: {
      missingMax: "z.array() must declare .max() or .length().",
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
        if (callee.property.name !== "array") return;
        if (!isZodChain(node)) return;
        if (isIgnoredSchema(node, ignoredSchemaNames)) return;

        const chained = chainedMethodsAfter(node);
        if (chained.some(method => UPPER_BOUND_METHODS.includes(method))) {
          return;
        }

        context.report({ node: callee.property, messageId: "missingMax" });
      },
    };
  },
};
