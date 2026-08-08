import type { User } from "../../../auth/domain/entity/user";
import type { ZodTypeAny } from "zod";
import type { OpenApiOperation } from "../open_api/open_api_types";
import type { RateLimitPolicy } from "../../application/rate_limit/rate_limit_policy";

export enum HttpControllerMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  OPTIONS = "OPTIONS",
  PATCH = "PATCH",
}

/**
 * Declares the single source a controller reads its input parameters from.
 * When set, the adapter stops merging `query`/`body`/`params` and validates
 * `inputSchema` against that source alone, failing the request on any
 * duplicate key within it. When unset, the adapter falls back to the legacy
 * merge behavior. See E1 in the MCP OAuth authorization plan.
 */
export type ControllerParameterSource = "query" | "form" | "json";

export type ControllerRequest = {
  params: Record<string, string>;
  body: Record<string, unknown>;
  query: Record<string, string>;
  headers: Record<string, string>;
  method: HttpControllerMethod;
  url: string;
  /**
   * Real peer IP resolved by the Bun server (`server.requestIP(request)`),
   * not a client-supplied header. `null` when the server instance isn't
   * available (e.g. unit tests calling the adapter directly). See E5.
   */
  peerIp: string | null;
  /**
   * The request body exactly as received, before any parsing. `body` above
   * has already been collapsed into an object — for `x-www-form-urlencoded`
   * content, via `Object.fromEntries`, which silently keeps only the last
   * occurrence of a repeated key. A controller that must detect a duplicate
   * key itself (E1 — `/token`'s form body, the same discipline
   * `parseUniqueQueryParams` already applies to `request.url` for the query
   * string) needs the raw text to re-parse independently. `null` when the
   * request had no body.
   */
  rawBody: string | null;
};

export type AuthenticatedControllerRequest = ControllerRequest & {
  user: User;
};

export type ControllerCachePolicy = "no-store";

export type ControllerHttpResponseInit = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  cache?: ControllerCachePolicy;
};

/**
 * Opt-in escape hatch from the default DTO -> JSON 200/204 pipeline. A
 * controller returns an instance of this when it needs to control the
 * status, headers, or body directly (redirects, form-encoded bodies,
 * protocol-specific error shapes). Controllers that return anything else
 * keep going through the default serialization path unchanged.
 */
export class ControllerHttpResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly cache?: ControllerCachePolicy;

  constructor(init: ControllerHttpResponseInit) {
    this.status = init.status;
    this.body = init.body;
    this.headers = init.headers;
    this.cache = init.cache;
  }
}

export interface Controller {
  path: string;
  method: HttpControllerMethod;
  handle(
    request: ControllerRequest,
    user?: User
  ): Promise<unknown | ControllerHttpResponse>;
  openApiSpec?: OpenApiOperation;
  inputSchema?: ZodTypeAny;
  parameterSource?: ControllerParameterSource;
  /**
   * Opt-in rate limit policy the adapter enforces before doing anything else
   * (before parsing, validation, or auth) — see E5 in the MCP OAuth
   * authorization plan. Unset means no limit. The primitive enforcing it
   * knows nothing about this controller or why the numbers were chosen.
   */
  rateLimitPolicy?: RateLimitPolicy;
  /**
   * Opt-in CORS policy. `"public"` responds to any origin with
   * `Access-Control-Allow-Origin: *` and no `Access-Control-Allow-Credentials`
   * header — the exception E8 in the MCP OAuth authorization plan carves out
   * for the two discovery documents, which must be fetchable cross-origin by
   * any MCP client without credentials. Unset keeps the default behavior:
   * origin echoed back only when it matches the configured allowlist, with
   * credentials allowed.
   */
  corsPolicy?: "public";
}
