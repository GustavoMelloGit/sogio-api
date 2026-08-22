import type { DomainEvent } from "../../../core/domain/event/domain_event";

export class StayCanceledEvent implements DomainEvent {
  static readonly NAME = "stay_canceled";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(
    public readonly stay_id: string,
    public readonly property_id: string,
    public readonly price: number,
    public readonly tenant_name: string,
    public readonly check_in: Date,
    public readonly check_out: Date
  ) {
    this.name = StayCanceledEvent.NAME;
    this.occurred_at = new Date();
  }
}
