import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import type { CapabilityKey } from "./capability_key";
import {
  CAPABILITY_REGISTRY,
  capabilityRegistryEntryOf,
} from "./capability_registry";

export type CapabilityValues = Record<string, unknown>;

export class CapabilitySet {
  readonly #values: Record<CapabilityKey, boolean | number>;

  private constructor(values: Record<CapabilityKey, boolean | number>) {
    this.#values = values;
  }

  public static of(values: CapabilityValues): CapabilitySet {
    const resolved = CAPABILITY_REGISTRY.reduce(
      (acc, entry) => {
        const value = values[entry.key];
        if (entry.kind === "access") {
          acc[entry.key] = typeof value === "boolean" ? value : entry.default;
        } else {
          acc[entry.key] = typeof value === "number" ? value : entry.default;
        }
        return acc;
      },
      {} as Record<CapabilityKey, boolean | number>
    );
    return new CapabilitySet(resolved);
  }

  public static empty(): CapabilitySet {
    const values = CAPABILITY_REGISTRY.reduce(
      (acc, entry) => {
        acc[entry.key] = entry.kind === "access" ? false : 0;
        return acc;
      },
      {} as Record<CapabilityKey, boolean | number>
    );
    return new CapabilitySet(values);
  }

  allows(key: CapabilityKey): boolean {
    const entry = capabilityRegistryEntryOf(key);
    if (entry.kind !== "access") {
      throw new IllegalStateError(
        `Capability "${key}" is a "${entry.kind}" capability; use limitOf() instead of allows()`
      );
    }
    return Boolean(this.#values[key]);
  }

  limitOf(key: CapabilityKey): number {
    const entry = capabilityRegistryEntryOf(key);
    if (entry.kind !== "limit") {
      throw new IllegalStateError(
        `Capability "${key}" is a "${entry.kind}" capability; use allows() instead of limitOf()`
      );
    }
    return Number(this.#values[key]);
  }
}
