import type Stripe from "stripe";
import type { Logger } from "../../../core/application/logger/logger";
import { env } from "../../../core/infra/config/environments";
import type { GatewayCatalogEntry } from "../../application/gateway/gateway_catalog_entry";
import type { BillingInterval } from "../../domain/entity/plan";

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;
const MAX_NAME_LENGTH = 100;
const MIN_MAX_PROPERTIES = 1;
const MAX_MAX_PROPERTIES = 10_000;
const MIN_TRIAL_DAYS = 0;
const MAX_TRIAL_DAYS = 365;
// S-5: mirrors planSchema's price_amount bound (plan.ts) — a Price above it
// would make Plan.create/#touch throw past this parser's try/catch-free
// boundary, in SyncPlanCatalogEntryUseCase#save, the same unhandled-throw
// shape as S-1.
const MIN_PRICE_AMOUNT = 0;
const MAX_PRICE_AMOUNT = 100_000_000;
// S-1: Postgres rejects these at the byte level (22021
// character_not_in_repertoire, among others) — retrying an identical write
// fails identically forever, so they must be caught here, before the value
// ever reaches a query.
const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F-\x9F]/;
const SURROGATE_PATTERN = /[\ud800-\udfff]/;

function hasOrphanSurrogate(value: string): boolean {
  const withPairsRemoved = value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, "");
  return SURROGATE_PATTERN.test(withPairsRemoved);
}

/**
 * Stripe Price -> Sogio catalog entry (DA-4's whole validation table). A
 * semantically wrong field (`sogio_max_properties`, `sogio_trial_days`
 * present-and-invalid, currency, interval, missing or out-of-range
 * `unit_amount`) invalidates the entry entirely (`null`); a display-only
 * field (`sogio_plan_name` too long) is normalized instead. Never throws — a
 * malformed dashboard entry is the expected case here, not the exceptional
 * one (DA-4). The single definition of "valid catalog entry", imported by
 * both `StripeWebhookVerifier` and `StripePaymentGateway.listCatalogEntries`
 * so the two paths can never disagree about the catalog.
 *
 * S-2: also the one place that can close the `livemode` gap for both
 * callers at once. `StripeWebhookVerifier` already rejects a mismatched
 * `Event.livemode` before dispatch (DA-9), but `listCatalogEntries()` reads
 * `Stripe.Price` objects directly, with no equivalent check — a test-mode
 * `STRIPE_SECRET_KEY` configured by mistake in production would otherwise
 * let boot/admin reconciliation read the sandbox catalog and overwrite
 * `plans` with it.
 */
export function parseStripeCatalogEntry(
  price: Stripe.Price,
  logger: Logger
): GatewayCatalogEntry | null {
  const expectedLivemode = env.NODE_ENV === "production";
  if (price.livemode !== expectedLivemode) {
    logger.warn(
      "Ignoring catalog entry: livemode does not match this environment (S-2)",
      {
        price_id: price.id,
        livemode: price.livemode,
        expected_livemode: expectedLivemode,
      }
    );
    return null;
  }

  const code = parseCode(price.metadata.sogio_plan_code);
  if (!code) {
    logger.warn(
      "Ignoring catalog entry: missing or malformed sogio_plan_code",
      { price_id: price.id }
    );
    return null;
  }

  const name = parseName(price.metadata.sogio_plan_name);
  if (!name) {
    logger.warn(
      "Ignoring catalog entry: missing, empty, or malformed sogio_plan_name",
      { price_id: price.id }
    );
    return null;
  }

  const max_properties = parseMaxProperties(
    price.metadata.sogio_max_properties
  );
  if (max_properties === null) {
    logger.warn(
      "Ignoring catalog entry: missing, non-integer, or out-of-range sogio_max_properties",
      { price_id: price.id }
    );
    return null;
  }

  const trial_days = parseTrialDays(price.metadata.sogio_trial_days);
  if (trial_days === null) {
    logger.warn(
      "Ignoring catalog entry: sogio_trial_days present but invalid",
      {
        price_id: price.id,
      }
    );
    return null;
  }

  if (price.unit_amount === null) {
    logger.warn(
      "Ignoring catalog entry: tiered/metered price has no unit_amount",
      { price_id: price.id }
    );
    return null;
  }

  if (
    price.unit_amount < MIN_PRICE_AMOUNT ||
    price.unit_amount > MAX_PRICE_AMOUNT
  ) {
    logger.warn(
      "Ignoring catalog entry: unit_amount is out of the accepted range (S-5)",
      { price_id: price.id, unit_amount: price.unit_amount }
    );
    return null;
  }

  if (price.currency !== "brl") {
    logger.warn("Ignoring catalog entry: currency is not brl", {
      price_id: price.id,
      currency: price.currency,
    });
    return null;
  }

  const billing_interval = parseBillingInterval(price.recurring);
  if (!billing_interval) {
    logger.warn("Ignoring catalog entry: not a monthly recurring price", {
      price_id: price.id,
    });
    return null;
  }

  return {
    external_price_reference: price.id,
    external_product_reference: idOf(price.product),
    code,
    name,
    price_amount: price.unit_amount,
    billing_interval,
    max_properties,
    trial_days,
    is_offered: price.active,
  };
}

function parseCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return CODE_PATTERN.test(trimmed) ? trimmed : null;
}

function parseName(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // S-1: a control character (including a NUL byte) or an unpaired
  // surrogate is a semantically wrong field, not a display quirk — Postgres
  // rejects both at the byte level (22021), and no amount of retrying
  // changes that, so the entry is invalidated here rather than truncated.
  if (CONTROL_CHAR_PATTERN.test(trimmed) || hasOrphanSurrogate(trimmed)) {
    return null;
  }
  return trimmed.length > MAX_NAME_LENGTH
    ? trimmed.slice(0, MAX_NAME_LENGTH)
    : trimmed;
}

function parseMaxProperties(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_MAX_PROPERTIES || value > MAX_MAX_PROPERTIES) return null;
  return value;
}

/** Absence means `0` — an explicit statement of "no trial" (DA-4). Presence-and-wrong invalidates the whole entry rather than falling back to a default. */
function parseTrialDays(raw: string | undefined): number | null {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_TRIAL_DAYS || value > MAX_TRIAL_DAYS) return null;
  return value;
}

function parseBillingInterval(
  recurring: Stripe.Price.Recurring | null
): BillingInterval | null {
  if (!recurring) return null;
  if (recurring.interval !== "month" || recurring.interval_count !== 1) {
    return null;
  }
  return "monthly";
}

function idOf(
  value: string | Stripe.Product | Stripe.DeletedProduct
): string | null {
  return typeof value === "string" ? value : value.id;
}
