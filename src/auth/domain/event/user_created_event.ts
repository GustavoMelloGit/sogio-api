import type { DomainEvent } from "../../../core/domain/event/domain_event";

export class UserCreatedEvent implements DomainEvent {
  static readonly NAME = "user_created";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(public readonly user_id: string) {
    this.name = UserCreatedEvent.NAME;
    this.occurred_at = new Date();
  }
}
