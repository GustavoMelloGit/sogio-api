import { describe, expect, it } from "bun:test";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";
import { IllegalStateError } from "../../src/core/application/error/illegal_state_error";

describe("CapabilitySet.empty() vs CapabilitySet.of({}) (D-8)", () => {
  it("of({}) resolves the registry defaults for a limit capability", () => {
    const set = CapabilitySet.of({});

    expect(set.limitOf("max_properties")).toBe(1);
  });

  it("of({}) resolves the registry defaults for an access capability", () => {
    const set = CapabilitySet.of({});

    expect(set.allows("export_reports")).toBe(false);
  });

  it("empty() zeroes a limit capability instead of applying the registry default", () => {
    const set = CapabilitySet.empty();

    expect(set.limitOf("max_properties")).toBe(0);
  });

  it("empty() and of({}) disagree on max_properties — a no-subscription account must not read as a Free account", () => {
    const empty = CapabilitySet.empty();
    const registryDefaults = CapabilitySet.of({});

    expect(empty.limitOf("max_properties")).not.toBe(
      registryDefaults.limitOf("max_properties")
    );
  });
});

describe("CapabilitySet — accessor must match the registered kind (D-9)", () => {
  it("allows() throws IllegalStateError when the key is a limit capability", () => {
    const set = CapabilitySet.of({ max_properties: 5 });

    expect(() => set.allows("max_properties")).toThrow(IllegalStateError);
  });

  it("limitOf() throws IllegalStateError when the key is an access capability", () => {
    const set = CapabilitySet.of({ export_reports: true });

    expect(() => set.limitOf("export_reports")).toThrow(IllegalStateError);
  });

  it("limitOf() throws on a limit key from an empty() set too — the guard is unconditional on kind, not on emptiness", () => {
    const set = CapabilitySet.empty();

    expect(() => set.allows("max_properties")).toThrow(IllegalStateError);
  });
});

describe("CapabilitySet.of — resolution ignores keys outside the registry (D-7)", () => {
  it("keeps resolving known capabilities when the input carries an unknown key", () => {
    const set = CapabilitySet.of({
      max_properties: 5,
      chave_que_nao_existe: 99,
    });

    expect(set.limitOf("max_properties")).toBe(5);
  });

  it("never surfaces the unknown key through toRecord()", () => {
    const set = CapabilitySet.of({
      max_properties: 5,
      chave_que_nao_existe: 99,
    });

    expect(set.toRecord()).toEqual({
      max_properties: 5,
      export_reports: false,
    });
  });
});

describe("CapabilitySet.of — reports a fallback when a value falls back to the registry default (C-5)", () => {
  it("reports reason 'absent' when a capability key is missing entirely", () => {
    const set = CapabilitySet.of({ export_reports: true });

    expect(set.fallbacks).toEqual([
      { key: "max_properties", reason: "absent" },
    ]);
  });

  it("reports reason 'wrong_type' when a capability value has the wrong type", () => {
    const set = CapabilitySet.of({
      max_properties: "not-a-number",
      export_reports: true,
    });

    expect(set.fallbacks).toEqual([
      { key: "max_properties", reason: "wrong_type" },
    ]);
  });

  it("reports no fallback when every capability resolves from an explicit, correctly-typed value", () => {
    const set = CapabilitySet.of({ max_properties: 5, export_reports: true });

    expect(set.fallbacks).toEqual([]);
  });

  it("never reports a fallback for empty() — zeroing is deliberate, not a degradation", () => {
    const set = CapabilitySet.empty();

    expect(set.fallbacks).toEqual([]);
  });
});
