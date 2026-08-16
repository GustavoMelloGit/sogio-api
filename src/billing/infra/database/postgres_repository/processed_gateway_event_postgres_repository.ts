import { eq } from "drizzle-orm";
import type { ProcessedGatewayEventRepository } from "../../../domain/repository/processed_gateway_event_repository";
import { db } from "../../../../core/infra/database/drizzle/database";
import { processedGatewayEventsTable } from "../../../../core/infra/database/drizzle/schema";

export class ProcessedGatewayEventPostgresRepository
  implements ProcessedGatewayEventRepository
{
  async claim(
    event_id: string,
    type: string,
    occurred_at: Date
  ): Promise<boolean> {
    const inserted = await db
      .insert(processedGatewayEventsTable)
      .values({ external_event_id: event_id, type, occurred_at })
      .onConflictDoNothing({
        target: processedGatewayEventsTable.external_event_id,
      })
      .returning({ id: processedGatewayEventsTable.id });

    return inserted.length > 0;
  }

  async release(event_id: string): Promise<void> {
    await db
      .delete(processedGatewayEventsTable)
      .where(eq(processedGatewayEventsTable.external_event_id, event_id));
  }
}
