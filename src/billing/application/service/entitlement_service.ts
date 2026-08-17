import type { Entitlement } from "../../domain/value_object/entitlement";

/**
 * Open Host Service published by `billing` (DA-8). Consumers depend on this
 * abstraction only — never on `billing`'s repositories or policy directly.
 */
export interface EntitlementService {
  entitlementOf(user_id: string): Promise<Entitlement>;
}
