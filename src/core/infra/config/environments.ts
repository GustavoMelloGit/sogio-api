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
  })
  .refine(data => data.NODE_ENV === "development" || !!data.API_BASE_URL, {
    message: "API_BASE_URL is required outside development",
    path: ["API_BASE_URL"],
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
