import { describe, it, expect } from "bun:test";
import type Stripe from "stripe";
import { parseStripeCatalogEntry } from "../../src/billing/infra/gateway/stripe_catalog_entry_parser";
import type { Logger } from "../../src/core/application/logger/logger";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
};

const VALID_METADATA = {
  sogio_plan_code: "pro",
  sogio_plan_name: "Pro",
  sogio_max_properties: "5",
  sogio_trial_days: "14",
};

/** Builds a minimal Stripe.Price with every field the parser reads — the type is asserted, not structurally satisfied, since a unit test has no reason to fill in every Stripe.Price field. */
function makePrice(
  overrides: {
    id?: string;
    active?: boolean;
    currency?: string;
    unit_amount?: number | null;
    product?: string;
    metadata?: Record<string, string>;
    recurring?: { interval: string; interval_count: number } | null;
    // Defaults to `false` — matches the non-production `NODE_ENV` (`test`)
    // this suite always runs under (S-2).
    livemode?: boolean;
  } = {}
): Stripe.Price {
  return {
    id: overrides.id ?? "price_test_1",
    active: overrides.active ?? true,
    currency: overrides.currency ?? "brl",
    metadata: overrides.metadata ?? VALID_METADATA,
    product: overrides.product ?? "prod_test_1",
    recurring:
      overrides.recurring === undefined
        ? { interval: "month", interval_count: 1 }
        : overrides.recurring,
    unit_amount:
      overrides.unit_amount === undefined ? 2500 : overrides.unit_amount,
    livemode: overrides.livemode ?? false,
  } as unknown as Stripe.Price;
}

describe("parseStripeCatalogEntry — a fully valid entry (DA-4)", () => {
  it("returns a GatewayCatalogEntry with every field mapped, is_offered from price.active", () => {
    const price = makePrice({ id: "price_valid_1", active: true });

    const entry = parseStripeCatalogEntry(price, silentLogger);

    expect(entry).toEqual({
      external_price_reference: "price_valid_1",
      external_product_reference: "prod_test_1",
      code: "pro",
      name: "Pro",
      price_amount: 2500,
      billing_interval: "monthly",
      max_properties: 5,
      trial_days: 14,
      is_offered: true,
    });
  });

  it("carries is_offered:false through for an inactive (archived) price", () => {
    const price = makePrice({ active: false });

    const entry = parseStripeCatalogEntry(price, silentLogger);

    expect(entry?.is_offered).toBe(false);
  });

  it("resolves external_product_reference from an expanded Product object, not just a string id", () => {
    const price = makePrice({
      product: undefined,
    });
    // @ts-expect-error — simulating an expanded Product on the raw Stripe payload
    price.product = { id: "prod_expanded_1", object: "product" };

    const entry = parseStripeCatalogEntry(price, silentLogger);

    expect(entry?.external_product_reference).toBe("prod_expanded_1");
  });
});

describe("parseStripeCatalogEntry — sogio_plan_code (DA-2, DA-4)", () => {
  it("ignores the entry when sogio_plan_code is absent", () => {
    const price = makePrice({ metadata: { ...VALID_METADATA } });
    delete (price.metadata as Record<string, string>).sogio_plan_code;

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_plan_code has an uppercase letter", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_code: "Pro" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_plan_code contains a hyphen", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_code: "pro-plus" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_plan_code is empty", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_code: "" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("trims a trailing space instead of rejecting it", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_code: "pro " },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)?.code).toBe("pro");
  });
});

describe("parseStripeCatalogEntry — sogio_plan_name (DA-4)", () => {
  it("ignores the entry when sogio_plan_name is absent", () => {
    const price = makePrice({ metadata: { ...VALID_METADATA } });
    delete (price.metadata as Record<string, string>).sogio_plan_name;

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_plan_name is empty", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: "   " },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("clamps a name longer than 100 characters instead of rejecting it (display-only field)", () => {
    const longName = "P".repeat(150);
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: longName },
    });

    const entry = parseStripeCatalogEntry(price, silentLogger);

    expect(entry?.name).toHaveLength(100);
    expect(entry?.name).toBe("P".repeat(100));
  });

  it("ignores the entry when the name contains a NUL byte (S-1)", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: "Bad\x00Name" },
    });

    expect(() => parseStripeCatalogEntry(price, silentLogger)).not.toThrow();
    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when the name contains another C0 control character (S-1)", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: "Bad\x1bName" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when the name contains an unpaired surrogate (S-1)", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: "Bad\ud800Name" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("accepts a name containing a valid surrogate pair (a real emoji)", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_plan_name: "Pro 🚀" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)?.name).toBe("Pro 🚀");
  });
});

describe("parseStripeCatalogEntry — sogio_max_properties (DA-4)", () => {
  it("ignores the entry when sogio_max_properties is absent", () => {
    const price = makePrice({ metadata: { ...VALID_METADATA } });
    delete (price.metadata as Record<string, string>).sogio_max_properties;

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_max_properties is non-integer", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_max_properties: "five" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_max_properties is below the floor", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_max_properties: "0" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when sogio_max_properties is above the ceiling", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_max_properties: "10001" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("never falls back to a default — chutar alto abre o paywall, chutar baixo tranca quem pagou", () => {
    // Re-asserts the absence case above with an explicit intent check: a
    // missing sogio_max_properties must never silently become e.g. 1 or 5.
    const price = makePrice({ metadata: { ...VALID_METADATA } });
    delete (price.metadata as Record<string, string>).sogio_max_properties;

    const entry = parseStripeCatalogEntry(price, silentLogger);

    expect(entry).toBeNull();
  });
});

describe("parseStripeCatalogEntry — sogio_trial_days (DA-4)", () => {
  it("defaults to 0 when absent — an explicit statement of no trial", () => {
    const price = makePrice({ metadata: { ...VALID_METADATA } });
    delete (price.metadata as Record<string, string>).sogio_trial_days;

    expect(parseStripeCatalogEntry(price, silentLogger)?.trial_days).toBe(0);
  });

  it("ignores the entry when present and negative", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_trial_days: "-1" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when present and non-numeric", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_trial_days: "quinze" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when present and above the ceiling", () => {
    const price = makePrice({
      metadata: { ...VALID_METADATA, sogio_trial_days: "366" },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });
});

describe("parseStripeCatalogEntry — money and interval (DA-4)", () => {
  it("ignores the entry when unit_amount is null (tiered/metered price)", () => {
    const price = makePrice({ unit_amount: null });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when currency is not brl", () => {
    const price = makePrice({ currency: "usd" });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when recurring is absent (a one-time price)", () => {
    const price = makePrice({ recurring: null });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when the interval is not month", () => {
    const price = makePrice({
      recurring: { interval: "year", interval_count: 1 },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("ignores the entry when interval_count is not 1", () => {
    const price = makePrice({
      recurring: { interval: "month", interval_count: 3 },
    });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });
});

describe("parseStripeCatalogEntry — never throws (DA-4)", () => {
  it("returns null instead of throwing for a price with no usable metadata at all", () => {
    const price = makePrice({ metadata: {} });

    expect(() => parseStripeCatalogEntry(price, silentLogger)).not.toThrow();
    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });
});

describe("parseStripeCatalogEntry — livemode (S-2)", () => {
  it("ignores the entry when price.livemode does not match this environment", () => {
    const price = makePrice({ livemode: true });

    expect(parseStripeCatalogEntry(price, silentLogger)).toBeNull();
  });

  it("accepts the entry when price.livemode matches this environment", () => {
    const price = makePrice({ livemode: false });

    expect(parseStripeCatalogEntry(price, silentLogger)).not.toBeNull();
  });
});
