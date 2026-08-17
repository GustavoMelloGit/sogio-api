/**
 * Backs the DA-7 idempotency ledger. Not a repository for an aggregate —
 * `processed_gateway_events` has no entity behind it (§2.2).
 */
export interface ProcessedGatewayEventRepository {
  /**
   * `INSERT ... ON CONFLICT DO NOTHING`. Returns `true` when this call won
   * the claim (first delivery), `false` when the event was already claimed
   * (a reentry) — the caller must respond 200 without touching the
   * subscription.
   */
  claim(event_id: string, type: string, occurred_at: Date): Promise<boolean>;
  /** Only called on the failure path, so the gateway's retry can claim again (R-6). */
  release(event_id: string): Promise<void>;
}
