const EVENT_HANDLER_INTERFACE = "EventHandler";

const TYPE_ONLY_DECLARATIONS = [
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
];

function implementsEventHandler(node) {
  const clauses = node.implements ?? [];

  return clauses.some(clause => {
    const expression = clause.expression;

    return (
      expression?.type === "Identifier" &&
      expression.name === EVENT_HANDLER_INTERFACE
    );
  });
}

/**
 * `application/handler/` is where a bounded context reacts to domain events,
 * and nothing else. A helper that drifts in there stops being findable by
 * anyone reading the directory as "the list of things this BC reacts to",
 * and the directory stops meaning anything.
 *
 * Non-exported helpers are untouched: a handler is free to keep its own
 * private functions. What the rule governs is what the file publishes.
 */
export const handlerOnlyEventHandlers = {
  meta: {
    type: "problem",
    docs: {
      description:
        "only classes implementing EventHandler may be exported from an application/handler directory",
    },
    messages: {
      notAnEventHandler:
        "`{{name}}` is exported from application/handler/ but does not implement {{interface}}. Move it to application/service/ or domain/, and keep handler/ for event handlers only.",
      unnamedExport:
        "Only classes implementing {{interface}} may be exported from application/handler/. Move this to application/service/ or domain/.",
    },
    schema: [],
  },
  create(context) {
    function reportDeclaration(declaration, fallbackNode) {
      if (TYPE_ONLY_DECLARATIONS.includes(declaration.type)) {
        return;
      }

      if (
        declaration.type === "ClassDeclaration" &&
        implementsEventHandler(declaration)
      ) {
        return;
      }

      const name =
        declaration.id?.name ?? declaration.declarations?.[0]?.id?.name ?? null;

      context.report({
        node: declaration.id ?? fallbackNode,
        messageId: name ? "notAnEventHandler" : "unnamedExport",
        data: { name, interface: EVENT_HANDLER_INTERFACE },
      });
    }

    return {
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type") {
          return;
        }

        if (node.declaration) {
          reportDeclaration(node.declaration, node);
          return;
        }

        for (const specifier of node.specifiers) {
          if (specifier.exportKind === "type") {
            continue;
          }

          context.report({
            node: specifier,
            messageId: "notAnEventHandler",
            data: {
              name: specifier.local?.name ?? specifier.exported?.name,
              interface: EVENT_HANDLER_INTERFACE,
            },
          });
        }
      },

      ExportDefaultDeclaration(node) {
        reportDeclaration(node.declaration, node);
      },

      ExportAllDeclaration(node) {
        if (node.exportKind === "type") {
          return;
        }

        context.report({
          node,
          messageId: "unnamedExport",
          data: { interface: EVENT_HANDLER_INTERFACE },
        });
      },
    };
  },
};
