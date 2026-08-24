import { z } from "zod";
import type { Server } from "bun";
import { ConflictError } from "../../../application/error/conflict_error";
import { ForbiddenError } from "../../../application/error/forbidden_error";
import { IllegalStateError } from "../../../application/error/illegal_state_error";
import { PayloadTooLargeError } from "../../../application/error/payload_too_large_error";
import { ResourceNotFoundError } from "../../../application/error/resource_not_found_error";
import { UnauthorizedError } from "../../../application/error/unauthorized_error";
import { ValidationError } from "../../../application/error/validation_error";
import type { User } from "../../../../auth/domain/entity/user";
import type { EntitlementService } from "../../../../billing/application/service/entitlement_service";
import type { CapabilityKey } from "../../../../billing/domain/capability/capability_key";
import { capabilityRegistryEntryOf } from "../../../../billing/domain/capability/capability_registry";
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
import { readBoundedBody } from "../body/bounded_body_reader";
import { exceedsMaxJsonDepth } from "../body/json_depth_guard";
import {
  MAX_BUFFERED_BODY_BYTES,
  MAX_JSON_DEPTH,
  MAX_REQUEST_BODY_BYTES,
} from "../body/body_limits";

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
    if (this.controller.bodyMode === "stream") {
      return {
        params: this.#parseParams(),
        body: {},
        query: this.#parseQuery(),
        headers: this.#parseHeaders(),
        method: this.request.method as HttpControllerMethod,
        url: this.request.url,
        peerIp,
        rawBody: null,
        bodyStream: this.request.body,
      };
    }

    this.#rawBody = await this.#readRawBody();

    return {
      params: this.#parseParams(),
      body: this.#parseBody(),
      query: this.#parseQuery(),
      headers: this.#parseHeaders(),
      method: this.request.method as HttpControllerMethod,
      url: this.request.url,
      peerIp,
      rawBody: this.#rawBody,
      bodyStream: null,
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
    return readBoundedBody(
      this.request.body,
      MAX_BUFFERED_BODY_BYTES,
      MAX_REQUEST_BODY_BYTES
    );
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

  /**
   * Correção pós-revisão (M5). Two changes from the version this replaces:
   *
   * 1. A controller that declares `parameterSource: "form"` never has its
   *    body parsed as JSON, regardless of the `Content-Type` header — the
   *    declared source is the single source of truth (E1), not a header the
   *    caller controls. Presenting `/token` a body with a wrong or missing
   *    `Content-Type` used to fall through to `JSON.parse` below.
   * 2. `JSON.parse` is wrapped in a `try/catch`. It used to throw straight
   *    into the adapter's top-level `catch`, which logged the raw
   *    `SyntaxError` — whose message embeds a fragment of the *body itself*
   *    (`Unexpected identifier "SUPERSECRETREFRESHTOKEN"`) — verbatim,
   *    stack included. Malformed JSON now just resolves to `{}`, which for
   *    an `inputSchema`-validated route fails cleanly as a normal
   *    `ValidationError` (422) instead of leaking into a log line as an
   *    unmapped 500.
   */
  #parseBody(): Record<string, unknown> {
    if (!this.#rawBody) {
      return {};
    }

    const contentType = this.request.headers.get("content-type") ?? "";
    const isDeclaredForm = this.controller.parameterSource === "form";

    if (
      isDeclaredForm ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      return Object.fromEntries(new URLSearchParams(this.#rawBody).entries());
    }

    if (exceedsMaxJsonDepth(this.#rawBody, MAX_JSON_DEPTH)) {
      throw new ValidationError(
        `Request body exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}`
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(this.#rawBody);
    } catch {
      return {};
    }

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
  [PayloadTooLargeError.name]: 413,
};

/**
 * Correção pós-revisão (M5 / E7). `isProtocolRoute` — true for any
 * controller that declares `parameterSource` (today, exclusively the OAuth
 * delegated-access endpoints; see `ControllerParameterSource`'s docstring)
 * — strips `message`/`stack` from an *unmapped* error before it's logged.
 * An unmapped error reaching this adapter for one of those routes is, by
 * construction, a bug nobody anticipated, so its message can contain
 * anything — including, as measured, a fragment of a raw request body
 * carrying `code`, `code_verifier`, or a refresh token. Mapped errors
 * (`ValidationError` and friends) still log their `message` for every
 * route: those are expected, typed failures whose text the project already
 * controls, not an arbitrary thrown value's `.message`.
 */
function buildErrorLogContext(
  error: unknown,
  isProtocolRoute: boolean
): Record<string, unknown> {
  if (!Error.isError(error)) {
    return isProtocolRoute
      ? { name: "UnknownThrownValue" }
      : { name: "UnknownThrownValue", message: String(error) };
  }

  const isExpectedError = Object.prototype.hasOwnProperty.call(
    errorCodeMap,
    error.name
  );

  if (isExpectedError) {
    return { name: error.name, message: error.message };
  }

  if (isProtocolRoute) {
    return { name: error.name };
  }

  return { name: error.name, message: error.message, stack: error.stack };
}

function buildRateLimitKey(controller: Controller, callerIp: string): string {
  return `${controller.method}:${controller.path}:${callerIp}`;
}

async function drainRateLimitedRequestBody(request: Request): Promise<void> {
  try {
    await readBoundedBody(request.body, 0, MAX_REQUEST_BODY_BYTES);
  } catch (error) {
    if (!(error instanceof PayloadTooLargeError)) {
      throw error;
    }
  }
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

/**
 * Correção pós-revisão (M5 / B6 / E8). Applied to every error response the
 * catch block below builds for a protocol route (`isProtocolRoute`, see
 * `buildErrorLogContext`) — mapped or unmapped, `4xx` or `500`. Before this,
 * only a controller's own handler-level error path (`oauthProtocolError`,
 * `ControllerHttpResponse`) carried `no-store`; anything thrown *up to* the
 * adapter — including `AuthMiddleware` rejecting `/connect/authorize/decision`
 * with `UnauthorizedError` — fell through to a plain `Response.json` with no
 * cache header at all (B6).
 */
function withNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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
  entitlementService: EntitlementService,
  adminOnly: boolean = false,
  allowWithoutPlatformAccess: boolean = false,
  requiredCapability?: CapabilityKey
) {
  if (requiredCapability && !authenticated && !adminOnly) {
    throw new Error(
      `Route ${controller.method} ${controller.path} declares requiredCapability but is neither authenticated nor adminOnly, so the check would never run`
    );
  }

  if (requiredCapability && adminOnly) {
    throw new Error(
      `Route ${controller.method} ${controller.path} declares requiredCapability together with adminOnly, which bypasses the check entirely`
    );
  }

  if (controller.bodyMode === "stream" && controller.inputSchema) {
    throw new Error(
      `Route ${controller.method} ${controller.path} declares bodyMode: "stream" together with inputSchema, but there is no body object for the schema to validate`
    );
  }

  return async function (
    request: Request,
    server?: Server<unknown>
  ): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return corsMiddleware.handlePreflightRequest(
        request,
        controller.corsPolicy
      );
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
          await drainRateLimitedRequestBody(request);
          return corsMiddleware.addCorsHeaders(
            buildRateLimitedResponse(decision.retryAfterSeconds),
            request.headers.get("Origin"),
            controller.corsPolicy
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

      /**
       * Platform-access gate (DA-9). Fail-closed: every `authenticated: true`
       * route is gated unless the route itself opts out via
       * `allowWithoutPlatformAccess`. Admins always pass — staff can't be
       * locked out of the backoffice by a billing problem. Authentication
       * (who you are) and entitlement (can you use this) are kept as two
       * separate steps, not folded into `AuthMiddleware`, so `handleOptional()`
       * callers (the OAuth flow) never pay for a billing lookup they don't need.
       */
      if (requiresAuth && user && user.role !== "admin") {
        const needsPlatformAccessCheck = !allowWithoutPlatformAccess;
        const needsCapabilityCheck = Boolean(requiredCapability);

        if (needsPlatformAccessCheck || needsCapabilityCheck) {
          const entitlement = await entitlementService.entitlementOf(user.id);

          if (needsPlatformAccessCheck && !entitlement.has_platform_access) {
            throw new ForbiddenError(
              entitlement.blocked_reason ?? "no_platform_access"
            );
          }

          if (
            needsCapabilityCheck &&
            requiredCapability &&
            !entitlement.capabilities.allows(requiredCapability)
          ) {
            const { label } = capabilityRegistryEntryOf(requiredCapability);
            throw new ForbiddenError(
              `Your current plan doesn't include ${label}. Upgrade your plan to unlock it.`
            );
          }
        }
      }

      const response = await controller.handle(controllerRequest, user);

      if (response instanceof ControllerHttpResponse) {
        return corsMiddleware.addCorsHeaders(
          buildExplicitResponse(response),
          request.headers.get("Origin"),
          controller.corsPolicy
        );
      }

      const serializedResponse = serializeDatesRecursively(response);

      const jsonResponse = Response.json(serializedResponse, {
        status: typeof response !== "undefined" ? 200 : 204,
      });
      return corsMiddleware.addCorsHeaders(
        jsonResponse,
        request.headers.get("Origin"),
        controller.corsPolicy
      );
    } catch (e) {
      const isProtocolRoute = Boolean(controller.parameterSource);
      logger.error(
        "Error in HTTP controller adapter",
        buildErrorLogContext(e, isProtocolRoute)
      );
      let errorResponse: Response;

      if (Error.isError(e)) {
        const errorCode = errorCodeMap[e.name];
        if (errorCode && e.name === IllegalStateError.name) {
          errorResponse = Response.json(
            { message: "Internal server error" },
            { status: errorCode }
          );
        } else if (errorCode) {
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

      if (isProtocolRoute) {
        errorResponse = withNoStore(errorResponse);
      }

      return corsMiddleware.addCorsHeaders(
        errorResponse,
        request.headers.get("Origin"),
        controller.corsPolicy
      );
    }
  };
}
