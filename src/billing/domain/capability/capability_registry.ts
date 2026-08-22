import type { CapabilityKey } from "./capability_key";

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

export const CAPABILITY_REGISTRY: readonly CapabilityRegistryEntry[] = [
  {
    key: "max_properties",
    kind: "limit",
    default: 1,
    required: true,
    label: "properties",
    metadata_key: "sogio_max_properties",
  },
];

export function capabilityRegistryEntryOf(
  key: CapabilityKey
): CapabilityRegistryEntry {
  const entry = CAPABILITY_REGISTRY.find(candidate => candidate.key === key);
  if (!entry) {
    throw new Error(`Unknown capability key: ${key}`);
  }
  return entry;
}
