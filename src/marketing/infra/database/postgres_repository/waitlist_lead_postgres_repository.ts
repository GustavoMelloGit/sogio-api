import { db } from "../../../../core/infra/database/drizzle/database";
import { waitlistLeadsTable } from "../../../../core/infra/database/drizzle/schema";
import { IllegalStateError } from "../../../../core/application/error/illegal_state_error";
import type { WaitlistLead } from "../../../domain/entity/waitlist_lead";
import type { WaitlistLeadRepository } from "../../../domain/repository/waitlist_lead_repository";

export class WaitlistLeadPostgresRepository implements WaitlistLeadRepository {
  async joinWaitlist(lead: WaitlistLead): Promise<string> {
    const result = await db
      .insert(waitlistLeadsTable)
      .values({
        id: lead.id,
        name: lead.name,
        whatsapp: lead.whatsapp,
        property_count: lead.property_count,
        source: lead.source,
        consented_at: lead.consented_at,
        created_at: lead.created_at,
        updated_at: lead.updated_at,
        deleted_at: lead.deleted_at,
      })
      .onConflictDoUpdate({
        target: waitlistLeadsTable.whatsapp,
        set: {
          name: lead.name,
          property_count: lead.property_count,
          source: lead.source,
          updated_at: lead.updated_at,
        },
      })
      .returning({ id: waitlistLeadsTable.id });

    const persisted = result[0];

    if (!persisted) {
      throw new IllegalStateError("Failed to save waitlist lead");
    }

    return persisted.id;
  }
}
