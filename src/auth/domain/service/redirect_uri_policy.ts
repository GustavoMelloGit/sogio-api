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

/**
 * E6's trust anchor for the consent and connected-apps screens (Achado 2 da
 * revisão pós-implementação): the destination the user is being asked to
 * trust, in a form that can never come back empty and never renders a
 * spoofable Unicode host. The single helper both screens share.
 *
 * Two failure modes `new URL(uri).hostname` has on its own, both confirmed
 * against real values:
 *
 * - **No authority at all.** RFC 8252 §7.1's own recommended native-app form
 *   (`com.example.app:/oauth2redirect`, no `//`) parses to an *empty*
 *   `hostname` — the trust anchor the consent screen renders would be a
 *   blank string, which is a free disguise, not an absence of one. When
 *   there is no authority, the exact registered/presented URI string *is*
 *   the destination — there is nothing else to show.
 * - **A custom scheme with an IDN host.** WHATWG only runs IDNA punycode
 *   conversion for the "special" schemes (`http`, `https`, `ws`, `wss`,
 *   `ftp`, `file`); a non-special scheme like `myapp://` merely
 *   percent-encodes non-ASCII bytes, so a homograph host never turns into
 *   the `xn--…` form a user could recognize as suspicious. Decoding the
 *   percent-encoding back to Unicode and re-parsing through a synthetic
 *   `https://` URL forces WHATWG's IDNA host parsing and yields the same
 *   punycode a special scheme would have produced natively.
 *
 * A host that's already ASCII (a loopback/remote `http(s)://` URI, or a
 * custom-scheme host with no non-ASCII characters) round-trips through this
 * unchanged — there is no need to special-case which schemes get the
 * reparse.
 */
export function redirectUriDisplayAnchor(uri: string): string {
  const parsed = new URL(uri);

  if (parsed.hostname === "") {
    return uri;
  }

  return toPunycodeHost(parsed.hostname);
}

function toPunycodeHost(hostname: string): string {
  try {
    return new URL(`https://${decodeURIComponent(hostname)}/`).hostname;
  } catch {
    return hostname;
  }
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
