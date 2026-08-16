/**
 * `DeletePropertyUseCase` needs to know whether a property has a pending
 * stay, but that fact lives in `booking`. Declaring the port here and
 * implementing it in `booking` (`StayPropertyOccupancy`) keeps the
 * dependency direction `booking -> property_management`, the same as every
 * other cross-context import today — the reverse would close a cycle
 * (DA-3). Returns a plain boolean instead of throwing: this port is a
 * query, not a rule — deciding what to do with the fact stays in
 * `DeletePropertyUseCase`.
 */
export interface PropertyOccupancy {
  hasPendingStays(propertyId: string): Promise<boolean>;
}
