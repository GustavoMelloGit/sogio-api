import type { WaitlistLead } from "../entity/waitlist_lead";

export interface WaitlistLeadRepository {
  joinWaitlist(lead: WaitlistLead): Promise<string>;
}
