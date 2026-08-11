/**
 * Resolves the caller identity used as a rate limit key. `peerIp` is the
 * real peer address the Bun server resolved for the connection
 * (`server.requestIP(request)`), never a client-supplied value. `X-Forwarded-For`
 * is only consulted when `trustedProxy` is explicitly true — otherwise a
 * caller could rotate the header on every request and defeat the limiter
 * entirely. See E5 in the MCP OAuth authorization plan.
 */
export function resolveCallerIp(
  request: Request,
  peerIp: string | null,
  trustedProxy: boolean
): string {
  if (trustedProxy) {
    const forwardedFor = request.headers.get("x-forwarded-for");
    const firstHop = forwardedFor?.split(",")[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }

  return peerIp ?? "unknown";
}
