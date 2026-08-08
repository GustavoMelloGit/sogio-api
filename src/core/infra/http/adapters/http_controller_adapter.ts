import { z } from "zod";
import type { Server } from "bun";
import { ConflictError } from "../../../application/error/conflict_error";
import { ForbiddenError } from "../../../application/error/forbidden_error";
import { IllegalStateError } from "../../../application/error/illegal_state_error";
import { ResourceNotFoundError } from "../../../application/error/resource_not_found_error";
import { UnauthorizedError } from "../../../application/error/unauthorized_error";
import { ValidationError } from "../../../application/error/validation_error";
import type { User } from "../../../../auth/domain/entity/user";
import {
  ControllerHttpResponse,
  type Controller,
  type ControllerRequest,
  type HttpControllerMethod,
} from "../../../presentation/controller/controller";
import { CorsMiddleware } from "../../../presentation/middleware/cors.middleware";
import { MiddlewareDi } from "../../../../auth/infra/di/middleware";
import { serializeDatesRecursively } from "../utils/date_serializer";
import { CoreDi } from "../../di/core_di";
import { resolveCallerIp } from "../../rate_limit/caller_ip_resolver";
import { env } from "../../config/environments";

const middlewareDi = new MiddlewareDi();
const corsMiddleware = new CorsMiddleware();
const coreDi = new CoreDi();
const logger = coreDi.makeLogger();
const rateLimiter = coreDi.makeRateLimiter();

class ControllerRequestParser {
  #rawBody: string | null = null;

  constructor(
    private readonly request: Request,
    private readonly controller: Controller
  ) {}

  async parse(peerIp: string | null): Promise<ControllerRequest> {
    this.#rawBody = await this.#readRawBody();

    return {
      params: this.#parseParams(),
      body: this.#parseBody(),
      query: this.#parseQuery(),
      headers: this.#parseHeaders(),
      method: this.request.method as HttpControllerMethod,
      url: this.request.url,
      peerIp,
    };
  }

  /**
   * Resolves the object `inputSchema` validates against. Without a declared
   * `parameterSource`, this reproduces the legacy merge of
   * `query`/`body`/`params` untouched. With one, it reads from that source
   * alone and fails on any duplicate key within it (E1) instead of silently
   * collapsing to the last occurrence.
   */
  resolveValidationInput(request: ControllerRequest): Record<string, unknown> {
    const source = this.controller.parameterSource;

    if (!source) {
      return { ...request.query, ...request.body, ...request.params };
    }

    switch (source) {
      case "query":
        return this.#collectUnique(
          new URL(this.request.url).searchParams.entries()
        );
      case "form":
        return this.#collectUnique(
          new URLSearchParams(this.#rawBody ?? "").entries()
        );
      case "json":
        return request.body;
    }
  }

  async #readRawBody(): Promise<string | null> {
    if (this.request.body === null) {
      return null;
    }

    return this.request.text();
  }

  #parseParams(): Record<string, string> {
    const path = this.controller.path;
    const pathParts = path.split("/");
    const params = pathParts.map(part =>
      part.startsWith(":") ? part.slice(1) : null
    );

    const paramsObject = params.reduce(
      (acc, param, index) => {
        if (!param) {
          return acc;
        }
        const url = new URL(this.request.url);
        const pathname = url.pathname.split("/");
        if (!pathname[index]) {
          return acc;
        }
        acc[param] = pathname[index];
        return acc;
      },
      {} as Record<string, string>
    );

    return paramsObject;
  }

  #parseBody(): Record<string, unknown> {
    if (!this.#rawBody) {
      return {};
    }

    const contentType = this.request.headers.get("content-type") ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(this.#rawBody).entries());
    }

    const body = JSON.parse(this.#rawBody);

    if (!body) {
      return {};
    }

    if (typeof body !== "object") {
      return {};
    }

    return body as Record<string, unknown>;
  }

  #parseQuery(): Record<string, string> {
    const url = new URL(this.request.url);

    const query = Object.fromEntries(url.searchParams.entries());

    return query;
  }

  #parseHeaders(): Record<string, string> {
    return Object.fromEntries(this.request.headers.entries());
  }

  #collectUnique(
    entries: IterableIterator<[string, string]>
  ): Record<string, string> {
    const seen = new Set<string>();
    const result: Record<string, string> = {};

    for (const [key, value] of entries) {
      if (seen.has(key)) {
        throw new ValidationError(`Duplicate parameter: ${key}`);
      }
      seen.add(key);
      result[key] = value;
    }

    return result;
  }
}

