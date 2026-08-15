import { z } from "zod";

/**
 * Shared "typed configuration value" building blocks, consumed by every
 * bounded context that models a generic key/value setting (`AppSetting` in
 * `backoffice`, `PropertySetting` in `property_management`). Each BC keeps
 * its own entity, repository, use cases and controllers — only the value
 * validation (type enum, key format, bounded JSON, type/value coherence) is
 * shared here to avoid duplicating it across bounded contexts.
 */

// ---------------------------------------------------------------------------
// boundedJsonValue — reusable refinement for a setting's `value` field.
// Rejects: JSON > 16 KB, depth > 5, objects with > 50 root keys.
// ---------------------------------------------------------------------------

function measureDepth(val: unknown, current = 0): number {
  if (current > 5) return current;
  if (Array.isArray(val))
    return Math.max(...val.map(item => measureDepth(item, current + 1)));
  if (val !== null && typeof val === "object") {
    const values = Object.values(val as object);
    if (values.length === 0) return current;
    return Math.max(...values.map(v => measureDepth(v, current + 1)));
  }
  return current;
}

// Null byte + C0/DEL control characters — rejected anywhere in a value
// (string leaves and, for JSON objects, keys too), since a setting is
// consumed downstream as display text/JSON and must never carry bytes that
// break rendering, logging, or storage encoding.
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1F\x7F]/;

function hasControlCharacters(val: unknown): boolean {
  if (typeof val === "string") {
    return CONTROL_CHARACTER_PATTERN.test(val);
  }
  if (Array.isArray(val)) {
    return val.some(hasControlCharacters);
  }
  if (val !== null && typeof val === "object") {
    return Object.entries(val as object).some(
      ([key, value]) =>
        CONTROL_CHARACTER_PATTERN.test(key) || hasControlCharacters(value)
    );
  }
  return false;
}

export const boundedJsonValue = z.unknown().superRefine((val, ctx) => {
  if (val === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Value is required",
    });
    return;
  }
  if (hasControlCharacters(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Value must not contain null bytes or control characters",
    });
    return;
  }
  const json = JSON.stringify(val);
  if (json.length > 16384) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Value exceeds maximum allowed size of 16 KB",
    });
    return;
  }
  if (measureDepth(val) > 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Value exceeds maximum nesting depth of 5",
    });
    return;
  }
  if (
    val !== null &&
    typeof val === "object" &&
    !Array.isArray(val) &&
    Object.keys(val as object).length > 50
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Object value must not have more than 50 root keys",
    });
  }
});

export const settingTypeSchema = z.enum([
  "string",
  "number",
  "boolean",
  "json",
]);

export type SettingType = z.infer<typeof settingTypeSchema>;

/**
 * Heuristic denylist: neither `AppSetting` nor `PropertySetting` is a
 * secrets manager (see each entity's docstring), but nothing technical
 * stopped a caller from naming a key `api_key` or `smart_lock_pin` and
 * stashing a real credential in `value` before this. Matching key names are
 * rejected outright — a caller storing an actual secret under an innocuous
 * key is a separate, unenforceable problem, but this at least closes the
 * obvious path.
 */
const SUSPICIOUS_SETTING_KEY_PATTERN =
  /(secret|token|password|api_key|pin|code|credential)/i;

export const settingKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(
    /^[a-z0-9_.-]+$/,
    "Key must contain only lowercase letters, digits, underscores, dots and hyphens"
  )
  .refine(key => !SUSPICIOUS_SETTING_KEY_PATTERN.test(key), {
    message:
      "Key looks like it stores a secret or credential (matches secret/token/password/api_key/pin/code/credential); this is a generic configuration store, not a secrets manager — use a dedicated secrets manager instead",
  });

/**
 * Shared `description` field for both `AppSetting` and `PropertySetting`:
 * bounded length plus the same null byte/control character rejection as
 * `boundedJsonValue`, since `description` is free text rendered/logged the
 * same way a string `value` is.
 */
export const settingDescriptionSchema = z
  .string()
  .max(500)
  .refine(description => !CONTROL_CHARACTER_PATTERN.test(description), {
    message: "Description must not contain null bytes or control characters",
  })
  .nullable()
  .optional()
  .default(null);

/**
 * Validates that `value` matches the shape implied by `type`, adding a Zod
 * issue on the `value` path when it doesn't. Meant to be called from within
 * a `.superRefine()` on the entity's own schema, so each entity keeps its
 * own error message wiring while sharing the coherence rules.
 */
export function refineSettingValueForType(
  data: { type: SettingType; value: unknown },
  ctx: z.RefinementCtx
): void {
  const { type, value } = data;
  if (type === "string" && typeof value !== "string") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid value for type string",
      path: ["value"],
    });
  } else if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid value for type number",
        path: ["value"],
      });
    }
  } else if (type === "boolean" && typeof value !== "boolean") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid value for type boolean",
      path: ["value"],
    });
  } else if (type === "json") {
    if (value === null || typeof value !== "object") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid value for type json",
        path: ["value"],
      });
    }
  }
}
