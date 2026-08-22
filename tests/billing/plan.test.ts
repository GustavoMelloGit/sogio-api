import { describe, expect, it } from "bun:test";
import { Plan } from "../../src/billing/domain/entity/plan";
import { CapabilitySet } from "../../src/billing/domain/capability/capability_set";

function reconstituteLegacyPlan(): Plan {
  return Plan.reconstitute({
    id: "b3f6c1a0-0000-4000-8000-0000000000aa",
    code: "legacy",
    name: "Legacy",
    price_amount: 1000,
    billing_interval: "monthly",
    capabilities: { max_properties: 3, chave_que_nao_existe: 99 },
    trial_days: 0,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  });
}

describe("Plan — capabilities schema tolerates an unknown key (D-7)", () => {
  it("reconstitutes without throwing when capabilities carries a key absent from the registry", () => {
    expect(() => reconstituteLegacyPlan()).not.toThrow();
  });

  it("keeps the unknown key in the raw record read back off the entity", () => {
    const plan = reconstituteLegacyPlan();

    expect(plan.capabilities).toEqual({
      max_properties: 3,
      chave_que_nao_existe: 99,
    });
  });

  it("ignores the unknown key once a CapabilitySet is resolved from it", () => {
    const plan = reconstituteLegacyPlan();

    const capabilities = CapabilitySet.of(plan.capabilities);

    expect(capabilities.limitOf("max_properties")).toBe(3);
    expect(capabilities.toRecord()).toEqual({
      max_properties: 3,
      export_reports: false,
    });
  });
});

describe("Plan.capabilities — getter never leaks a mutable reference (C-3)", () => {
  it("does not let a caller mutate the entity's internal state through the returned object", () => {
    const plan = reconstituteLegacyPlan();

    const capabilities = plan.capabilities;
    capabilities.max_properties = 999;
    capabilities.injected_key = "attacker controlled";

    expect(plan.capabilities).toEqual({
      max_properties: 3,
      chave_que_nao_existe: 99,
    });
  });

  it("returns a fresh object on every call", () => {
    const plan = reconstituteLegacyPlan();

    expect(plan.capabilities).not.toBe(plan.capabilities);
  });
});
