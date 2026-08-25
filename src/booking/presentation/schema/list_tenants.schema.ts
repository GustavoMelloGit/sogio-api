import { z } from "zod";

export const tenantSearchQuery = z
  .string()
  .max(100)
  .optional()
  .describe(
    "Optional filter on the guest name, case-insensitive and matching any part of it. Omit to list every guest."
  );
