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

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [OAUTH_MCP_SCOPE]:
    "Book stays, record expenses, and view your properties and stays on your behalf.",
};

/**
 * Human-readable description of a scope, for the consent screen (task 10,
 * "descrição legível do acesso pedido"). Falls back to a generic sentence
 * for a scope this map doesn't recognize — shouldn't happen for a scope
 * that already passed `isSupportedScope`, but a display-only lookup has no
 * reason to throw over it.
 */
export function describeScope(scope: string): string {
  return (
    SCOPE_DESCRIPTIONS[scope] ?? "Access your StayHub account on your behalf."
  );
}
