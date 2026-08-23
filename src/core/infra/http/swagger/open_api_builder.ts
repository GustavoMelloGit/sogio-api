import type { Controller } from "../../../presentation/controller/controller";
import type { OpenApiResponse } from "../../../presentation/open_api/open_api_types";
import { MAX_BUFFERED_BODY_BYTES } from "../body/body_limits";

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

const PAYLOAD_TOO_LARGE_RESPONSE: OpenApiResponse = {
  description: `Request body exceeds the ${MAX_BUFFERED_BODY_BYTES / (1024 * 1024)} MB limit buffered by the server. Routes that accept larger payloads (e.g. bulk import) read the body as a stream and document their own byte limit instead.`,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          message: { type: "string" },
        },
      },
    },
  },
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

      if (controller.openApiSpec.requestBody) {
        operation.responses = this.#withPayloadTooLargeResponse(
          controller.openApiSpec.responses
        );
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

  #withPayloadTooLargeResponse(
    responses: Record<string, OpenApiResponse>
  ): Record<string, OpenApiResponse> {
    if (responses["413"]) return responses;
    return { ...responses, "413": PAYLOAD_TOO_LARGE_RESPONSE };
  }

  #toBracketPath(path: string): string {
    return path.replace(/:([^/]+)/g, "{$1}");
  }
}
