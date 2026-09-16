import type { DomainEvent } from "../../../core/domain/event/domain_event";
import type { IdentityProvider } from "../entity/linked_identity";

export class IdentityLinkedEvent implements DomainEvent {
  static readonly NAME = "identity_linked";
  public readonly name: string;
  public readonly occurred_at: Date;

  constructor(
    public readonly user_id: string,
    public readonly provider: IdentityProvider
  ) {
    this.name = IdentityLinkedEvent.NAME;
    this.occurred_at = new Date();
  }
}
