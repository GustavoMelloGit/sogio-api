import z from "zod";
import {
  CAPABILITY_REGISTRY,
  MAX_LIMIT_CAPABILITY_VALUE,
  MIN_LIMIT_CAPABILITY_VALUE,
} from "../../domain/capability/capability_registry";

export const capabilitiesSchema = z
  .object(
    Object.fromEntries(
      CAPABILITY_REGISTRY.map(entry => [
        entry.key,
        entry.kind === "access"
          ? z.boolean()
          : z
              .int()
              .min(MIN_LIMIT_CAPABILITY_VALUE)
              .max(MAX_LIMIT_CAPABILITY_VALUE),
      ])
    )
  )
  .strict();
