import { IllegalStateError } from "../../../core/application/error/illegal_state_error";
import type { CapabilityKey } from "./capability_key";
import {
  CAPABILITY_REGISTRY,
  capabilityRegistryEntryOf,
} from "./capability_registry";

export type CapabilityValues = Record<string, unknown>;

export type CapabilityFallback = {
  key: CapabilityKey;
  reason: "absent" | "wrong_type";
};

export class CapabilitySet {
  readonly #values: Record<CapabilityKey, boolean | number>;
  readonly #fallbacks: readonly CapabilityFallback[];

  private constructor(
    values: Record<CapabilityKey, boolean | number>,
    fallbacks: readonly CapabilityFallback[]
  ) {
    this.#values = values;
    this.#fallbacks = fallbacks;
  }

  public static of(values: CapabilityValues): CapabilitySet {
    const fallbacks: CapabilityFallback[] = [];
    const resolved = CAPABILITY_REGISTRY.reduce(
      (acc, entry) => {
        const value = values[entry.key];
        const expectedType = entry.kind === "access" ? "boolean" : "number";
        if (typeof value === expectedType) {
          acc[entry.key] = value as boolean | number;
        } else {
          fallbacks.push({
            key: entry.key,
            reason: value === undefined ? "absent" : "wrong_type",
          });
          acc[entry.key] = entry.default;
        }
        return acc;
      },
      {} as Record<CapabilityKey, boolean | number>
    );
    return new CapabilitySet(resolved, fallbacks);
  }

  public static empty(): CapabilitySet {
    const values = CAPABILITY_REGISTRY.reduce(
      (acc, entry) => {
        acc[entry.key] = entry.kind === "access" ? false : 0;
        return acc;
      },
      {} as Record<CapabilityKey, boolean | number>
    );
    return new CapabilitySet(values, []);
  }

  get fallbacks(): readonly CapabilityFallback[] {
    return this.#fallbacks;
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

  toRecord(): Record<CapabilityKey, boolean | number> {
    return { ...this.#values };
  }
}
