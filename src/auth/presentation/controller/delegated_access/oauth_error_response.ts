import { ControllerHttpResponse } from "../../../../core/presentation/controller/controller";

/**
 * Error shape RFC 6749 §5.2 / RFC 7591 §3.2.2 mandate for OAuth protocol
 * endpoints: `error` plus a fixed `error_description`, never the API's
 * default `{ message }` shape and never the specific validation detail
 * that produced the failure (E7 — the description passed in here must
 * already be a fixed, generic string, not derived from the input).
 * `no-store` (E8) applies to every response these routes produce.
 */
export function oauthProtocolError(
  status: number,
  error: string,
  errorDescription: string
): ControllerHttpResponse {
  return new ControllerHttpResponse({
    status,
    cache: "no-store",
    body: { error, error_description: errorDescription },
  });
}
