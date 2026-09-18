const MAX_RETURN_DESTINATION_LENGTH = 512;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/;

export function isAcceptableReturnDestination(value: string): boolean {
  if (value.length === 0 || value.length > MAX_RETURN_DESTINATION_LENGTH) {
    return false;
  }

  if (!value.startsWith("/")) {
    return false;
  }

  const secondCharacter = value[1];
  if (secondCharacter === "/" || secondCharacter === "\\") {
    return false;
  }

  if (value.includes("\\")) {
    return false;
  }

  return !CONTROL_CHARACTER_PATTERN.test(value);
}
