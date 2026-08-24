import { z } from "zod";

export const deleteLedgerEntryInput = {
  property_id: z
    .uuid("Property ID must be a valid UUID")
    .describe(
      "ID of the property the ledger entry belongs to. Must be a property administered by the authenticated user."
    ),
  entry_id: z
    .uuid("Entry ID must be a valid UUID")
    .describe(
      "ID of the ledger entry (financial movement) to delete. Can be obtained from the property's financial movements listing."
    ),
} satisfies z.ZodRawShape;
