import type { GatewayCatalogEntry } from "./gateway_catalog_entry";

type GatewayCatalogEventBase = {
  event_id: string;

  occurred_at: Date;
};

export type CatalogEntryChangedEvent = GatewayCatalogEventBase & {
  type: "catalog_entry_changed";
  entry: GatewayCatalogEntry;
};

export type CatalogEntryRetiredEvent = GatewayCatalogEventBase & {
  type: "catalog_entry_retired";
  external_price_reference: string;
};

export type CatalogProductOfferingChangedEvent = GatewayCatalogEventBase & {
  type: "catalog_product_offering_changed";
  external_product_reference: string;
  is_offered: boolean;
};

export type CatalogProductRetiredEvent = GatewayCatalogEventBase & {
  type: "catalog_product_retired";
  external_product_reference: string;
};

export type GatewayCatalogEvent =
  | CatalogEntryChangedEvent
  | CatalogEntryRetiredEvent
  | CatalogProductOfferingChangedEvent
  | CatalogProductRetiredEvent;
