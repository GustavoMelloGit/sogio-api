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

/**
 * The `scope` a request is granted when it omits the parameter entirely.
 * RFC 6749 §3.3 permits a server to fall back to a pre-defined default
 * rather than reject the request outright, and that is the interoperable
 * choice here: a generic MCP client (observed with Claude Code) may omit
 * `scope` and simply expect the server's default, and with exactly one
 * supported scope there is no ambiguity about what that default is.
 */
export function defaultScope(): string {
  return OAUTH_MCP_SCOPE;
}

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [OAUTH_MCP_SCOPE]:
    "Book and cancel stays, record expenses, view your properties and stays, and read, change, and remove your properties' configuration settings on your behalf. Cancelling a stay and removing a configuration setting's value are both irreversible.",
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
    SCOPE_DESCRIPTIONS[scope] ?? "Access your Sogio account on your behalf."
  );
}
