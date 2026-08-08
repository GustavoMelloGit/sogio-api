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
