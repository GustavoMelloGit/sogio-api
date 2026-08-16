import type { Controller } from "../../../presentation/controller/controller";

type RouteDefinition = {
  authenticated: boolean;
  controller: Controller;
};

type OpenApiSpec = {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  components: {
    securitySchemes: Record<string, unknown>;
  };
  paths: Record<string, Record<string, unknown>>;
};

export class OpenApiBuilder {
  constructor(private readonly routes: RouteDefinition[]) {}

  build(): OpenApiSpec {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const { authenticated, controller } of this.routes) {
      if (!controller.openApiSpec) continue;

      const openApiPath = this.#toBracketPath(controller.path);
      const method = controller.method.toLowerCase();

      const operation: Record<string, unknown> = { ...controller.openApiSpec };

      if (authenticated) {
        operation.security = [{ bearerAuth: [] }];
      }

      if (!paths[openApiPath]) {
        paths[openApiPath] = {};
      }

      paths[openApiPath][method] = operation;
    }

    return {
      openapi: "3.0.0",
      info: {
        title: "Sogio API",
        version: "1.0.0",
        description: "Property rental management API",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      paths,
    };
  }

  #toBracketPath(path: string): string {
    return path.replace(/:([^/]+)/g, "{$1}");
  }
}
