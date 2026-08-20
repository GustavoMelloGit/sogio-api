import type { GatewayCatalogEntry } from "./gateway_catalog_entry";

type GatewayCatalogEventBase = {
  /** The gateway's own event id — the idempotency key (DA-3, reuses `processed_gateway_events`). */
  event_id: string;
  /** The instant, in the gateway's clock, the event describes. */
  occurred_at: Date;
};

/**
 * `price.created` / `price.updated` (DA-8). Creates or updates the plan
 * matched by `entry.code` (DA-1); retires it only when `entry.is_offered`
 * is false *and* `entry.external_price_reference` is the one currently
 * linked to that plan — an old, superseded price going inactive must never
 * retire the plan a newer price has since taken over.
 */
export type CatalogEntryChangedEvent = GatewayCatalogEventBase & {
  type: "catalog_entry_changed";
  entry: GatewayCatalogEntry;
};

/**
 * `price.deleted` (DA-8). A near-dead path in practice — Stripe refuses to
 * delete a Price already used by a subscription, so archiving
 * (`price.updated(active:false)`, above) is the real retirement path.
 * Retires the plan currently linked to this price reference.
 */
export type CatalogEntryRetiredEvent = GatewayCatalogEventBase & {
  type: "catalog_entry_retired";
  external_price_reference: string;
};

/**
 * `product.created` / `product.updated` (DA-8). Carries no business data
 * (§2.3 — the payload's Product is never expanded) — only a
 * retirement/restoration signal for every plan linked to this Product.
 */
export type CatalogProductOfferingChangedEvent = GatewayCatalogEventBase & {
  type: "catalog_product_offering_changed";
  external_product_reference: string;
  is_offered: boolean;
};

/**
 * `product.deleted` (DA-8). Same near-dead-path caveat as
 * `catalog_entry_retired`. Retires every plan linked to this Product.
 */
export type CatalogProductRetiredEvent = GatewayCatalogEventBase & {
  type: "catalog_product_retired";
  external_product_reference: string;
};

/**
 * Union discriminated on `type` (§2.6) — a sibling family to
 * `GatewayBillingEvent`, not a variant of it: no subscription reference, no
 * customer reference, and none of the subscription staleness resolution
 * that union's `switch` relies on.
 */
export type GatewayCatalogEvent =
  | CatalogEntryChangedEvent
  | CatalogEntryRetiredEvent
  | CatalogProductOfferingChangedEvent
  | CatalogProductRetiredEvent;
