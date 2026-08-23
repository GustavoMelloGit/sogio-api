export function definedValuesOf<Value extends object>(
  value: Value
): Partial<Value> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<Value>;
}
