/**
 * The single scope this authorization server supports in v1 (Decisões
 * Resolvidas #3): a grant is all-or-nothing over the whole MCP surface.
 * Declared once here so `/authorize` (validating a request's `scope`), the
 * authorization server metadata document (`scopes_supported`), and the
 * future token/consent screens (tasks 10/11) can't drift into disagreeing
 * about what "mcp" access actually means. Lives in domain, not in a
 * presentation controller, so both application use cases and controllers
 * can depend on it without an application-layer file reaching into
 * presentation.
 */
export const OAUTH_MCP_SCOPE = "mcp";
export const OAUTH_SUPPORTED_SCOPES: readonly string[] = [OAUTH_MCP_SCOPE];

export function isSupportedScope(scope: string): boolean {
  return OAUTH_SUPPORTED_SCOPES.includes(scope);
}
