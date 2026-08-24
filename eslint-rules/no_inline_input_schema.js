import { isZodChain } from "./schema_scope.js";

const DEFAULT_TARGET_SCHEMA_NAMES = [
  "^inputSchema$",
  "^recordSchema$",
  "^recordInputSchema$",
  "InputSchema$",
];

const targetSchemaNamesOption = {
  type: "object",
  properties: {
    schemaNames: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
};

function isZodObjectCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "z" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "object"
  );
}

function zodObjectArgument(node) {
  if (isZodObjectCall(node)) {
    return node.arguments[0] ?? null;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression"
  ) {
    return zodObjectArgument(node.callee.object);
  }
  return null;
}

function hasOwnLiteralProperty(objectExpression) {
  return objectExpression.properties.some(
    property => property.type === "Property"
  );
}

function inlineShapeLiteral(init) {
  if (init.type === "ObjectExpression") {
    return hasOwnLiteralProperty(init) ? init : null;
  }
  if (init.type === "CallExpression" && isZodChain(init)) {
    const argument = zodObjectArgument(init);
    if (
      argument?.type === "ObjectExpression" &&
      hasOwnLiteralProperty(argument)
    ) {
      return argument;
    }
  }
  return null;
}

export const noInlineInputSchema = {
  meta: {
    type: "problem",
    docs: {
      description:
        "require input schemas in presentation/controller and presentation/mcp_tool to be imported from presentation/schema instead of declared inline",
    },
    messages: {
      inlineInputSchema:
        "{{name}} must be imported from presentation/schema/ — a use case reachable over HTTP and MCP has one input contract, not two.",
    },
    schema: [targetSchemaNamesOption],
  },
  create(context) {
    const patterns =
      context.options[0]?.schemaNames ?? DEFAULT_TARGET_SCHEMA_NAMES;

    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier") return;
        if (!node.init) return;
        if (!patterns.some(source => new RegExp(source).test(node.id.name))) {
          return;
        }

        const literal = inlineShapeLiteral(node.init);
        if (!literal) return;

        context.report({
          node: literal,
          messageId: "inlineInputSchema",
          data: { name: node.id.name },
        });
      },
    };
  },
};
