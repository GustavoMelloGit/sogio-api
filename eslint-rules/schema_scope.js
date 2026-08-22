const DEFAULT_IGNORED_SCHEMA_NAMES = [
  "^outputSchema$",
  "OutputSchema$",
  "ResponseSchema$",
];

export function enclosingSchemaName(node) {
  let current = node;
  while (current) {
    if (
      current.type === "VariableDeclarator" &&
      current.id.type === "Identifier"
    ) {
      return current.id.name;
    }
    if (
      current.type === "FunctionDeclaration" ||
      current.type === "ClassDeclaration" ||
      current.type === "Program"
    ) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

export function isIgnoredSchema(node, patterns) {
  const name = enclosingSchemaName(node);
  if (!name) return false;
  const sources = patterns ?? DEFAULT_IGNORED_SCHEMA_NAMES;
  return sources.some(source => new RegExp(source).test(name));
}

export function chainedMethodsAfter(node) {
  const methods = [];
  let current = node;
  while (
    current.parent &&
    current.parent.type === "MemberExpression" &&
    current.parent.object === current &&
    current.parent.parent &&
    current.parent.parent.type === "CallExpression" &&
    current.parent.parent.callee === current.parent
  ) {
    if (current.parent.property.type === "Identifier") {
      methods.push(current.parent.property.name);
    }
    current = current.parent.parent;
  }
  return methods;
}

export const ignoredSchemaNamesOption = {
  type: "object",
  properties: {
    ignoredSchemaNames: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
};

export function isZodChain(node) {
  let current = node.callee;
  while (current) {
    if (current.type === "MemberExpression") {
      current = current.object;
      continue;
    }
    if (current.type === "CallExpression") {
      current = current.callee;
      continue;
    }
    return current.type === "Identifier" && current.name === "z";
  }
  return false;
}
