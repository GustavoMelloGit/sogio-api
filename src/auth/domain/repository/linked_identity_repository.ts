import type {
  IdentityProvider,
  LinkedIdentity,
} from "../entity/linked_identity";

export interface LinkedIdentityRepository {
  findByProviderAndSubject(
    provider: IdentityProvider,
    subject: string
  ): Promise<LinkedIdentity | null>;
  existsForUserAndProvider(
    userId: string,
    provider: IdentityProvider
  ): Promise<boolean>;
  create(identity: LinkedIdentity): Promise<LinkedIdentity>;
}
