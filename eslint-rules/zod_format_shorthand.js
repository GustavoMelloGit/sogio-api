import { isZodChain } from "./schema_scope.js";

const ISO_FORMATS = ["datetime", "date", "time", "duration"];

const TOP_LEVEL_FORMATS = [
  "uuid",
  "uuidv4",
  "uuidv7",
  "guid",
  "url",
  "httpUrl",
  "hostname",
  "email",
  "jwt",
  "emoji",
  "e164",
  "base64",
  "base64url",
  "nanoid",
  "cuid",
  "cuid2",
  "ulid",
  "ipv4",
  "ipv6",
  "cidrv4",
  "cidrv6",
];

function replacementFor(format) {
  if (ISO_FORMATS.includes(format)) return `z.iso.${format}()`;
  return `z.${format}()`;
}

function chainIncludesStringCall(node) {
  let current = node;
  while (current.type === "CallExpression") {
    const callee = current.callee;
    if (callee.type !== "MemberExpression") return false;
    if (callee.computed) return false;
    if (callee.property.type !== "Identifier") return false;
    if (callee.property.name === "string") return true;
    current = callee.object;
  }
  return false;
}

export const zodFormatShorthand = {
  meta: {
    type: "problem",
    docs: {
      description:
        "forbid the z.string().<format>() spelling in favor of the zod 4 top-level format factories",
    },
    messages: {
      useTopLevelFactory:
        "z.string().{{format}}() is the old spelling. Use {{replacement}} instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;
        if (callee.computed) return;
        if (callee.property.type !== "Identifier") return;

        const format = callee.property.name;
        if (
          !ISO_FORMATS.includes(format) &&
          !TOP_LEVEL_FORMATS.includes(format)
        ) {
          return;
        }
        if (!isZodChain(node)) return;
        if (!chainIncludesStringCall(callee.object)) return;

        context.report({
          node: callee.property,
          messageId: "useTopLevelFactory",
          data: { format, replacement: replacementFor(format) },
        });
      },
    };
  },
};
