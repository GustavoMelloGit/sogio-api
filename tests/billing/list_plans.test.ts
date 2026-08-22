import { describe, it, expect } from "bun:test";
import { api } from "../helpers/server";

describe("GET /billing/plans", () => {
  it("returns 200 without an authentication token", async () => {
    const res = await api("/billing/plans", { method: "GET" });

    expect(res.status).toBe(200);
  });

  it("returns the seeded free and pro plans with the expected fields", async () => {
    const res = await api("/billing/plans", { method: "GET" });

    const body = (await res.json()) as Array<{
      id: string;
      code: string;
      name: string;
      price_amount: number;
      billing_interval: string;
      capabilities: Record<string, boolean | number>;
      trial_days: number;
    }>;

    const free = body.find(plan => plan.code === "free");
    const pro = body.find(plan => plan.code === "pro");

    expect(free).toMatchObject({
      code: "free",
      name: "Free",
      price_amount: 0,
      billing_interval: "monthly",
      capabilities: { max_properties: 1, export_reports: false },
      trial_days: 0,
    });
    expect(pro).toMatchObject({
      code: "pro",
      name: "Pro",
      price_amount: 2500,
      billing_interval: "monthly",
      capabilities: { max_properties: 5, export_reports: false },
      trial_days: 14,
    });
  });

  it("does not include external_price_reference in the response", async () => {
    const res = await api("/billing/plans", { method: "GET" });

    const body = (await res.json()) as Array<Record<string, unknown>>;

    for (const plan of body) {
      expect(plan).not.toHaveProperty("external_price_reference");
    }
  });
});
