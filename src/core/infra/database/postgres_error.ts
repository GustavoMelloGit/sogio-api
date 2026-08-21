const UNIQUE_VIOLATION = "23505";
const INVALID_DATA_CODES_STARTING_WITH = "22";
const NOT_NULL_VIOLATION = "23502";
const CHECK_VIOLATION = "23514";

export function pgErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ("code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export function isUniqueViolationError(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}

export function isInvalidDataError(error: unknown): boolean {
  const code = pgErrorCode(error);
  if (!code) return false;
  return (
    code.startsWith(INVALID_DATA_CODES_STARTING_WITH) ||
    code === NOT_NULL_VIOLATION ||
    code === CHECK_VIOLATION
  );
}
