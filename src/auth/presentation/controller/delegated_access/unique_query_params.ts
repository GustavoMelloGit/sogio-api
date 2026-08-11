/**
 * E1: inspects every occurrence of every key in a `URLSearchParams`-shaped
 * input and fails (returns `null`) the moment one repeats, before any
 * semantic validation. Shared between `parseUniqueQueryParams` (query
 * string) and `parseUniqueFormParams` (form-urlencoded body) — the two
 * single-source shapes E1's table requires — so the duplicate check itself
 * lives in exactly one place.
 */
function collectUniqueParams(
  searchParams: URLSearchParams
): Record<string, string> | null {
  const seen = new Set<string>();
  const params: Record<string, string> = {};

  for (const [key, value] of searchParams.entries()) {
    if (seen.has(key)) {
      return null;
    }
    seen.add(key);
    params[key] = value;
  }

  return params;
}

/**
 * Shared by every delegated-access controller that reads exclusively from
 * the query string, deliberately independent of the adapter's own
 * `ControllerRequest.query` / `resolveValidationInput`, which only runs
 * this check when a controller declares `inputSchema` — these controllers
 * don't, since a `ValidationError` from that pipeline would answer with the
 * API's default `{ message }` shape, not the OAuth error shape these routes
 * require.
 */
export function parseUniqueQueryParams(
  url: string
): Record<string, string> | null {
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(url).searchParams;
  } catch {
    return null;
  }

  return collectUniqueParams(searchParams);
}

/**
 * `/token`'s single source (E1): the raw `x-www-form-urlencoded` body text,
 * exactly as received — never `ControllerRequest.body`, which the adapter
 * has already collapsed to one value per key via `Object.fromEntries`,
 * silently discarding the duplicate this check exists to reject. `null`
 * body (no request body sent) parses to an empty parameter set, not a
 * failure — every field will simply come back missing to the caller.
 */
export function parseUniqueFormParams(
  rawBody: string | null
): Record<string, string> | null {
  return collectUniqueParams(new URLSearchParams(rawBody ?? ""));
}
