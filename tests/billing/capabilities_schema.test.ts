import { describe, expect, it } from "bun:test";
import { capabilitiesSchema } from "../../src/billing/presentation/controller/capabilities_schema";
import {
  CAPABILITY_REGISTRY,
  MAX_LIMIT_CAPABILITY_VALUE,
  MIN_LIMIT_CAPABILITY_VALUE,
} from "../../src/billing/domain/capability/capability_registry";

describe("capabilitiesSchema", () => {
  it("declares exactly the keys in the registry", () => {
    expect(Object.keys(capabilitiesSchema.shape).sort()).toEqual(
      CAPABILITY_REGISTRY.map(entry => entry.key).sort()
    );
  });

  it("rejects a key outside the registry", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: 5,
      export_reports: false,
      not_a_capability: 1,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a limit below the minimum", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: MIN_LIMIT_CAPABILITY_VALUE - 1,
      export_reports: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a limit above the maximum", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: MAX_LIMIT_CAPABILITY_VALUE + 1,
      export_reports: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-integer limit", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: 2.5,
      export_reports: false,
    });

    expect(result.success).toBe(false);
  });

  it("rejects an access capability carrying a number", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: 5,
      export_reports: 1,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a set that matches the registry", () => {
    const result = capabilitiesSchema.safeParse({
      max_properties: 5,
      export_reports: true,
    });

    expect(result.success).toBe(true);
  });
});
