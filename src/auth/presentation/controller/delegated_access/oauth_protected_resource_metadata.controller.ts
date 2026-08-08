import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
} from "../../../../core/presentation/controller/controller";
import { apiBaseUrl } from "../../../../core/infra/config/environments";

/**
 * Canonical location of the resource server's protected-resource metadata
 * (RFC 9728). This is the path `WWW-Authenticate: resource_metadata` on
 * `/mcp` points at (see `OAUTH_PROTECTED_RESOURCE_METADATA_PATH` in
 * `src/core/infra/mcp/routes.ts`, which this value intentionally mirrors),
 * so it has to keep serving metadata for `/mcp` even though the bare
 * well-known path carries no resource path of its own.
 */
export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource";

/** The only protected resource this API exposes today. */
export const MCP_RESOURCE_PATH = "/mcp";

/**
 * RFC 9728 §3.1 well-known URI construction: the resource identifier's path
 * component is appended after the well-known path suffix. For a resource at
 * `${apiBaseUrl}/mcp`, that yields
 * `${apiBaseUrl}/.well-known/oauth-protected-resource/mcp` — the location a
 * generic MCP client derives on its own from the `/mcp` URL, without ever
 * seeing the `WWW-Authenticate` header.
 */
export const OAUTH_PROTECTED_RESOURCE_METADATA_PATH_FOR_MCP = `${OAUTH_PROTECTED_RESOURCE_METADATA_PATH}${MCP_RESOURCE_PATH}`;

const CACHE_CONTROL = "public, max-age=21600";

/**
 * Serves the resource server metadata document (RFC 9728). Same instance is
 * mounted at two paths — the canonical well-known location advertised via
 * `WWW-Authenticate`, and the RFC 9728 §3.1-derived variant with the
 * resource's own path appended — both returning identical content, since
 * `/mcp` is the only protected resource this API has.
 *
 * Static and public: no use case, no domain lookup. The document is a pure
 * function of configuration (`apiBaseUrl`), so a controller assembling the
 * JSON directly is the whole of the "application logic" there is.
 */
export class OAuthProtectedResourceMetadataController implements Controller {
  method = HttpControllerMethod.GET;
  corsPolicy = "public" as const;

  constructor(readonly path: string) {}

  async handle(): Promise<ControllerHttpResponse> {
    return new ControllerHttpResponse({
      status: 200,
      body: {
        resource: `${apiBaseUrl}${MCP_RESOURCE_PATH}`,
        authorization_servers: [apiBaseUrl],
      },
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }
}
