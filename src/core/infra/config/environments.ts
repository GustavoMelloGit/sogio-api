import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number(),
  DATABASE_URL: z.string().trim(),
  NODE_ENV: z
    .enum(["development", "test", "sandbox", "production"])
    .default("development"),
  JWT_SECRET: z.string().trim(),
  TUYA_DEVICE_ID: z.string().trim(),
  TUYA_CLIENT_ID: z.string().trim(),
  TUYA_CLIENT_SECRET: z.string().trim(),
  API_BASE_URL: z.string().trim().optional(),
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
});

export const env = envSchema.parse(process.env);
