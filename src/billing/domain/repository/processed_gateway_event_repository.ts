export interface ProcessedGatewayEventRepository {
  claim(event_id: string, type: string, occurred_at: Date): Promise<boolean>;

  release(event_id: string): Promise<void>;
}
