import type { DomainEvent } from "../../../core/domain/event/domain_event";

export class StayImportedEvent implements DomainEvent {
  static readonly NAME = "stay_imported";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(
    public readonly stay_id: string,
    public readonly tenant_name: string,
    public readonly property_id: string,
    public readonly paid_amount: number,
    public readonly check_in: Date,
    public readonly check_out: Date
  ) {
    this.name = StayImportedEvent.NAME;
    this.occurred_at = new Date();
  }
}
