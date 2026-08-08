/**
 * E1: inspects every occurrence of every key in a URL's raw query string
 * and fails (returns `null`) the moment one repeats, before any semantic
 * validation. Shared by every delegated-access controller that reads
 * exclusively from the query string, deliberately independent of the
 * adapter's own `ControllerRequest.query` / `resolveValidationInput`,
 * which only runs this check when a controller declares `inputSchema` —
 * these controllers don't, since a `ValidationError` from that pipeline
 * would answer with the API's default `{ message }` shape, not the OAuth
 * error shape these routes require.
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
