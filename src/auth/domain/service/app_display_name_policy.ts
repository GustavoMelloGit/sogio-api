/**
 * Boundaries of the disallowed code point ranges, built from their numeric
 * code points via `String.fromCodePoint` rather than a regex literal or a
 * `\u` escape, so this source file never contains the raw characters it
 * exists to reject:
 *
 * - 0x0000-0x001F and 0x007F-0x009F: C0/C1 control characters, including
 *   the null byte.
 * - 0x202A-0x202E: bidirectional text embedding/override controls.
 * - 0x2066-0x2069: bidirectional text isolate controls.
 *
 * Either family lets a malicious app flip how its self-declared name
 * renders on the consent screen (E6).
 */
const c0Start = String.fromCodePoint(0x0000);
const c0End = String.fromCodePoint(0x001f);
const c1Start = String.fromCodePoint(0x007f);
const c1End = String.fromCodePoint(0x009f);
const bidiOverrideStart = String.fromCodePoint(0x202a);
const bidiOverrideEnd = String.fromCodePoint(0x202e);
const bidiIsolateStart = String.fromCodePoint(0x2066);
const bidiIsolateEnd = String.fromCodePoint(0x2069);

const FORBIDDEN_DISPLAY_NAME_CHARACTERS = new RegExp(
  `[${c0Start}-${c0End}${c1Start}-${c1End}${bidiOverrideStart}-${bidiOverrideEnd}${bidiIsolateStart}-${bidiIsolateEnd}]`
);

/**
 * Antiphishing check (E6) for a self-declared display name (client_name).
 * Shared by the AppRegistration entity invariant and the /register
 * controller's own pre-check, so the rule lives in exactly one place.
 */
export function hasUnsafeDisplayNameCharacters(name: string): boolean {
  return FORBIDDEN_DISPLAY_NAME_CHARACTERS.test(name);
}
