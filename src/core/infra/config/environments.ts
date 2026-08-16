import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number(),
    DATABASE_URL: z.string().trim(),
    NODE_ENV: z
      .enum(["development", "test", "sandbox", "production"])
      .default("development"),
    JWT_SECRET: z.string().trim(),
    TUYA_DEVICE_ID: z.string().trim(),
    TUYA_CLIENT_ID: z.string().trim(),
    TUYA_CLIENT_SECRET: z.string().trim(),
    /**
     * Public, canonical base URL of this API, with no trailing slash. This is
     * the source of truth for identity that must never drift from the
     * deployed origin — the OAuth `issuer` (RFC 8414) and the discovery
     * documents' `resource`/`authorization_servers` (RFC 9728) are derived
     * from it, never from `request.url`/`Host`, which a client-supplied
     * header or a misconfigured proxy can influence. Required outside
     * development (see the schema-level refinement below); in development it
     * falls back to `http://localhost:${PORT}` via `apiBaseUrl` below, since
     * there is no stable public origin to require yet.
     */
    API_BASE_URL: z
      .string()
      .trim()
      .refine(value => !value.endsWith("/"), {
        message: "API_BASE_URL must not have a trailing slash",
      })
      .optional(),
    /**
     * Public base URL of the sogio-front, with no trailing slash. It plays
     * two roles: the destination of the 302 redirect a successful
     * `/authorize` call issues (the front's consent page, identified only by
     * the opaque pending-request id — never any OAuth parameter, per the
     * plan's contract), and, from now on, the one allowed CORS origin for
     * the protocol and consent routes in production (E8) — replacing the
     * previous "any https:// origin" wildcard, which was effectively `*`
     * with credentials enabled. Required outside development, mirroring
     * `API_BASE_URL`, since there is no trustworthy default once this API is
     * deployed publicly.
     */
    FRONT_BASE_URL: z
      .string()
      .trim()
      .refine(value => !value.endsWith("/"), {
        message: "FRONT_BASE_URL must not have a trailing slash",
      })
      .optional(),
    /**
     * Whether the process sits behind a trusted reverse proxy. Absent (or any
     * value other than the literal string "true") means untrusted: caller
     * identity for rate limiting is resolved solely from the Bun peer IP, and
     * `X-Forwarded-For`/`X-Real-IP` are ignored. See E5 in the MCP OAuth
     * authorization plan.
     */
    TRUSTED_PROXY: z
      .string()
      .optional()
      .transform(value => value === "true"),
    /** Not `HOSTNAME`: Docker auto-exports that name as the container id. */
    SERVER_HOSTNAME: z
      .string()
      .trim()
      .optional()
      .transform(value => value || "0.0.0.0"),
    /**
     * Lifetime of an opaque MCP access token, in seconds ("ordem de uma
     * hora" — Decisão Resolvida #8). Defaulted rather than required: the
     * value only tunes how aggressively the resource server forces a
     * refresh, it never affects correctness, so there is nothing to force
     * an operator to set explicitly.
     */
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    /**
     * Lifetime of an opaque MCP refresh token, in seconds ("vida longa" —
     * Decisão Resolvida #8). Rotated on every use regardless of how close
     * to this expiry it is.
     */
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
    /**
     * How long a just-rotated refresh token keeps returning its successor
     * instead of being treated as reused (E4's "10-30s" grace window on
     * rotation). See `RefreshAccessTokenUseCase`.
     */
    REFRESH_ROTATION_GRACE_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(20),
    /**
     * Absolute lifetime of a Consent, in seconds (E9 — "vida absoluta ...
     * mesmo em uso contínuo. Vencido, o usuário reautoriza"). Measured from
     * `granted_at`, which a reconnection (task 10) never resets, so this is
     * genuinely the age of the original grant. Defaulted to 180 days — long
     * enough not to nag a daily user, bounded enough that a grant can't live
     * forever.
     */
    CONSENT_ABSOLUTE_LIFETIME_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 180),
    /**
     * Inactivity lifetime of a Consent, in seconds (E9 — "consentimento sem
     * uso por um período é encerrado sozinho ... limpa o aplicativo que o
     * usuário testou e largou"). Measured from `last_used_at`, touched by
     * every successful credential verification and by the reconnection
     * shortcut (task 10). Defaulted to 30 days, the same order of magnitude
     * as `REFRESH_TOKEN_TTL_SECONDS` — an app that goes quiet for that long
     * has usually already let its refresh token lapse too.
     */
    CONSENT_INACTIVITY_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30),
  })
  .refine(data => data.NODE_ENV === "development" || !!data.API_BASE_URL, {
    message: "API_BASE_URL is required outside development",
    path: ["API_BASE_URL"],
  })
  .refine(data => data.NODE_ENV === "development" || !!data.FRONT_BASE_URL, {
    message: "FRONT_BASE_URL is required outside development",
    path: ["FRONT_BASE_URL"],
  });

export const env = envSchema.parse(process.env);

/**
 * `API_BASE_URL` resolved to a usable value, falling back to a loopback URL
 * only in development — the one environment where the schema above still
 * allows it to be absent. Every consumer that needs the API's public origin
 * (OAuth issuer, discovery documents) should read this instead of
 * `env.API_BASE_URL` directly, to avoid re-deriving the same fallback.
 */
export const apiBaseUrl = env.API_BASE_URL ?? `http://localhost:${env.PORT}`;

/**
 * `FRONT_BASE_URL` resolved to a usable value, falling back to a
 * conventional local dev server address only in development — the one
 * environment where the schema above still allows it to be absent.
 */
export const frontBaseUrl = env.FRONT_BASE_URL ?? "http://localhost:5173";

/** Credential lifetimes and rotation grace window, in milliseconds. */
export const accessTokenTtlMs = env.ACCESS_TOKEN_TTL_SECONDS * 1000;
export const refreshTokenTtlMs = env.REFRESH_TOKEN_TTL_SECONDS * 1000;
export const refreshRotationGraceWindowMs =
  env.REFRESH_ROTATION_GRACE_WINDOW_SECONDS * 1000;

/** Consent expiry thresholds (E9), in milliseconds. */
export const consentAbsoluteLifetimeMs =
  env.CONSENT_ABSOLUTE_LIFETIME_SECONDS * 1000;
export const consentInactivityTtlMs = env.CONSENT_INACTIVITY_TTL_SECONDS * 1000;
