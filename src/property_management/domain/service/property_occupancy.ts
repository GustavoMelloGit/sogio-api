/**
 * `DeletePropertyUseCase` needs to release a property's future occupancy and
 * refuse the operation when a guest is checked in right now, but both the
 * fact and the ability to act on it live in `booking`. Declaring the port
 * here and implementing it in `booking` (`StayPropertyOccupancy`) keeps the
 * dependency direction `booking -> property_management`, the same as every
 * other cross-context import today — the reverse would close a cycle
 * (DA-3).
 *
 * The port is a command, not a query (DA-3-R): it cancels every future stay
 * and reports how many, in the same pass it checks for an in-progress one.
 * `ensureNoStayInProgress` carries the actual rule ("a property with a guest
 * checked in right now cannot be deleted") as a callback, the same idiom
 * `PropertyRepository.saveNewWithinQuota` already uses for
 * `ensureWithinQuota` — the caller supplies the domain error, the port only
 * supplies the fact. This keeps the rule and its `ConflictError` inside
 * `property_management`; `booking` never learns anything about property
 * deletion.
 */
export interface PropertyOccupancy {
  /**
   * Cancels every future stay of `propertyId` and returns how many were
   * cancelled. Calls `ensureNoStayInProgress` with the number of in-progress
   * stays found before cancelling anything — the callback throws if that
   * count is greater than zero, aborting the whole operation. Never
   * rechecks ownership (DA-3): the caller must have already authorized the
   * request.
   */
  releaseFutureOccupancy(
    propertyId: string,
    ensureNoStayInProgress: (inProgressCount: number) => void
  ): Promise<number>;
}
