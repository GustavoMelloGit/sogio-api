import { describe, expect, it } from "bun:test";
import {
  CAPABILITY_REGISTRY,
  type AccessCapabilityKey,
} from "../../src/billing/domain/capability/capability_registry";

describe("AccessCapabilityKey (C-1)", () => {
  it("only lists registry keys whose kind is access", () => {
    const accessEntries = CAPABILITY_REGISTRY.filter(
      (
        entry
      ): entry is Extract<
        (typeof CAPABILITY_REGISTRY)[number],
        { kind: "access" }
      > => entry.kind === "access"
    );

    expect(accessEntries.map(entry => entry.key)).toEqual(["export_reports"]);
  });

  it("accepts a known access capability key as an AccessCapabilityKey", () => {
    const knownAccessKey: AccessCapabilityKey = "export_reports";

    expect(
      CAPABILITY_REGISTRY.some(
        entry => entry.key === knownAccessKey && entry.kind === "access"
      )
    ).toBe(true);
  });
});
