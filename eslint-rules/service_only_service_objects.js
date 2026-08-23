const ALLOWED_DECLARATIONS = [
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
];

/**
 * `application/service/` holds application services: objects that coordinate
 * collaborators to carry out one application task, plus the outbound ports
 * the application declares for infrastructure to implement. A free function
 * is neither — it has no collaborators to hold, so whatever it does is
 * either pure content (`application/content/`) or a business rule
 * (`domain/`).
 *
 * The rule cannot prove a class *is* an application service. What it can
 * prove is that the file publishes a service-shaped thing, which is enough
 * to force the question at the moment of writing — the same job
 * `handler-only-event-handlers` does for the directory next door.
 */
export const serviceOnlyServiceObjects = {
  meta: {
    type: "problem",
    docs: {
      description:
        "only classes and the ports they implement may be exported from an application/service directory",
    },
    messages: {
      notAServiceObject:
        "`{{name}}` is exported from application/service/ but is not a class or an interface. An application service coordinates collaborators — move pure content to application/content/ and business rules to domain/.",
      unnamedExport:
        "Only classes and interfaces may be exported from application/service/. Move pure content to application/content/ and business rules to domain/.",
    },
    schema: [],
  },
  create(context) {
    function reportDeclaration(declaration, fallbackNode) {
      if (ALLOWED_DECLARATIONS.includes(declaration.type)) {
        return;
      }

      const name =
        declaration.id?.name ?? declaration.declarations?.[0]?.id?.name ?? null;

      context.report({
        node: declaration.id ?? fallbackNode,
        messageId: name ? "notAServiceObject" : "unnamedExport",
        data: { name },
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
            messageId: "notAServiceObject",
            data: {
              name: specifier.local?.name ?? specifier.exported?.name,
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

        context.report({ node, messageId: "unnamedExport" });
      },
    };
  },
};
