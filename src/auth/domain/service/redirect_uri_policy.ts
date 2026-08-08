const DANGEROUS_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
]);

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);

/**
 * Whether a `redirect_uri` submitted to `/register` may be stored (E3's
 * rejection list). Purely structural inspection — it never transforms or
 * normalizes the value; the caller is responsible for persisting the exact
 * string that was submitted.
 *
 * Rejects: relative references (no scheme), a fragment, a dangerous scheme
 * (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`), embedded
 * userinfo credentials, a wildcard anywhere in the string, and `http://`
 * with a non-loopback host. Custom schemes (e.g. `cursor://`) are accepted,
 * as is `https://` to any host — only `http://` is loopback-restricted.
 */
export function isRegistrableRedirectUri(uri: string): boolean {
  if (uri.includes("#") || uri.includes("*")) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (DANGEROUS_SCHEMES.has(parsed.protocol)) {
    return false;
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return false;
  }

  if (parsed.protocol === "http:" && !LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    return false;
  }

  return true;
}

/**
 * E3's comparison, used at `/authorize` (against the registered list) and
 * to be revalidated again at `/token`. Exact `===` between the registered
 * string and the value already decoded once by the HTTP layer — no
 * normalization on either side, no re-decoding, no comparison by parts.
 *
 * The single loosening the spec allows: a loopback redirect_uri (127.0.0.1,
 * [::1], localhost) matches ignoring the port, because a native client
 * picks an ephemeral port at runtime (RFC 8252 §7.3). Everything else about
 * a loopback URI — scheme, host, path, query — still has to match exactly.
 * Remote hosts and custom schemes get no such exception, port included.
 */
export function redirectUriMatches(
  registeredUri: string,
  presentedUri: string
): boolean {
  if (registeredUri === presentedUri) {
    return true;
  }

  return matchesIgnoringLoopbackPort(registeredUri, presentedUri);
}

function matchesIgnoringLoopbackPort(
  registeredUri: string,
  presentedUri: string
): boolean {
  let registered: URL;
  let presented: URL;
  try {
    registered = new URL(registeredUri);
    presented = new URL(presentedUri);
  } catch {
    return false;
  }

  if (registered.protocol !== "http:" || presented.protocol !== "http:") {
    return false;
  }

  if (
    !LOOPBACK_HOSTNAMES.has(registered.hostname) ||
    registered.hostname !== presented.hostname
  ) {
    return false;
  }

  return (
    registered.pathname === presented.pathname &&
    registered.search === presented.search
  );
}
