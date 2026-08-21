import type { Entitlement } from "../../domain/value_object/entitlement";

export interface EntitlementService {
  entitlementOf(user_id: string): Promise<Entitlement>;
}
