import crypto from "crypto";

/**
 * A legitimate S256 verifier is a fixed 43-character base64url string (RFC
 * 7636 §4.1). This is a defensive bound on what gets hashed, not a
 * charset/format check — a wrong-format verifier already fails to match the
 * stored challenge on its own.
 */
const MAX_CODE_VERIFIER_LENGTH = 512;

/**
 * PKCE `S256` verification (RFC 7636 §4.6): the presented `code_verifier` is
 * valid only when `BASE64URL(SHA256(code_verifier))` matches the
 * `code_challenge` recorded on the authorization code at `/authorize` time.
 * `plain` and an absent challenge are rejected upstream, at `/authorize`
 * (E2 step 7) — every `code_challenge` this ever runs against is therefore
 * already known to be an S256 value, so there is no method branch here.
 *
 * Comparison is constant-time (`crypto.timingSafeEqual`) once both sides
 * are known to be the same length — cheap to do, and this is exactly the
 * kind of secret-dependent comparison E4/E10 ask for where it's affordable.
 */
export function verifyPkceS256(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  if (
    codeVerifier.length === 0 ||
    codeVerifier.length > MAX_CODE_VERIFIER_LENGTH
  ) {
    return false;
  }

  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  if (computed.length !== codeChallenge.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(codeChallenge)
  );
}
