import type { CapabilityKey } from "./capability_key";

export const MIN_LIMIT_CAPABILITY_VALUE = 1;
export const MAX_LIMIT_CAPABILITY_VALUE = 10_000;

export type CapabilityKind = "access" | "limit";

type BaseCapabilityRegistryEntry = {
  key: CapabilityKey;
  required: boolean;
  label: string;
  metadata_key: string;
};

export type AccessCapabilityRegistryEntry = BaseCapabilityRegistryEntry & {
  kind: "access";
  default: boolean;
};

export type LimitCapabilityRegistryEntry = BaseCapabilityRegistryEntry & {
  kind: "limit";
  default: number;
};

export type CapabilityRegistryEntry =
  | AccessCapabilityRegistryEntry
  | LimitCapabilityRegistryEntry;

export const CAPABILITY_REGISTRY = [
  {
    key: "max_properties",
    kind: "limit",
    default: 1,
    required: true,
    label: "properties",
    metadata_key: "sogio_max_properties",
  },
  {
    key: "export_reports",
    kind: "access",
    default: false,
    required: false,
    label: "report exports",
    metadata_key: "sogio_export_reports",
  },
  {
    key: "bulk_import",
    kind: "access",
    default: false,
    required: false,
    label: "bulk data imports",
    metadata_key: "sogio_bulk_import",
  },
] as const satisfies readonly CapabilityRegistryEntry[];

type CapabilityRegistryEntryUnion = (typeof CAPABILITY_REGISTRY)[number];

export type TotalCapabilityValues = {
  [K in CapabilityRegistryEntryUnion["key"]]: Extract<
    CapabilityRegistryEntryUnion,
    { key: K }
  >["kind"] extends "access"
    ? boolean
    : number;
};

export type AccessCapabilityKey = Extract<
  (typeof CAPABILITY_REGISTRY)[number],
  { kind: "access" }
>["key"];

export function capabilityRegistryEntryOf(
  key: CapabilityKey
): CapabilityRegistryEntry {
  const entry = CAPABILITY_REGISTRY.find(candidate => candidate.key === key);
  if (!entry) {
    throw new Error(`Unknown capability key: ${key}`);
  }
  return entry;
}
