import type { Property } from "../entity/property";

export interface PropertyRepository {
  propertyOfId(id: string): Promise<Property | null>;
  save(property: Property): Promise<void>;
  allFromUser(userId: string): Promise<Array<Property>>;
  /** Conta apenas propriedades ativas — mesma semântica de allFromUser. */
  countFromUser(userId: string): Promise<number>;
  /** Serializes concurrent creations from the same owner: counting and
   *  inserting happen in the same transaction. Throwing from
   *  `ensureWithinQuota` aborts the write. */
  saveNewWithinQuota(
    property: Property,
    ensureWithinQuota: (currentCount: number) => void
  ): Promise<void>;
}
