import { z } from "zod";
import type { AttestedIdentity } from "../../application/service/external_identity_provider";

const MAX_ID_TOKEN_LENGTH = 8192;
const MAX_SUBJECT_LENGTH = 255;
const MAX_EMAIL_LENGTH = 255;
const MAX_AUDIENCE_LENGTH = 255;
const MAX_AUDIENCE_LIST_LENGTH = 10;
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

const googleIdTokenPayloadSchema = z.object({
  iss: z.enum(["https://accounts.google.com", "accounts.google.com"]),
  aud: z.union([
    z.string().max(MAX_AUDIENCE_LENGTH),
    z.array(z.string().max(MAX_AUDIENCE_LENGTH)).max(MAX_AUDIENCE_LIST_LENGTH),
  ]),
  azp: z.string().max(MAX_AUDIENCE_LENGTH).optional(),
  exp: z.number(),
  iat: z.number(),
  sub: z.string().min(1).max(MAX_SUBJECT_LENGTH),
  email: z.email().max(MAX_EMAIL_LENGTH),
  email_verified: z.unknown().optional(),
  hd: z.unknown().optional(),
  name: z.unknown().optional(),
  nonce: z.unknown().optional(),
});

export function parseGoogleIdTokenClaims(
  idToken: string,
  clientId: string
): AttestedIdentity | null {
  if (idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
    return null;
  }

  const segments = idToken.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [, payloadSegment] = segments;
  if (!payloadSegment) {
    return null;
  }

  const payload = decodePayload(payloadSegment);
  if (!payload) {
    return null;
  }

  const parsed = googleIdTokenPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const claims = parsed.data;

  if (!audienceMatches(claims.aud, claims.azp, clientId)) {
    return null;
  }

  const nowSeconds = Date.now() / 1000;

  if (claims.exp <= nowSeconds) {
    return null;
  }

  if (claims.iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS) {
    return null;
  }

  return {
    subject: claims.sub,
    email: claims.email,
    email_verified:
      claims.email_verified === true &&
      googleIsAuthoritativeOver(claims.email, claims.hd),
    name: typeof claims.name === "string" ? claims.name : null,
    nonce: typeof claims.nonce === "string" ? claims.nonce : null,
  };
}

function googleIsAuthoritativeOver(email: string, hd: unknown): boolean {
  if (email.toLowerCase().endsWith("@gmail.com")) {
    return true;
  }

  return typeof hd === "string" && hd.length > 0;
}

function audienceMatches(
  aud: string | string[],
  azp: string | undefined,
  clientId: string
): boolean {
  if (typeof aud === "string") {
    return aud === clientId;
  }

  return aud.includes(clientId) && azp === clientId;
}

function decodePayload(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(segment, "base64url").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