const errorCodeMap: Record<string, number> = {
  [ConflictError.name]: 409,
  [ForbiddenError.name]: 403,
  [ValidationError.name]: 422,
  [ResourceNotFoundError.name]: 404,
  [UnauthorizedError.name]: 401,
  [IllegalStateError.name]: 500,
};

function buildErrorLogContext(error: unknown): Record<string, unknown> {
  if (!Error.isError(error)) {
    return { name: "UnknownThrownValue", message: String(error) };
  }

  const isExpectedError = Object.prototype.hasOwnProperty.call(
    errorCodeMap,
    error.name
  );

  if (isExpectedError) {
    return { name: error.name, message: error.message };
  }

  return { name: error.name, message: error.message, stack: error.stack };
}

function buildRateLimitKey(controller: Controller, callerIp: string): string {
  return `${controller.method}:${controller.path}:${callerIp}`;
}

function buildRateLimitedResponse(retryAfterSeconds: number): Response {
  return buildExplicitResponse(
    new ControllerHttpResponse({
      status: 429,
      body: { error: "rate_limited" },
      headers: { "Retry-After": String(retryAfterSeconds) },
      cache: "no-store",
    })
  );
}

function buildExplicitResponse(response: ControllerHttpResponse): Response {
  const headers = new Headers(response.headers);

  if (response.cache === "no-store") {
    headers.set("Cache-Control", "no-store");
    headers.set("Pragma", "no-cache");
  }

  if (response.body === undefined) {
    return new Response(null, { status: response.status, headers });
  }

  if (typeof response.body === "string") {
    return new Response(response.body, { status: response.status, headers });
  }

  return Response.json(response.body, { status: response.status, headers });
}

export function BunHttpControllerAdapter(
  controller: Controller,
  authenticated: boolean,
  adminOnly: boolean = false
) {
  return async function (
    request: Request,
    server?: Server<unknown>
  ): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return corsMiddleware.handlePreflightRequest(request);
    }

    try {
      const peerIp = server?.requestIP(request)?.address ?? null;

      if (controller.rateLimitPolicy) {
        const callerIp = resolveCallerIp(request, peerIp, env.TRUSTED_PROXY);
        const decision = rateLimiter.consume(
          buildRateLimitKey(controller, callerIp),
          controller.rateLimitPolicy
        );
        if (!decision.allowed) {
          return corsMiddleware.addCorsHeaders(
            buildRateLimitedResponse(decision.retryAfterSeconds),
            request.headers.get("Origin")
          );
        }
      }

      const controllerRequestParser = new ControllerRequestParser(
        request,
        controller
      );
      const controllerRequest = await controllerRequestParser.parse(peerIp);

      if (controller.inputSchema) {
        const validationInput =
          controllerRequestParser.resolveValidationInput(controllerRequest);
        const result = controller.inputSchema.safeParse(validationInput);
        if (!result.success) {
          throw new ValidationError(z.prettifyError(result.error));
        }
        controllerRequest.body = result.data as Record<string, unknown>;
      }

      const requiresAuth = authenticated || adminOnly;
      let user: User | undefined;
      if (requiresAuth) {
        const authMiddleware = middlewareDi.makeAuthMiddleware();
        user = await authMiddleware.handle(controllerRequest);
      }

      if (adminOnly && user?.role !== "admin") {
        throw new ForbiddenError();
      }

      const response = await controller.handle(controllerRequest, user);

      if (response instanceof ControllerHttpResponse) {
        return corsMiddleware.addCorsHeaders(
          buildExplicitResponse(response),
          request.headers.get("Origin")
        );
      }

      const serializedResponse = serializeDatesRecursively(response);

      const jsonResponse = Response.json(serializedResponse, {
        status: typeof response !== "undefined" ? 200 : 204,
      });
      return corsMiddleware.addCorsHeaders(
        jsonResponse,
        request.headers.get("Origin")
      );
    } catch (e) {
      logger.error("Error in HTTP controller adapter", buildErrorLogContext(e));
      let errorResponse: Response;

      if (Error.isError(e)) {
        const errorCode = errorCodeMap[e.name];
        if (errorCode) {
          errorResponse = Response.json(
            { message: e.message },
            { status: errorCode }
          );
        } else {
          errorResponse = Response.json(
            {
              message: "Internal server error",
            },
            {
              status: 500,
            }
          );
        }
      } else {
        errorResponse = Response.json(
          {
            message: "Internal server error",
          },
          {
            status: 500,
          }
        );
      }

      return corsMiddleware.addCorsHeaders(
        errorResponse,
        request.headers.get("Origin")
      );
    }
  };
}
