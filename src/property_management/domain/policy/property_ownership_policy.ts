import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { User } from "../../../auth/domain/entity/user";
import type { Property } from "../entity/property";

/**
 * Ownership check for any use case operating on a property-scoped resource.
 * "No such property", "property belongs to someone else", and "property was
 * soft-deleted" all surface as `ResourceNotFoundError("Property")` (404) —
 * never 401/403 — so a caller can't use the response to probe for the
 * existence of another user's property, or keep operating on settings scoped
 * to a property the owner already deleted.
 */
export class PropertyOwnershipPolicy {
  static ensureOwnership(
    property: Property | null,
    user: User,
    resourceLabel = "Property"
  ): Property {
    if (!property || property.user_id !== user.id || property.deleted_at) {
      throw new ResourceNotFoundError(resourceLabel);
    }
    return property;
  }
}
